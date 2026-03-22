# FLOW Agent Runtime

FLOW is an installable, tool-first agent runtime for deterministic task execution inside a project contour or a host-level system contour.

## What It Now Provides

- First-class runtime contours: `project` and `system`
- Structured runtime config with `scope`, `targets`, `capabilities`, `policies`, `autonomy`, `approvals`, `schedules`, `llm`, `maintenance`, and `limits`
- Typed task, run, step, artifact, approval, schedule, target, and memory records
- Bounded tool registry with capability-aware execution and workspace boundaries
- Policy engine with allowlists, deny patterns, approval gates, and runtime limits
- Approval queue and resume flow for sensitive steps
- Worker loop plus REST daemon
- LLM provider layer with `codex` and `mock` providers
- SQLite persistence for tasks, runs, steps, approvals, schedules, targets, events, memory, and evaluations

## Threat Model

- `shell.exec` exists as an optional capability, but it is disabled by default
- `supervised` mode is the default autonomy mode
- steps can only run through bounded tools
- file reads and writes are constrained by configured workspace boundaries
- outbound HTTP is constrained by hostname allowlists

## Quick Start

```bash
corepack prepare pnpm@9.15.4 --activate
pnpm install
pnpm build
node dist/packages/cli/index.js init --mode project
node dist/packages/cli/index.js run "write project output"
node dist/packages/cli/index.js worker --once
```

## Launch

Горизонт запуска зафиксирован в [LAUNCH.md](/Users/devandtravel/projects/flow/LAUNCH.md).

Минимальный launch gate:

```bash
pnpm lint
pnpm test
pnpm build
pnpm smoke
```

Безопасная репетиция запуска:

```bash
pnpm launch:project
```

## CLI

- `agent init --mode project|system`
- `agent run "<goal>" [--target <targetId>]`
- `agent worker [--once]`
- `agent daemon`
- `agent approve <approval_id>`
- `agent reject <approval_id>`
- `agent tasks`
- `agent inspect <task_id>`
- `agent timeline <task_id> [--limit <count>] [--offset <count>]`
- `agent run-events <run_id> [--limit <count>] [--offset <count>] [--level info|warning|error]`
- `agent approvals`
- `agent targets`
- `agent target-show <target_id>`
- `agent target-add --id <id> --root <root> --read-path . --write-path . --capability fs.read ...`
- `agent target-remove <target_id>`
- `agent schedules`
- `agent cleanup [--keep-latest-artifacts <count>] [--keep-latest-run-events <count>] [--keep-latest-memory-entries <count>] [--max-artifact-age-days <days>] [--max-run-event-age-days <days>] [--max-memory-entry-age-days <days>] [--dry-run]`
- `agent maintenance-run-due`
- `agent maintenance-status`
- `agent maintenance-summary`
- `agent maintenance-events [--limit <count>] [--offset <count>] [--operation cleanup] [--dry-run true|false] [--trigger manual|api_manual|cli_manual|worker_due|api_run_due|cli_run_due]`
- `agent status`
- `agent logs`

## API

- `POST /tasks`
- `GET /tasks`
- `GET /tasks/:id`
- `GET /tasks/:id/timeline?limit=<count>&offset=<count>`
- `GET /runs/:id`
- `GET /runs/:id/events?limit=<count>&offset=<count>&level=info|warning|error`
- `GET /artifacts/:id`
- `GET /approvals`
- `POST /approvals/:id/approve`
- `POST /approvals/:id/reject`
- `GET /targets`
- `GET /targets/:id`
- `POST /targets`
- `DELETE /targets/:id`
- `GET /schedules`
- `POST /schedules`
- `POST /worker/run-once`
- `POST /maintenance/cleanup`
  - accepts optional `keepLatestArtifacts`, `keepLatestRunEvents`, `keepLatestMemoryEntries`, `maxArtifactAgeDays`, `maxRunEventAgeDays`, `maxMemoryEntryAgeDays`, and `dryRun`
- `POST /maintenance/run-due`
- `GET /maintenance/status`
- `GET /maintenance/summary`
- `GET /maintenance/events?limit=<count>&offset=<count>&operation=cleanup&dryRun=true|false&trigger=manual|api_manual|cli_manual|worker_due|api_run_due|cli_run_due`
- `GET /metrics`
- `GET /health`

## Configuration Shape

`agent init` writes `.agent/config.yaml` with these top-level sections:

```yaml
mode: project
scope:
  root: .
workspace:
  root: .
  read_paths:
    - .
  write_paths:
    - .
targets:
  - id: local
    root: .
    read_paths:
      - .
    write_paths:
      - .
    capabilities:
      - fs.read
      - fs.write
      - git.status
      - repo.test
capabilities:
  enabled:
    - fs.read
    - fs.write
policies:
  allow_tools:
    - fs.*
    - git.*
    - repo.*
    - http.fetch
  deny_patterns:
    - rm -rf
  require_approval:
    tools:
      - git.commit
      - shell.exec
    capabilities:
      - shell.exec
autonomy:
  mode: supervised
approvals:
  required_for:
    tools:
      - git.commit
schedules: []
llm:
  provider: codex
  model: gpt-5-codex
maintenance:
  retention:
    keep_latest_artifacts: 100
    keep_latest_run_events: 200
    keep_latest_memory_entries: 200
    max_artifact_age_days: null
    max_run_event_age_days: null
    max_memory_entry_age_days: null
  cleanup:
    dry_run_default: false
    interval_seconds: null
```

## Contours

### Project

- runtime lives inside one repository
- local target defaults to the current workspace
- ideal for safe, repo-scoped automation

### System

- runtime lives as a daemon on the host
- every task runs inside an explicit target workspace
- schedules can enqueue recurring tasks for those targets

## Installation

### Project contour

```bash
pnpm build
./scripts/install.sh /opt/flow-agent project
```

### System contour

```bash
pnpm build
sudo ./scripts/install.sh /opt/flow-agent system flow-agent
sudo systemctl start flow-agent
```

## Testing

```bash
pnpm lint
pnpm test
pnpm build
```
