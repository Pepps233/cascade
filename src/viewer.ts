import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { exec } from 'node:child_process';
import { renderViewerPage } from './viewer-page.js';
import { getLiveGraph } from './store.js';
import { graphEvents, type ChangeEvent } from './store.js';

const START_PORT = 7317;
const MAX_PORT_SCAN = 50;

let serverPort: number | null = null;

export function isViewerRunning(): boolean {
  return serverPort !== null;
}

export function viewerUrl(graphId: string): string {
  return `http://localhost:${serverPort}/g/${encodeURIComponent(graphId)}`;
}

export async function ensureViewer(): Promise<number> {
  if (serverPort !== null) return serverPort;
  serverPort = await startServer();
  return serverPort;
}

function snapshotPayload(graphId: string): string | null {
  const graph = getLiveGraph(graphId);
  if (!graph) return null;
  return JSON.stringify({
    task: graph.task,
    nodes: graph.nodes,
    edges: graph.edges,
  });
}

function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer(handleRequest);

    let attempt = 0;
    const tryListen = (port: number) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_SCAN) {
          attempt += 1;
          tryListen(port + 1);
        } else {
          reject(err);
        }
      });
      server.listen(port, () => {
        server.removeAllListeners('error');
        resolve(port);
      });
    };
    tryListen(START_PORT);
  });
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');

  const graphMatch = url.pathname.match(/^\/g\/([^/]+)$/);
  if (graphMatch) {
    const graphId = decodeURIComponent(graphMatch[1]);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderViewerPage(graphId));
    return;
  }

  const eventsMatch = url.pathname.match(/^\/events\/([^/]+)$/);
  if (eventsMatch) {
    const graphId = decodeURIComponent(eventsMatch[1]);
    handleSse(graphId, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}

function handleSse(graphId: string, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendSnapshot = () => {
    const payload = snapshotPayload(graphId);
    if (payload) res.write(`data: ${payload}\n\n`);
  };

  sendSnapshot();

  const onChange = (event: ChangeEvent) => {
    if (event.graphId !== graphId) return;
    sendSnapshot();
  };
  graphEvents.on('change', onChange);

  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25000);

  res.on('close', () => {
    clearInterval(keepAlive);
    graphEvents.off('change', onChange);
  });
}

export function openBrowser(url: string): void {
  if (process.platform === 'darwin') {
    exec(`open ${JSON.stringify(url)}`);
  }
}
