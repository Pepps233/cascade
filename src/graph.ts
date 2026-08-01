export type NodeState = 'pending' | 'ready' | 'running' | 'done' | 'failed';

export type AgentKind = 'claude' | 'codex';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface CascadeNode {
  id: string;
  task: string;
  successCriteria: string;
  state: NodeState;
  agent?: AgentKind;
  model?: string;
  effort?: Effort;
  result?: string;
  error?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface CascadeEdge {
  from: string;
  to: string;
  description: string;
}

export interface CascadeGraph {
  id: string;
  task: string;
  cwd: string;
  nodes: CascadeNode[];
  edges: CascadeEdge[];
  createdAt: number;
}

export interface GraphValidationError {
  reason: 'cycle' | 'dangling_edge' | 'duplicate_id';
  detail: string;
}

export function validateGraph(
  nodes: Pick<CascadeNode, 'id'>[],
  edges: CascadeEdge[],
): GraphValidationError | null {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) {
      return { reason: 'duplicate_id', detail: `duplicate node id: ${node.id}` };
    }
    ids.add(node.id);
  }

  for (const edge of edges) {
    if (!ids.has(edge.from)) {
      return { reason: 'dangling_edge', detail: `edge references unknown node: ${edge.from}` };
    }
    if (!ids.has(edge.to)) {
      return { reason: 'dangling_edge', detail: `edge references unknown node: ${edge.to}` };
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const id of ids) adjacency.set(id, []);
  for (const edge of edges) {
    adjacency.get(edge.from)!.push(edge.to);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of ids) color.set(id, WHITE);

  const cyclePath: string[] = [];

  function visit(id: string): boolean {
    color.set(id, GRAY);
    cyclePath.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const c = color.get(next);
      if (c === GRAY) {
        cyclePath.push(next);
        return true;
      }
      if (c === WHITE && visit(next)) {
        return true;
      }
    }
    cyclePath.pop();
    color.set(id, BLACK);
    return false;
  }

  for (const id of ids) {
    if (color.get(id) === WHITE && visit(id)) {
      return { reason: 'cycle', detail: `cycle detected: ${cyclePath.join(' -> ')}` };
    }
  }

  return null;
}

/** Recompute pending -> ready transitions in place. A node already running/done/failed is untouched. */
export function recomputeReadiness(graph: CascadeGraph): CascadeNode[] {
  const stateById = new Map(graph.nodes.map((n) => [n.id, n.state]));
  const inboundByNode = new Map<string, CascadeEdge[]>();
  for (const edge of graph.edges) {
    if (!inboundByNode.has(edge.to)) inboundByNode.set(edge.to, []);
    inboundByNode.get(edge.to)!.push(edge);
  }

  const changed: CascadeNode[] = [];
  for (const node of graph.nodes) {
    if (node.state !== 'pending') continue;
    const inbound = inboundByNode.get(node.id) ?? [];
    const blocked = inbound.some((e) => stateById.get(e.from) === 'failed');
    if (blocked) continue;
    const allDone = inbound.every((e) => stateById.get(e.from) === 'done');
    if (allDone) {
      node.state = 'ready';
      changed.push(node);
    }
  }
  return changed;
}

/** Compose the worker prompt for a node from its task, success criteria, and upstream context. */
export function composePrompt(graph: CascadeGraph, node: CascadeNode): string {
  const inboundEdges = graph.edges.filter((e) => e.to === node.id);
  const parts: string[] = [];

  parts.push(`Task: ${node.task}`);
  parts.push(`Success criteria: ${node.successCriteria}`);

  if (inboundEdges.length > 0) {
    parts.push('Context from upstream work:');
    for (const edge of inboundEdges) {
      const upstream = graph.nodes.find((n) => n.id === edge.from);
      parts.push(`- ${edge.description}\n  Result: ${upstream?.result ?? '(no result recorded)'}`);
    }
  }

  return parts.join('\n\n');
}

export function isTerminal(state: NodeState): boolean {
  return state === 'done' || state === 'failed';
}

export function allTerminal(graph: CascadeGraph): boolean {
  return graph.nodes.every((n) => isTerminal(n.state) || n.state === 'pending' && isPermanentlyBlocked(graph, n));
}

function isPermanentlyBlocked(graph: CascadeGraph, node: CascadeNode): boolean {
  const inbound = graph.edges.filter((e) => e.to === node.id);
  return inbound.some((e) => {
    const upstream = graph.nodes.find((n) => n.id === e.from);
    return upstream?.state === 'failed';
  });
}
