export function renderViewerPage(graphId: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cascade — ${escapeHtml(graphId)}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff;
    --fg: #1a1a1a;
    --muted: #6b7280;
    --border: #e5e7eb;
    --panel: #f9fafb;
    --pending: #9ca3af;
    --ready: #3b82f6;
    --running: #f59e0b;
    --done: #10b981;
    --failed: #ef4444;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1115;
      --fg: #e5e7eb;
      --muted: #9ca3af;
      --border: #2a2e37;
      --panel: #171a21;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: var(--bg);
    color: var(--fg);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
  }
  header h1 { font-size: 15px; font-weight: 600; margin: 0; }
  header .task { color: var(--muted); font-size: 13px; margin-top: 2px; }
  .legend { display: flex; gap: 14px; font-size: 12px; color: var(--muted); }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .counts { font-size: 12px; color: var(--muted); }
  #canvas-wrap { position: relative; overflow: auto; height: calc(100vh - 60px); }
  svg#edges { position: absolute; top: 0; left: 0; pointer-events: none; }
  .node {
    position: absolute;
    width: 200px;
    border: 1.5px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    padding: 10px 12px;
    cursor: pointer;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .node:hover { box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
  .node .id { font-weight: 600; font-size: 13px; margin-bottom: 4px; word-break: break-word; }
  .node .task { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .node .state-badge {
    display: inline-block;
    margin-top: 6px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .state-pending { border-color: var(--pending); }
  .state-ready { border-color: var(--ready); }
  .state-running { border-color: var(--running); animation: pulse 1.4s ease-in-out infinite; }
  .state-done { border-color: var(--done); }
  .state-failed { border-color: var(--failed); }
  .state-badge.state-pending { background: color-mix(in srgb, var(--pending) 20%, transparent); color: var(--pending); }
  .state-badge.state-ready { background: color-mix(in srgb, var(--ready) 20%, transparent); color: var(--ready); }
  .state-badge.state-running { background: color-mix(in srgb, var(--running) 20%, transparent); color: var(--running); }
  .state-badge.state-done { background: color-mix(in srgb, var(--done) 20%, transparent); color: var(--done); }
  .state-badge.state-failed { background: color-mix(in srgb, var(--failed) 20%, transparent); color: var(--failed); }
  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--running) 45%, transparent); }
    50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--running) 0%, transparent); }
  }
  #panel {
    position: fixed;
    top: 0;
    right: 0;
    width: 360px;
    height: 100vh;
    background: var(--panel);
    border-left: 1px solid var(--border);
    padding: 20px;
    transform: translateX(100%);
    transition: transform 0.2s ease;
    overflow-y: auto;
    font-size: 13px;
  }
  #panel.open { transform: translateX(0); }
  #panel h2 { font-size: 14px; margin: 0 0 12px; }
  #panel .field { margin-bottom: 14px; }
  #panel .field label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin-bottom: 4px; }
  #panel .field pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: inherit; font-size: 12.5px; }
  #panel .close { position: absolute; top: 16px; right: 16px; cursor: pointer; background: none; border: none; color: var(--muted); font-size: 18px; }
</style>
</head>
<body>
<header>
  <div>
    <h1 id="task-title">Cascade</h1>
    <div class="task" id="task-desc"></div>
  </div>
  <div class="legend">
    <span><i class="dot" style="background:var(--pending)"></i>pending</span>
    <span><i class="dot" style="background:var(--ready)"></i>ready</span>
    <span><i class="dot" style="background:var(--running)"></i>running</span>
    <span><i class="dot" style="background:var(--done)"></i>done</span>
    <span><i class="dot" style="background:var(--failed)"></i>failed</span>
  </div>
  <div class="counts" id="counts"></div>
</header>
<div id="canvas-wrap">
  <svg id="edges"></svg>
  <div id="nodes"></div>
</div>
<div id="panel">
  <button class="close" onclick="closePanel()">&times;</button>
  <h2 id="panel-id"></h2>
  <div class="field"><label>State</label><pre id="panel-state"></pre></div>
  <div class="field"><label>Task</label><pre id="panel-task"></pre></div>
  <div class="field"><label>Success criteria</label><pre id="panel-criteria"></pre></div>
  <div class="field" id="panel-result-wrap"><label>Result</label><pre id="panel-result"></pre></div>
  <div class="field" id="panel-error-wrap"><label>Error</label><pre id="panel-error"></pre></div>
</div>
<script>
const GRAPH_ID = ${JSON.stringify(graphId)};
const NODE_W = 200, NODE_H = 84, COL_GAP = 90, ROW_GAP = 20, PAD = 30;
let latest = null;

function depthOf(nodeId, edges, cache) {
  if (cache.has(nodeId)) return cache.get(nodeId);
  const inbound = edges.filter(e => e.to === nodeId);
  if (inbound.length === 0) { cache.set(nodeId, 0); return 0; }
  const d = 1 + Math.max(...inbound.map(e => depthOf(e.from, edges, cache)));
  cache.set(nodeId, d);
  return d;
}

function layout(nodes, edges) {
  const cache = new Map();
  const depths = new Map(nodes.map(n => [n.id, depthOf(n.id, edges, cache)]));
  const byCol = new Map();
  for (const n of nodes) {
    const d = depths.get(n.id);
    if (!byCol.has(d)) byCol.set(d, []);
    byCol.get(d).push(n);
  }
  const pos = new Map();
  for (const [col, colNodes] of byCol) {
    colNodes.forEach((n, i) => {
      pos.set(n.id, {
        x: PAD + col * (NODE_W + COL_GAP),
        y: PAD + i * (NODE_H + ROW_GAP),
      });
    });
  }
  return pos;
}

function render(data) {
  latest = data;
  const { nodes, edges, task } = data;
  document.getElementById('task-desc').textContent = task || '';
  const counts = { pending: 0, ready: 0, running: 0, done: 0, failed: 0 };
  for (const n of nodes) counts[n.state] = (counts[n.state] || 0) + 1;
  document.getElementById('counts').textContent =
    \`\${nodes.length} nodes · \${counts.done} done · \${counts.running} running · \${counts.failed} failed\`;

  const pos = layout(nodes, edges);
  const maxX = Math.max(0, ...[...pos.values()].map(p => p.x)) + NODE_W + PAD;
  const maxY = Math.max(0, ...[...pos.values()].map(p => p.y)) + NODE_H + PAD;

  const svg = document.getElementById('edges');
  svg.setAttribute('width', maxX);
  svg.setAttribute('height', maxY);
  svg.innerHTML = edges.map(e => {
    const from = pos.get(e.from), to = pos.get(e.to);
    if (!from || !to) return '';
    const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2;
    const x2 = to.x, y2 = to.y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    return \`<path d="M \${x1} \${y1} C \${mx} \${y1}, \${mx} \${y2}, \${x2} \${y2}" fill="none" stroke="var(--border)" stroke-width="1.5" />\`;
  }).join('');

  const container = document.getElementById('nodes');
  container.style.width = maxX + 'px';
  container.style.height = maxY + 'px';
  container.style.position = 'relative';
  container.innerHTML = nodes.map(n => {
    const p = pos.get(n.id);
    return \`<div class="node state-\${n.state}" style="left:\${p.x}px;top:\${p.y}px" onclick="openPanel('\${escapeAttr(n.id)}')">
      <div class="id">\${escapeHtml(n.id)}</div>
      <div class="task">\${escapeHtml(n.task)}</div>
      <span class="state-badge state-\${n.state}">\${n.state}</span>
    </div>\`;
  }).join('');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return String(s).replace(/'/g, "\\\\'"); }

function openPanel(nodeId) {
  const n = latest.nodes.find(x => x.id === nodeId);
  if (!n) return;
  document.getElementById('panel-id').textContent = n.id;
  document.getElementById('panel-state').textContent = n.state;
  document.getElementById('panel-task').textContent = n.task;
  document.getElementById('panel-criteria').textContent = n.successCriteria || '';
  const resultWrap = document.getElementById('panel-result-wrap');
  const errorWrap = document.getElementById('panel-error-wrap');
  if (n.result) {
    resultWrap.style.display = '';
    document.getElementById('panel-result').textContent = n.result;
  } else {
    resultWrap.style.display = 'none';
  }
  if (n.error) {
    errorWrap.style.display = '';
    document.getElementById('panel-error').textContent = n.error;
  } else {
    errorWrap.style.display = 'none';
  }
  document.getElementById('panel').classList.add('open');
}
function closePanel() { document.getElementById('panel').classList.remove('open'); }

document.getElementById('task-title').textContent = 'Cascade — ' + GRAPH_ID;

const source = new EventSource('/events/' + encodeURIComponent(GRAPH_ID));
source.onmessage = (evt) => {
  try { render(JSON.parse(evt.data)); } catch (e) { console.error(e); }
};
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
