#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { CascadeEdge, CascadeGraph, CascadeNode, NodeState } from './graph.js';
import { validateGraph } from './graph.js';
import { registerLiveGraph, getLiveGraph, saveGraph, graphEvents, logPath, type ChangeEvent } from './store.js';
import { startExecution, cancelExecution, isGraphRunning } from './scheduler.js';
import { ensureViewer, viewerUrl, openBrowser } from './viewer.js';

const server = new McpServer({ name: 'cascade', version: '0.1.0' });

// Workers routinely run for many minutes; a short default forces the orchestrator
// into a hot polling loop that burns calls, context, and permission prompts.
const DEFAULT_WAIT_TIMEOUT_MS = 600_000;

const nodeInputSchema = z.object({
  id: z.string().min(1),
  task: z.string().min(1),
  successCriteria: z.string().min(1),
  agent: z.enum(['claude', 'codex']).optional(),
  model: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
});

const edgeInputSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  description: z.string().min(1),
});

function nodeSummary(node: CascadeNode) {
  return {
    id: node.id,
    state: node.state,
    agent: node.agent ?? 'claude',
    result: node.result ? truncate(node.result, 500) : undefined,
    error: node.error,
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

async function resolveGraph(graphId: string): Promise<CascadeGraph | null> {
  const live = getLiveGraph(graphId);
  if (live) return live;
  return null;
}

server.registerTool(
  'create_graph',
  {
    description:
      'Create a DAG of subtasks to be executed by parallel CLI agent workers. Validates the graph and starts the live viewer, but does not execute anything.',
    inputSchema: {
      task: z.string().min(1).describe('The original user task being decomposed'),
      nodes: z.array(nodeInputSchema).min(1),
      edges: z.array(edgeInputSchema).default([]),
      cwd: z.string().optional().describe('Working directory for workers; defaults to the server process cwd'),
    },
  },
  async ({ task, nodes, edges, cwd }) => {
    const validationError = validateGraph(nodes, edges);
    if (validationError) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Graph validation failed (${validationError.reason}): ${validationError.detail}` }],
      };
    }

    const graph: CascadeGraph = {
      id: randomUUID(),
      task,
      cwd: cwd ?? process.cwd(),
      nodes: nodes.map((n) => ({ ...n, state: 'pending' as NodeState })),
      edges: edges as CascadeEdge[],
      createdAt: Date.now(),
    };

    registerLiveGraph(graph);
    await saveGraph(graph);

    const port = await ensureViewer();
    const url = viewerUrl(graph.id);
    openBrowser(url);

    return {
      content: [{ type: 'text', text: `Graph created with ${graph.nodes.length} nodes. View live at ${url}` }],
      structuredContent: { graph_id: graph.id, url, node_count: graph.nodes.length, port },
    };
  },
);

server.registerTool(
  'start_execution',
  {
    description: 'Begin executing a graph. Non-blocking: marks ready nodes, spawns workers, and returns immediately.',
    inputSchema: {
      graph_id: z.string().min(1),
      max_concurrency: z.number().int().positive().optional(),
    },
  },
  async ({ graph_id, max_concurrency }) => {
    const graph = await resolveGraph(graph_id);
    if (!graph) {
      return { isError: true, content: [{ type: 'text', text: `Unknown graph_id: ${graph_id}` }] };
    }

    startExecution(graph, max_concurrency);

    return {
      content: [{ type: 'text', text: `Execution started for ${graph.nodes.length} nodes.` }],
      structuredContent: { graph_id: graph.id, nodes: graph.nodes.map(nodeSummary) },
    };
  },
);

server.registerTool(
  'wait_for_change',
  {
    description:
      'Block until any node in the graph changes state, or until the timeout elapses. Returns changed nodes, a full snapshot, and whether the graph is fully terminal.',
    inputSchema: {
      graph_id: z.string().min(1),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Overall wait budget in milliseconds; defaults to 600000 (10 minutes)'),
    },
  },
  async ({ graph_id, timeout_ms }) => {
    const graph = await resolveGraph(graph_id);
    if (!graph) {
      return { isError: true, content: [{ type: 'text', text: `Unknown graph_id: ${graph_id}` }] };
    }

    const timeout = timeout_ms ?? DEFAULT_WAIT_TIMEOUT_MS;

    const event = await waitForNextChange(graph_id, timeout);

    const changedNodes = event?.changedNodes.map(nodeSummary) ?? [];
    const allTerminalFlag = event?.allTerminal ?? !isGraphRunning(graph_id);

    return {
      content: [
        {
          type: 'text',
          text: event
            ? `${changedNodes.length} node(s) changed. all_terminal=${allTerminalFlag}`
            : `No change within ${timeout}ms.`,
        },
      ],
      structuredContent: {
        graph_id: graph.id,
        changed_nodes: changedNodes,
        all_terminal: allTerminalFlag,
        snapshot: graph.nodes.map(nodeSummary),
      },
    };
  },
);

function waitForNextChange(graphId: string, timeoutMs: number): Promise<ChangeEvent | null> {
  return new Promise((resolve) => {
    const onChange = (event: ChangeEvent) => {
      if (event.graphId !== graphId) return;
      cleanup();
      resolve(event);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      graphEvents.off('change', onChange);
    };
    graphEvents.on('change', onChange);
  });
}

server.registerTool(
  'get_graph_state',
  {
    description: 'Get an immediate snapshot of a graph: per-node state, truncated results, and counts.',
    inputSchema: { graph_id: z.string().min(1) },
  },
  async ({ graph_id }) => {
    const graph = await resolveGraph(graph_id);
    if (!graph) {
      return { isError: true, content: [{ type: 'text', text: `Unknown graph_id: ${graph_id}` }] };
    }

    const counts: Record<NodeState, number> = { pending: 0, ready: 0, running: 0, done: 0, failed: 0 };
    for (const n of graph.nodes) counts[n.state] += 1;

    return {
      content: [{ type: 'text', text: `${graph.nodes.length} nodes: ${JSON.stringify(counts)}` }],
      structuredContent: { graph_id: graph.id, counts, nodes: graph.nodes.map(nodeSummary) },
    };
  },
);

server.registerTool(
  'get_node_output',
  {
    description: 'Get the full result and log tail for a single node.',
    inputSchema: { graph_id: z.string().min(1), node_id: z.string().min(1) },
  },
  async ({ graph_id, node_id }) => {
    const graph = await resolveGraph(graph_id);
    if (!graph) {
      return { isError: true, content: [{ type: 'text', text: `Unknown graph_id: ${graph_id}` }] };
    }
    const node = graph.nodes.find((n) => n.id === node_id);
    if (!node) {
      return { isError: true, content: [{ type: 'text', text: `Unknown node_id: ${node_id}` }] };
    }

    let logTail = '';
    try {
      const full = await readFile(logPath(graph.cwd, node_id), 'utf8');
      logTail = full.slice(-4000);
    } catch {
      logTail = '';
    }

    return {
      content: [{ type: 'text', text: node.result ?? node.error ?? '(no output yet)' }],
      structuredContent: {
        graph_id: graph.id,
        node_id,
        state: node.state,
        result: node.result,
        error: node.error,
        log_tail: logTail,
      },
    };
  },
);

server.registerTool(
  'cancel_execution',
  {
    description: 'Cancel a running graph: SIGTERM all running workers and mark them failed.',
    inputSchema: { graph_id: z.string().min(1) },
  },
  async ({ graph_id }) => {
    const graph = await resolveGraph(graph_id);
    if (!graph) {
      return { isError: true, content: [{ type: 'text', text: `Unknown graph_id: ${graph_id}` }] };
    }

    cancelExecution(graph);

    return {
      content: [{ type: 'text', text: 'Execution cancelled.' }],
      structuredContent: { graph_id: graph.id, nodes: graph.nodes.map(nodeSummary) },
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
