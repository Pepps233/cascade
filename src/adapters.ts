import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CascadeNode } from './graph.js';
import { logPath } from './store.js';

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export interface WorkerOutcome {
  result?: string;
  error?: string;
}

// Tracks in-flight child processes by node id so cancelExecution can signal them.
const liveProcesses = new Map<string, ReturnType<typeof spawn>>();

export function killWorker(nodeId: string): boolean {
  const child = liveProcesses.get(nodeId);
  if (!child) return false;
  child.kill('SIGTERM');
  return true;
}

export async function spawnWorker(
  node: CascadeNode,
  prompt: string,
  cwd: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<WorkerOutcome> {
  const agent = node.agent ?? 'claude';
  return agent === 'codex'
    ? runCodex(node, prompt, cwd, timeoutMs)
    : runClaude(node, prompt, cwd, timeoutMs);
}

function buildClaudeArgs(node: CascadeNode, prompt: string): string[] {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--dangerously-skip-permissions',
  ];
  if (node.model) args.push('--model', node.model);
  if (node.effort) args.push('--effort', node.effort);
  return args;
}

function buildCodexArgs(node: CascadeNode, prompt: string, outFile: string): string[] {
  const args = [
    'exec',
    prompt,
    '--json',
    '--dangerously-bypass-approvals-and-sandbox',
    '-o',
    outFile,
  ];
  if (node.model) args.push('-m', node.model);
  if (node.effort) args.push('-c', `model_reasoning_effort="${node.effort}"`);
  return args;
}

async function runClaude(
  node: CascadeNode,
  prompt: string,
  cwd: string,
  timeoutMs: number,
): Promise<WorkerOutcome> {
  const args = buildClaudeArgs(node, prompt);
  const { stdout, code, timedOut, stderrTail } = await runProcess('claude', args, cwd, node.id, timeoutMs);

  if (timedOut) {
    return { error: `worker timed out after ${timeoutMs}ms` };
  }
  if (code !== 0) {
    return { error: `claude exited with code ${code}${stderrTail ? `: ${stderrTail}` : ''}` };
  }

  try {
    const parsed = JSON.parse(stdout) as { result?: string };
    return { result: parsed.result ?? stdout };
  } catch {
    return { result: stdout };
  }
}

async function runCodex(
  node: CascadeNode,
  prompt: string,
  cwd: string,
  timeoutMs: number,
): Promise<WorkerOutcome> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'cascade-codex-'));
  const outFile = path.join(tmpDir, `${node.id}.out`);
  try {
    const args = buildCodexArgs(node, prompt, outFile);
    const { code, timedOut, stderrTail } = await runProcess('codex', args, cwd, node.id, timeoutMs);

    if (timedOut) {
      return { error: `worker timed out after ${timeoutMs}ms` };
    }
    if (code !== 0) {
      return { error: `codex exited with code ${code}${stderrTail ? `: ${stderrTail}` : ''}` };
    }

    const result = await readFile(outFile, 'utf8').catch(() => '');
    return { result: result || undefined };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

interface ProcessResult {
  stdout: string;
  code: number | null;
  timedOut: boolean;
  stderrTail: string;
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  nodeId: string,
  timeoutMs: number,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd });
    liveProcesses.set(nodeId, child);
    const logStream = createWriteStream(logPath(cwd, nodeId), { flags: 'a' });

    let stdout = '';
    let stderrTail = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      logStream.write(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-2000);
      logStream.write(chunk);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      liveProcesses.delete(nodeId);
      logStream.end();
      resolve({ stdout, code, timedOut, stderrTail: stderrTail.trim() });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      liveProcesses.delete(nodeId);
      logStream.end();
      stderrTail = err.message;
      resolve({ stdout, code: -1, timedOut, stderrTail });
    });
  });
}

export { buildClaudeArgs, buildCodexArgs };
