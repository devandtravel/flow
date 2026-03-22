# FLOW Agent Runtime

FLOW is a production-minded, installable, tool-first multi-agent runtime built with TypeScript, pnpm, Drizzle schema definitions, SQLite persistence, a deterministic execution loop, and a REST/CLI control surface.

## Features

- Multi-agent runtime roles: planner, critic, executor, verifier, supervisor, evaluator
- Deterministic task loop: Task → Plan → Validate → Execute → Verify → Store → Evaluate → Repeat
- Tool system with strict validation and no arbitrary shell by default
- Policy engine with allowlists, deny regexes, approval gates, and execution limits
- Persistent SQLite state for tasks, runs, steps, artifacts, memory, and evaluations
- REST API and commander-based CLI
- Structured pino logs, metrics, artifact files, Docker packaging, and systemd unit

## Quick start

```bash
corepack prepare pnpm@9.15.4 --activate
pnpm install
pnpm build
node dist/packages/cli/index.js init
node dist/packages/cli/index.js run "test task"
node dist/packages/cli/index.js daemon
```

## CLI

- `agent init`
- `agent run "<goal>"`
- `agent daemon`
- `agent status`
- `agent logs`
- `agent tasks`
- `agent inspect <task_id>`

## API

- `POST /tasks`
- `GET /tasks`
- `GET /tasks/:id`
- `GET /runs/:id`
- `GET /artifacts/:id`
- `GET /health`

## Configuration

Default project config is written to `.agent/config.yaml`:

```yaml
mode: project
workspace:
  root: .
llm:
  provider: codex
limits:
  max_steps: 20
```

## Testing

```bash
pnpm test
```

## Docker

Build and run:

```bash
docker build -f docker/Dockerfile -t flow-agent .
docker run --rm -p 4310:4310 -v $(pwd)/.agent:/app/.agent flow-agent
```
