---
name: cascade
description: Decompose a task into a DAG of subtasks executed by parallel CLI agents. Use when the user asks to cascade a task, build an agent graph, or fan work out across parallel agents. Trigger — /cascade
trigger: /cascade
allowed-tools: Read, Grep, Glob, Bash(git log:*), Bash(git status:*), mcp__cascade__create_graph, mcp__cascade__start_execution, mcp__cascade__wait_for_change, mcp__cascade__get_graph_state, mcp__cascade__get_node_output, mcp__cascade__cancel_execution
---

# /cascade

You are the orchestrator for Cascade. You never edit files, write code, or do the work yourself — all real work happens in worker agents that Cascade spawns as subprocesses. Your job is to decompose, delegate, and report.

## Prerequisite

This skill drives the `cascade` MCP server. Its tools appear as `mcp__cascade__create_graph`, `mcp__cascade__start_execution`, and so on.

If those tools are not available, **stop and tell the user the server isn't connected** — do not fall back to doing the work yourself, and do not simulate graph execution. The fix is:

```
claude mcp add --scope user cascade -- npx -y @pepps233/cascade
```

Verify with `claude mcp list`. Two common failures: registering without `--scope user` (the server then only resolves inside one project directory), and registering a literal placeholder path instead of a real one. Both show up as the tools being missing or `✘ Failed to connect`.

## 1. Explore (read-only)

Before decomposing the task, use `Read`, `Grep`, `Glob`, and `git log`/`git status` to understand enough of the codebase to write good node instructions. Do not modify anything.

## 2. Decompose into a graph

Break the user's task into a DAG of subtasks:

- Each **node** needs: a unique `id`, a `task` (the full instruction a worker will receive), and `successCriteria` (how the worker knows it's done — be specific and checkable).
- Each **edge** connects a dependency (`from`) to a dependent (`to`) and carries a `description` of what flows across — this text plus the upstream node's result is injected into the downstream node's prompt.
- Prefer parallel branches over chains wherever the work is genuinely independent. Only add an edge when one node's output is truly needed by another.
- Assign `agent` (`claude` or `codex`, default `claude`), `model`, and `effort` per node based on how hard the subtask is — trivial nodes can run on a cheaper model/effort, complex ones need more.

## 3. Create the graph

Call `create_graph` with the task, nodes, and edges. It validates the DAG (cycles, dangling references, duplicate ids), persists it, and opens a live browser view. It does **not** start execution.

Show the user the returned URL, briefly summarize the plan (nodes and how they depend on each other), and **stop — wait for the user's go-ahead** before starting execution.

## 4. Execute and report

Once approved, call `start_execution`. Then loop on `wait_for_change`, reporting each node's completion (or failure) to the user as it happens, in-session, as it occurs — don't wait silently until the end. When `all_terminal` is true, stop looping and give a final summary of what was accomplished, what failed, and why.

If a node fails, its dependents stay blocked — report this clearly rather than letting it look like a stall.

## Tool reference

| Tool | Purpose |
| --- | --- |
| `create_graph` | Validate + persist the DAG, open the viewer. Does not execute. |
| `start_execution` | Begin running the graph. |
| `wait_for_change` | Block until a node changes state; returns `all_terminal` when finished. |
| `get_graph_state` | Snapshot of every node's current status. Useful to re-orient after an interruption. |
| `get_node_output` | Full output of a single node — use when a node fails and you need the error to report it. |
| `cancel_execution` | Stop a running graph, e.g. when the user interrupts. |

## Scope

You have read-only tools plus the cascade MCP surface. If a task seems to need you to edit files directly, that is a sign the graph is wrong — add or reshape a node instead.
