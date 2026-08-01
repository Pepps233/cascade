import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { CascadeGraph, CascadeNode } from './graph.js';

const CASCADE_DIR = '.cascade';
const GRAPHS_DIR = 'graphs';
const LOGS_DIR = 'logs';

export interface ChangeEvent {
  graphId: string;
  changedNodes: CascadeNode[];
  allTerminal: boolean;
}

class GraphEvents extends EventEmitter {}

export const graphEvents = new GraphEvents();

export function emitChange(event: ChangeEvent): void {
  graphEvents.emit('change', event);
}

function graphsRoot(cwd: string): string {
  return path.join(cwd, CASCADE_DIR, GRAPHS_DIR);
}

export function logsRoot(cwd: string): string {
  return path.join(cwd, CASCADE_DIR, LOGS_DIR);
}

export function logPath(cwd: string, nodeId: string): string {
  return path.join(logsRoot(cwd), `${nodeId}.log`);
}

function graphPath(cwd: string, graphId: string): string {
  return path.join(graphsRoot(cwd), `${graphId}.json`);
}

export async function saveGraph(graph: CascadeGraph): Promise<void> {
  await mkdir(graphsRoot(graph.cwd), { recursive: true });
  await mkdir(logsRoot(graph.cwd), { recursive: true });
  await writeFile(graphPath(graph.cwd, graph.id), JSON.stringify(graph, null, 2), 'utf8');
}

export async function loadGraph(cwd: string, graphId: string): Promise<CascadeGraph | null> {
  try {
    const raw = await readFile(graphPath(cwd, graphId), 'utf8');
    return JSON.parse(raw) as CascadeGraph;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function listGraphIds(cwd: string): Promise<string[]> {
  try {
    const files = await readdir(graphsRoot(cwd));
    return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') return [];
    throw err;
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err;
}

// In-memory registry of graphs currently held by this server process, keyed by id.
// The JSON file is the durable copy; this is the working copy mutated by the scheduler.
const liveGraphs = new Map<string, CascadeGraph>();

export function registerLiveGraph(graph: CascadeGraph): void {
  liveGraphs.set(graph.id, graph);
}

export function getLiveGraph(graphId: string): CascadeGraph | undefined {
  return liveGraphs.get(graphId);
}

export function allLiveGraphs(): CascadeGraph[] {
  return [...liveGraphs.values()];
}
