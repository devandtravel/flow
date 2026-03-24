#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { createApiServer } from '../api/server';
import { ensureAgentDirectories, loadConfig, writeDefaultConfig } from '../config';
import { AgentRuntime } from '../core/loop/runtime';
import { attachCliRunProgress } from './progress';

const program = new Command();
const workspaceRoot = process.cwd();

function createRuntime(): AgentRuntime {
  const config = loadConfig(workspaceRoot);
  return new AgentRuntime({ workspaceRoot, config });
}

program.name('agent').description('FLOW installable agent runtime');

program
  .command('init')
  .option('--mode <mode>', 'project or system', 'project')
  .description('Create the runtime scaffold, config, policies, and directories')
  .action((options: { mode: 'project' | 'system' }) => {
    const configPath = writeDefaultConfig(workspaceRoot, options.mode);
    const directories = ensureAgentDirectories(workspaceRoot);
    console.log(
      JSON.stringify(
        {
          configPath,
          directories,
          mode: options.mode,
        },
        null,
        2,
      ),
    );
  });

program
  .command('run')
  .argument('<goal>', 'Goal to execute')
  .option('--target <targetId>', 'Configured target identifier')
  .description('Create and execute a task through the runtime loop')
  .action(async (goal: string, options: { target?: string }) => {
    const runtime = createRuntime();
    const task = runtime.createTask(goal, options.target);
    const detachProgress = attachCliRunProgress(task.id, (listener) => runtime.subscribe(listener));
    try {
      const summary = await runtime.runTask(task.id);
      console.log(JSON.stringify(summary, null, 2));
    } finally {
      detachProgress();
    }
  });

program
  .command('worker')
  .option('--once', 'Run one worker cycle and exit', false)
  .description('Run the queue worker loop')
  .action(async (options: { once: boolean }) => {
    const runtime = createRuntime();
    if (options.once) {
      const summary = await runtime.workOnce();
      console.log(JSON.stringify(summary ?? { status: 'idle' }, null, 2));
      return;
    }

    const controller = new AbortController();
    process.on('SIGINT', () => controller.abort());
    process.on('SIGTERM', () => controller.abort());
    await runtime.startWorkerLoop(controller.signal);
  });

program
  .command('daemon')
  .description('Start the REST API daemon')
  .action(async () => {
    const config = loadConfig(workspaceRoot);
    const api = createApiServer(workspaceRoot);
    await api.start({ worker: true });
    console.log(
      JSON.stringify(
        {
          status: 'listening',
          host: config.server.host,
          port: config.server.port,
          uiUrl: `http://${config.server.host}:${String(config.server.port)}/`,
          worker: 'started',
        },
        null,
        2,
      ),
    );
  });

program
  .command('approve')
  .argument('<approval_id>', 'Approval identifier')
  .description('Approve a pending approval request')
  .action((approvalId: string) => {
    const runtime = createRuntime();
    console.log(JSON.stringify(runtime.approve(approvalId), null, 2));
  });

program
  .command('reject')
  .argument('<approval_id>', 'Approval identifier')
  .description('Reject a pending approval request')
  .action((approvalId: string) => {
    const runtime = createRuntime();
    console.log(JSON.stringify(runtime.reject(approvalId), null, 2));
  });

program
  .command('status')
  .description('Print task, approval, target, and metric status')
  .action(() => {
    const runtime = createRuntime();
    console.log(
      JSON.stringify(
        {
          tasks: runtime.listTasks(),
          approvals: runtime.listApprovals(),
          targets: runtime.listTargets(),
          metrics: runtime.metrics.snapshot(),
        },
        null,
        2,
      ),
    );
  });

program
  .command('logs')
  .description('Print the runtime log file contents')
  .action(() => {
    const logsPath = path.join(workspaceRoot, '.agent', 'logs', 'runtime.log');
    const output = existsSync(logsPath) ? readFileSync(logsPath, 'utf8') : '';
    console.log(output);
  });

program
  .command('tasks')
  .description('List tasks from the runtime database')
  .action(() => {
    const runtime = createRuntime();
    console.log(JSON.stringify(runtime.listTasks(), null, 2));
  });

program
  .command('inspect')
  .argument('<task_id>', 'Task identifier')
  .description('Inspect a task, its runs, and steps')
  .action((taskId: string) => {
    const runtime = createRuntime();
    console.log(JSON.stringify(runtime.inspectTask(taskId), null, 2));
  });

program
  .command('timeline')
  .argument('<task_id>', 'Task identifier')
  .option('--limit <count>', 'How many runs to include', '20')
  .option('--offset <count>', 'How many runs to skip', '0')
  .description('Print the task timeline, including runs, events, evaluations, and approvals')
  .action((taskId: string, options: { limit: string; offset: string }) => {
    const runtime = createRuntime();
    console.log(
      JSON.stringify(
        runtime.getTaskTimeline(taskId, {
          limit: Number(options.limit),
          offset: Number(options.offset),
        }),
        null,
        2,
      ),
    );
  });

program
  .command('run-events')
  .argument('<run_id>', 'Run identifier')
  .option('--limit <count>', 'How many events to include', '50')
  .option('--offset <count>', 'How many events to skip', '0')
  .option('--level <level>', 'Filter events by level')
  .description('List paginated run events for a single run')
  .action((runId: string, options: { limit: string; offset: string; level?: 'info' | 'warning' | 'error' }) => {
    const runtime = createRuntime();
    console.log(
      JSON.stringify(
        runtime.getRunEvents(runId, {
          limit: Number(options.limit),
          offset: Number(options.offset),
        }, {
          level: options.level,
        }),
        null,
        2,
      ),
    );
  });

program
  .command('approvals')
  .description('List approval requests')
  .action(() => {
    const runtime = createRuntime();
    console.log(JSON.stringify(runtime.listApprovals(), null, 2));
  });

program
  .command('targets')
  .description('List configured targets')
  .action(() => {
    const runtime = createRuntime();
    console.log(JSON.stringify(runtime.listTargets(), null, 2));
  });

program
  .command('target-show')
  .argument('<target_id>', 'Target identifier')
  .description('Show a single target contour')
  .action((targetId: string) => {
    const runtime = createRuntime();
    console.log(JSON.stringify(runtime.getTarget(targetId), null, 2));
  });

program
  .command('target-add')
  .requiredOption('--id <targetId>', 'Target identifier')
  .requiredOption('--root <root>', 'Target workspace root')
  .requiredOption('--read-path <path...>', 'Readable paths for the target')
  .requiredOption('--write-path <path...>', 'Writable paths for the target')
  .requiredOption('--capability <capability...>', 'Enabled capabilities for the target')
  .description('Create or update a target contour')
  .action((options: {
    id: string;
    root: string;
    readPath: string[];
    writePath: string[];
    capability: Array<
      'fs.read' | 'fs.write' | 'git.status' | 'git.branch' | 'git.commit' | 'repo.search' | 'repo.test' | 'repo.build' | 'repo.check' | 'repo.patch' | 'http.fetch' | 'shell.exec'
    >;
  }) => {
    const runtime = createRuntime();
    console.log(
      JSON.stringify(
        runtime.upsertTarget({
          id: options.id,
          root: options.root,
          read_paths: options.readPath,
          write_paths: options.writePath,
          capabilities: options.capability,
        }),
        null,
        2,
      ),
    );
  });

program
  .command('target-remove')
  .argument('<target_id>', 'Target identifier')
  .description('Remove a target contour when it has no task history')
  .action((targetId: string) => {
    const runtime = createRuntime();
    runtime.deleteTarget(targetId);
    console.log(JSON.stringify({ id: targetId, deleted: true }, null, 2));
  });

program
  .command('schedules')
  .description('List registered schedules')
  .action(() => {
    const runtime = createRuntime();
    console.log(JSON.stringify(runtime.listSchedules(), null, 2));
  });

program
  .command('cleanup')
  .option('--keep-latest-artifacts <count>', 'How many newest artifacts to retain')
  .option('--keep-latest-run-events <count>', 'How many newest run events to retain')
  .option('--keep-latest-memory-entries <count>', 'How many newest memory entries to retain')
  .option('--max-artifact-age-days <days>', 'Delete artifacts older than N days')
  .option('--max-run-event-age-days <days>', 'Delete run events older than N days')
  .option('--max-memory-entry-age-days <days>', 'Delete memory entries older than N days')
  .option('--dry-run', 'Preview cleanup without deleting rows or files', false)
  .description('Clean up old artifacts, run events, and memory entries')
  .action((options: {
    keepLatestArtifacts?: string;
    keepLatestRunEvents?: string;
    keepLatestMemoryEntries?: string;
    maxArtifactAgeDays?: string;
    maxRunEventAgeDays?: string;
    maxMemoryEntryAgeDays?: string;
    dryRun: boolean;
  }) => {
    const runtime = createRuntime();
    const parseCount = (value: string | undefined): number | undefined => {
      if (value === undefined) {
        return undefined;
      }

      return Number(value);
    };
    const parseNullableCount = (value: string | undefined): number | null | undefined => {
      if (value === undefined) {
        return undefined;
      }

      return Number(value);
    };
    console.log(
      JSON.stringify(
        runtime.cleanupState({
          keepLatestArtifacts: parseCount(options.keepLatestArtifacts),
          keepLatestRunEvents: parseCount(options.keepLatestRunEvents),
          keepLatestMemoryEntries: parseCount(options.keepLatestMemoryEntries),
          maxArtifactAgeDays: parseNullableCount(options.maxArtifactAgeDays),
          maxRunEventAgeDays: parseNullableCount(options.maxRunEventAgeDays),
          maxMemoryEntryAgeDays: parseNullableCount(options.maxMemoryEntryAgeDays),
          dryRun: options.dryRun,
          trigger: 'cli_manual',
        }),
        null,
        2,
      ),
    );
  });

program
  .command('maintenance-run-due')
  .description('Run scheduled maintenance if the configured cleanup interval is due')
  .action(() => {
    const runtime = createRuntime();
    console.log(JSON.stringify(runtime.runDueMaintenance({ trigger: 'cli_run_due' }) ?? { status: 'idle' }, null, 2));
  });

program
  .command('maintenance-status')
  .description('Show the current maintenance policy status for cleanup')
  .action(() => {
    const runtime = createRuntime();
    console.log(JSON.stringify(runtime.getMaintenanceStatus(), null, 2));
  });

program
  .command('maintenance-summary')
  .description('Show a UI-friendly summary of maintenance activity and trigger sources')
  .action(() => {
    const runtime = createRuntime();
    console.log(JSON.stringify(runtime.getMaintenanceSummary(), null, 2));
  });

program
  .command('maintenance-events')
  .option('--limit <count>', 'How many maintenance events to include', '20')
  .option('--offset <count>', 'How many maintenance events to skip', '0')
  .option('--operation <operation>', 'Filter maintenance events by operation')
  .option('--dry-run <value>', 'Filter maintenance events by dry-run mode')
  .option('--trigger <trigger>', 'Filter maintenance events by trigger source')
  .description('List paginated maintenance audit events')
  .action((options: {
    limit: string;
    offset: string;
    operation?: 'cleanup';
    dryRun?: string;
    trigger?: 'manual' | 'api_manual' | 'cli_manual' | 'worker_due' | 'api_run_due' | 'cli_run_due';
  }) => {
    const runtime = createRuntime();
    console.log(
      JSON.stringify(
        runtime.listMaintenanceEvents({
          limit: Number(options.limit),
          offset: Number(options.offset),
        }, {
          operation: options.operation,
          dryRun: options.dryRun === undefined ? undefined : options.dryRun === 'true',
          trigger: options.trigger,
        }),
        null,
        2,
      ),
    );
  });

program.parseAsync(process.argv);
