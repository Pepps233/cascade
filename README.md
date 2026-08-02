<p align="center">
  <img src="https://raw.githubusercontent.com/Pepps233/cascade/main/assets/cascade.png" alt="Cascade" width="480">
</p>

<h1 align="center">Cascade</h1>

You describe a task from inside Claude Code or Codex. Cascade breaks it into a dependency graph of smaller subtasks, then runs as many of them at once as their dependencies allow, each one handled by its own CLI agent process. You watch it happen live in a browser tab, and your main session reports progress back to you as pieces finish.

Context is assembled per node and all information flows back to your main session.

<img width="842" height="523" alt="Screenshot 2026-08-01 at 4 54 50 PM" src="https://github.com/user-attachments/assets/d3cfe61b-fa62-40da-a9d9-39449bd25bba" />

<h2 align="center">Why Cascade</h2>

Cascade is built on the principles of graph engineering: the idea that agent work should be described as a graph of bounded nodes and typed edges, not forced through a single linear stack.

A linear workflow — one step unlocking the next — works fine when every step genuinely depends on the one before it. But most real tasks aren't that tidy. They contain work that could run in parallel, evidence that would overload a single context window if crammed into one pass, and checkpoints that need precise placement rather than one fixed spot in a queue. Forcing that shape into a line either serializes work that didn't need to wait, or overloads a single model call with everything at once.

A graph fixes this by giving each unit of work a boundary. A node has a clear task and explicit success criteria, so it can be validated and retried on its own without rerunning everything around it. An edge carries meaning, not just order — it says what evidence or result actually needs to cross from one node to the next, so downstream work receives exactly the context it needs and nothing it doesn't. Independent branches run concurrently because nothing in the graph says they have to wait, and a failure on one branch stays contained to the work that actually depended on it.

This is what lets Cascade fan a task out across parallel CLI agents instead of one long serial run: the graph decides what's ready, what's blocked, and what context moves where, so the model doing the work always sees a scoped slice of the problem instead of an ever-growing prompt.

<h2 align="center">Cascade MCP</h2>

Cascade runs as a local MCP server over stdio. It holds no model access of its own — it validates graphs, schedules work, and shells out to the `claude` and `codex` CLIs already configured on your machine, using whatever models and permissions those CLIs already have.

Register it once with either host. No clone or build required — `npx` fetches the published package on first run:

```bash
claude mcp add --scope user cascade -- npx -y @pepps233/cascade
codex mcp add cascade -- npx -y @pepps233/cascade
```

`--scope user` matters: without it the server is registered against a single project directory and `/cascade` will silently have no tools anywhere else. Verify with `claude mcp list` — cascade should report `✔ Connected`.

To get the `/cascade` entry point, copy the skill into place:

```bash
mkdir -p ~/.claude/skills/cascade
curl -fsSL https://raw.githubusercontent.com/Pepps233/cascade/main/skills/cascade/SKILL.md \
  -o ~/.claude/skills/cascade/SKILL.md
```

The skill pre-approves the cascade tools for the turn it runs in, so the orchestration loop does not prompt for each call. For Codex, copy `commands/cascade-codex.md` to `~/.codex/prompts/cascade.md` instead. Both templates drive the same MCP tools, so behavior is identical regardless of which CLI you're driving the graph from.

### From source

```bash
git clone https://github.com/Pepps233/cascade.git && cd cascade
npm install && npm run build

claude mcp add --scope user cascade -- node "$(pwd)/dist/server.js"
```

The server starts a local viewer on the first free port from `7317` upward the moment a graph is created, and opens it in your browser automatically.

<h2 align="center">Tools</h2>

| Tool | What it does |
|---|---|
| `create_graph` | Validates a proposed graph (cycles, dangling edges, duplicate ids), persists it, and opens the live viewer. Does not start any work. |
| `start_execution` | Marks ready nodes and spawns their workers. Returns immediately — it does not wait for anything to finish. |
| `wait_for_change` | Blocks until a node changes state or a timeout elapses. This is what lets the orchestrating session report progress as it happens instead of polling or going silent. |
| `get_graph_state` | Returns an immediate snapshot: every node's state, truncated results, and counts. |
| `get_node_output` | Returns the full result and recent log output for a single node. |
| `cancel_execution` | Stops a running graph, terminating any workers still in flight. |
