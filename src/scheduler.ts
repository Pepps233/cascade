import type { CascadeGraph, CascadeNode } from './graph.js';
import { allTerminal, composePrompt, recomputeReadiness } from './graph.js';
import { killWorker, spawnWorker } from './adapters.js';
import { emitChange, saveGraph } from './store.js';

const DEFAULT_CONCURRENCY = 4;

interface SchedulerState {
  running: Set<string>;
  maxConcurrency: number;
}

const stateByGraph = new Map<string, SchedulerState>();

export function startExecution(graph: CascadeGraph, maxConcurrency = DEFAULT_CONCURRENCY): void {
  if (!stateByGraph.has(graph.id)) {
    stateByGraph.set(graph.id, { running: new Set(), maxConcurrency });
  } else {
    stateByGraph.get(graph.id)!.maxConcurrency = maxConcurrency;
  }

  const changed = recomputeReadiness(graph);
  if (changed.length > 0) void persistAndEmit(graph, changed);

  dispatchReady(graph);
}

function dispatchReady(graph: CascadeGraph): void {
  const state = stateByGraph.get(graph.id);
  if (!state) return;

  const readyNodes = graph.nodes.filter((n) => n.state === 'ready');
  const slots = state.maxConcurrency - state.running.size;
  const toDispatch = readyNodes.slice(0, Math.max(0, slots));

  for (const node of toDispatch) {
    dispatchNode(graph, node, state);
  }
}

function dispatchNode(graph: CascadeGraph, node: CascadeNode, state: SchedulerState): void {
  node.state = 'running';
  node.startedAt = Date.now();
  state.running.add(node.id);

  void persistAndEmit(graph, [node]);

  const prompt = composePrompt(graph, node);

  spawnWorker(node, prompt, graph.cwd)
    .then((outcome) => {
      node.endedAt = Date.now();
      if (outcome.error) {
        node.state = 'failed';
        node.error = outcome.error;
      } else {
        node.state = 'done';
        node.result = outcome.result;
      }
    })
    .catch((err: unknown) => {
      node.endedAt = Date.now();
      node.state = 'failed';
      node.error = err instanceof Error ? err.message : String(err);
    })
    .finally(() => {
      state.running.delete(node.id);
      const changed = [node, ...recomputeReadiness(graph)];
      void persistAndEmit(graph, changed);
      dispatchReady(graph);
    });
}

async function persistAndEmit(graph: CascadeGraph, changedNodes: CascadeNode[]): Promise<void> {
  await saveGraph(graph);
  emitChange({
    graphId: graph.id,
    changedNodes,
    allTerminal: allTerminal(graph) && isIdle(graph.id),
  });
}

function isIdle(graphId: string): boolean {
  const state = stateByGraph.get(graphId);
  return !state || state.running.size === 0;
}

export function cancelExecution(graph: CascadeGraph): void {
  const state = stateByGraph.get(graph.id);
  if (!state) return;

  for (const node of graph.nodes) {
    if (node.state === 'running') {
      killWorker(node.id);
      node.state = 'failed';
      node.error = 'cancelled';
      node.endedAt = Date.now();
    }
  }
  state.running.clear();
  void persistAndEmit(graph, graph.nodes.filter((n) => n.error === 'cancelled'));
}

export function isGraphRunning(graphId: string): boolean {
  const state = stateByGraph.get(graphId);
  return !!state && state.running.size > 0;
}
