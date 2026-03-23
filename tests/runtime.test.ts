import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDefaultConfig } from '../packages/config';
import { AgentRuntime } from '../packages/core/loop/runtime';
import { MockLlmProvider, type LlmProvider, type LlmRequest } from '../packages/llm';

class SequencedProvider implements LlmProvider {
  private readonly responses: readonly unknown[];
  private index = 0;

  constructor(responses: readonly unknown[]) {
    this.responses = responses;
  }

  async complete<TOutput>(request: LlmRequest<TOutput>): Promise<TOutput> {
    const response = this.responses[this.index];
    this.index += 1;
    return request.schema.parse(response);
  }
}

class DelayedMockProvider implements LlmProvider {
  constructor(private readonly delayMs: number) {}

  async complete<TOutput>(request: LlmRequest<TOutput>): Promise<TOutput> {
    await new Promise((resolve) => {
      setTimeout(resolve, this.delayMs);
    });

    const mockProvider = new MockLlmProvider();
    return mockProvider.complete(request);
  }
}

describe('AgentRuntime', () => {
  it('executes a project task with the mock provider and stores typed artifacts', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-project-'));
    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.llm.provider = 'mock';
    config.autonomy.mode = 'autonomous';
    const runtime = new AgentRuntime({ workspaceRoot, config });
    const task = runtime.createTask('write project output');

    const summary = await runtime.runTask(task.id);

    expect(summary.state).toBe('completed');
    expect(summary.artifacts.length).toBeGreaterThanOrEqual(4);
    expect(existsSync(path.join(workspaceRoot, 'agent-output.txt'))).toBe(true);
    expect(runtime.listTasks()).toHaveLength(1);
    const runEvents = runtime.getRunEvents(summary.runId, { limit: 20, offset: 0 });
    const eventMessages = runEvents.events.map((event) => event.message);
    expect(eventMessages).toEqual(
      expect.arrayContaining(['run_started', 'planning_started', 'planning_completed', 'step_started', 'step_completed', 'run_completed']),
    );
  });

  it('deletes a completed task together with its runtime data and artifact directory', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-delete-task-'));
    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.llm.provider = 'mock';
    config.autonomy.mode = 'autonomous';
    const runtime = new AgentRuntime({ workspaceRoot, config });
    const task = runtime.createTask('write project output');

    const summary = await runtime.runTask(task.id);
    const artifactRunDir = path.join(workspaceRoot, '.agent', 'artifacts', summary.runId);
    expect(existsSync(artifactRunDir)).toBe(true);

    const deletion = runtime.deleteTask(task.id);

    expect(deletion.taskId).toBe(task.id);
    expect(deletion.deletedCounts.tasks).toBe(1);
    expect(runtime.listTasks()).toHaveLength(0);
    expect(existsSync(artifactRunDir)).toBe(false);
  });

  it('refuses to delete all tasks while at least one task is not in a deletable state', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-delete-all-guard-'));
    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.llm.provider = 'mock';
    const runtime = new AgentRuntime({ workspaceRoot, config });
    runtime.createTask('queued task');

    expect(() => runtime.deleteAllTasks()).toThrow(/Delete-all is allowed only when all tasks are in deletable states/);
  });

  it('salvages a read-only observation prefix and completes after replanning with exact snapshots', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-salvage-'));
    writeFileSync(path.join(workspaceRoot, 'README.md'), '# Initial\n', 'utf8');

    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.autonomy.mode = 'autonomous';

    const provider = new SequencedProvider([
      {
        goal: 'rewrite readme',
        assumptions: [],
        risks: [],
        steps: [
          {
            tool: 'fs.read_file',
            input_json: '{"path":"README.md"}',
            expected_json: '{"content_includes":"# Initial"}',
            rationale: 'Read the current file before editing it.',
          },
          {
            tool: 'repo.apply_patch',
            input_json: '{"patch":"*** Update File: README.md\\n@@\\n <точный контекст будет основан на шаге 1>\\n+# Changed\\n"}',
            expected_json: '{"changed":true}',
            rationale: 'Apply a speculative patch.',
          },
        ],
        done: false,
        confidence: 0.4,
      },
      {
        decision: 'replan',
        reason: 'Use observed file content to produce a full rewrite.',
      },
      {
        goal: 'rewrite readme',
        assumptions: [],
        risks: [],
        steps: [
          {
            tool: 'fs.write_file',
            input_json: '{"path":"README.md","content":"# Initial\\n\\n## FLOW validation\\n\\nValidated through observation-first planning.\\n"}',
            expected_json: '{"changed":true}',
            rationale: 'Rewrite the file using the exact observed content plus the validated section.',
          },
          {
            tool: 'fs.read_file',
            input_json: '{"path":"README.md"}',
            expected_json: '{"content_includes":"FLOW validation"}',
            rationale: 'Read the rewritten file and confirm the inserted section exists.',
          },
        ],
        done: false,
        confidence: 0.8,
      },
      {
        valid: true,
        feedback: [],
        plan: {
          goal: 'rewrite readme',
          assumptions: [],
          risks: [],
          steps: [
            {
              tool: 'fs.write_file',
              input_json: '{"path":"README.md","content":"# Initial\\n\\n## FLOW validation\\n\\nValidated through observation-first planning.\\n"}',
              expected_json: '{"changed":true}',
              rationale: 'Rewrite the file using the exact observed content plus the validated section.',
            },
            {
              tool: 'fs.read_file',
              input_json: '{"path":"README.md"}',
              expected_json: '{"content_includes":"FLOW validation"}',
              rationale: 'Read the rewritten file and confirm the inserted section exists.',
            },
          ],
          done: false,
          confidence: 0.8,
        },
      },
      {
        score: 1,
        issues: [],
        suggestions: [],
      },
    ]);

    const runtime = new AgentRuntime({ workspaceRoot, config, provider });
    const task = runtime.createTask('rewrite readme');
    const summary = await runtime.runTask(task.id);
    const timeline = runtime.getTaskTimeline(task.id);

    expect(summary.state).toBe('completed');
    expect(timeline.runs.some((run) => run.events.some((event) => event.message === 'observation_salvage_completed'))).toBe(true);
    expect(timeline.runs.some((run) => run.events.some((event) => event.message === 'plan_invalid'))).toBe(true);
    expect(readFileSync(path.join(workspaceRoot, 'README.md'), 'utf8')).toContain('FLOW validation');
  });

  it('does not spend execution runtime budget on planning time', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-planning-budget-'));
    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.autonomy.mode = 'autonomous';
    config.llm.provider = 'mock';
    config.limits.max_runtime_sec = 1;

    const runtime = new AgentRuntime({
      workspaceRoot,
      config,
      provider: new DelayedMockProvider(1200),
    });
    const task = runtime.createTask('write project output');

    const summary = await runtime.runTask(task.id);

    expect(summary.state).toBe('completed');
    expect(existsSync(path.join(workspaceRoot, 'agent-output.txt'))).toBe(true);
  });

  it('moves a sensitive step into the approval queue and resumes after approval', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-approval-'));
    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.llm.provider = 'mock';
    config.policies.allow_tools.push('shell.exec');
    config.capabilities.enabled.push('shell.exec');
    config.targets[0]?.capabilities.push('shell.exec');
    const runtime = new AgentRuntime({ workspaceRoot, config });
    const task = runtime.createTask('run shell inspection');

    const awaitingApproval = await runtime.runTask(task.id);

    expect(awaitingApproval.state).toBe('awaiting_approval');
    expect(awaitingApproval.approvals).toHaveLength(1);

    const approved = runtime.approve(awaitingApproval.approvals[0].id);
    expect(approved.status).toBe('approved');

    const resumed = await runtime.runTask(task.id);
    expect(resumed.state).toBe('completed');
  });

  it('executes a system contour task inside the configured target workspace', async () => {
    const hostRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-system-'));
    const targetRoot = path.join(hostRoot, 'targets', 'service-a');
    const config = buildDefaultConfig(hostRoot, 'system');
    config.llm.provider = 'mock';
    config.targets = [
      {
        id: 'service-a',
        root: targetRoot,
        read_paths: ['.'],
        write_paths: ['.'],
        capabilities: ['fs.read', 'fs.write', 'git.status', 'git.branch', 'git.commit', 'repo.test', 'repo.build', 'repo.check', 'repo.patch', 'http.fetch'],
      },
    ];
    const runtime = new AgentRuntime({ workspaceRoot: hostRoot, config });
    const task = runtime.createTask('write system target output', 'service-a');

    const summary = await runtime.runTask(task.id);

    expect(summary.state).toBe('completed');
    expect(existsSync(path.join(targetRoot, 'agent-output.txt'))).toBe(true);
    expect(runtime.listTargets()[0]?.id).toBe('service-a');
  });

  it('enqueues due schedules and executes them through the worker loop', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-schedule-'));
    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.llm.provider = 'mock';
    config.autonomy.mode = 'autonomous';
    config.schedules = [
      {
        id: 'write-nightly-output',
        goal: 'write scheduled output',
        interval_seconds: 1,
        enabled: true,
      },
    ];
    const runtime = new AgentRuntime({ workspaceRoot, config });

    const summary = await runtime.workOnce();

    expect(summary?.state).toBe('completed');
    expect(runtime.listSchedules()).toHaveLength(1);
    expect(existsSync(path.join(workspaceRoot, 'agent-output.txt'))).toBe(true);
  });

  it('persists runtime-created targets and can execute tasks against them', async () => {
    const hostRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-target-add-'));
    const targetRoot = path.join(hostRoot, 'targets', 'service-b');
    const config = buildDefaultConfig(hostRoot, 'system');
    config.llm.provider = 'mock';
    const runtime = new AgentRuntime({ workspaceRoot: hostRoot, config });

    runtime.upsertTarget({
      id: 'service-b',
      root: targetRoot,
      read_paths: ['.'],
      write_paths: ['.'],
      capabilities: ['fs.read', 'fs.write', 'repo.test'],
    });

    const task = runtime.createTask('write target from runtime api', 'service-b');
    const summary = await runtime.runTask(task.id);

    expect(summary.state).toBe('completed');
    expect(runtime.listTargets()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'service-b',
        }),
      ]),
    );
    expect(existsSync(path.join(targetRoot, 'agent-output.txt'))).toBe(true);
  });

  it('builds a task timeline with events, runs, and approvals', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-timeline-'));
    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.llm.provider = 'mock';
    config.policies.allow_tools.push('shell.exec');
    config.capabilities.enabled.push('shell.exec');
    config.targets[0]?.capabilities.push('shell.exec');
    const runtime = new AgentRuntime({ workspaceRoot, config });
    const task = runtime.createTask('run shell timeline check');

    const initial = await runtime.runTask(task.id);
    runtime.approve(initial.approvals[0].id);
    await runtime.runTask(task.id);

    const timeline = runtime.getTaskTimeline(task.id);

    expect(timeline.task?.id).toBe(task.id);
    expect(timeline.approvals).toHaveLength(1);
    expect(timeline.runs.length).toBeGreaterThanOrEqual(2);
    expect(timeline.runs[0]?.events.length).toBeGreaterThan(0);
  });

  it('publishes runtime updates for task and run lifecycle changes', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-stream-'));
    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.llm.provider = 'mock';
    config.autonomy.mode = 'autonomous';
    const runtime = new AgentRuntime({ workspaceRoot, config });
    const events: string[] = [];
    const unsubscribe = runtime.subscribe((event) => {
      events.push(event.kind);
    });

    const task = runtime.createTask('write stream output');
    await runtime.runTask(task.id);
    unsubscribe();

    expect(events).toEqual(
      expect.arrayContaining(['task_changed', 'run_changed', 'run_event']),
    );
  });

  it('rejects conflicting target roots and protects target deletion with task history', async () => {
    const hostRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-target-guard-'));
    const config = buildDefaultConfig(hostRoot, 'system');
    config.llm.provider = 'mock';
    const runtime = new AgentRuntime({ workspaceRoot: hostRoot, config });

    expect(() =>
      runtime.upsertTarget({
        id: 'conflict',
        root: path.join(hostRoot, 'targets', 'example-project', 'nested'),
        read_paths: ['.'],
        write_paths: ['.'],
        capabilities: ['fs.read'],
      }),
    ).toThrow();

    const task = runtime.createTask('write guarded target output');
    await runtime.runTask(task.id);

    expect(() => runtime.deleteTarget('example-project')).toThrow();
  });

  it('exposes persisted targets by id and raises not found for missing targets', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-target-get-'));
    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.llm.provider = 'mock';
    const runtime = new AgentRuntime({ workspaceRoot, config });

    expect(runtime.getTarget('local').id).toBe('local');
    expect(() => runtime.getTarget('missing-target')).toThrow();
  });

  it('cleans up old artifacts, run events, and memory entries', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-cleanup-'));
    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.llm.provider = 'mock';
    config.autonomy.mode = 'autonomous';
    const runtime = new AgentRuntime({ workspaceRoot, config });

    const firstTask = runtime.createTask('write first cleanup output');
    const firstSummary = await runtime.runTask(firstTask.id);
    const secondTask = runtime.createTask('write second cleanup output');
    await runtime.runTask(secondTask.id);

    const cleanupResult = runtime.cleanupState({
      keepLatestArtifacts: 4,
      keepLatestRunEvents: 2,
      keepLatestMemoryEntries: 2,
    });

    expect(cleanupResult.deletedArtifactIds.length).toBeGreaterThan(0);
    expect(cleanupResult.deletedArtifactPaths.length).toBeGreaterThan(0);
    expect(existsSync(firstSummary.artifacts[0]?.path ?? '')).toBe(false);
  });

  it('supports cleanup dry-run and keeps artifact files on disk', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-cleanup-dry-run-'));
    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.llm.provider = 'mock';
    config.autonomy.mode = 'autonomous';
    const runtime = new AgentRuntime({ workspaceRoot, config });

    const firstTask = runtime.createTask('write first dry-run cleanup output');
    const firstSummary = await runtime.runTask(firstTask.id);
    const secondTask = runtime.createTask('write second dry-run cleanup output');
    await runtime.runTask(secondTask.id);

    const cleanupResult = runtime.cleanupState({
      keepLatestArtifacts: 4,
      keepLatestRunEvents: 2,
      keepLatestMemoryEntries: 2,
      dryRun: true,
    });

    expect(cleanupResult.dryRun).toBe(true);
    expect(cleanupResult.deletedArtifactIds.length).toBeGreaterThan(0);
    expect(cleanupResult.deletedArtifactPaths.length).toBeGreaterThan(0);
    expect(existsSync(firstSummary.artifacts[0]?.path ?? '')).toBe(true);
    const maintenanceEvents = runtime.listMaintenanceEvents({ limit: 10, offset: 0 });
    expect(maintenanceEvents.page.total).toBeGreaterThanOrEqual(1);
    expect(maintenanceEvents.events[0]?.operation).toBe('cleanup');
    expect(maintenanceEvents.events[0]?.dry_run).toBe(1);
    expect(maintenanceEvents.events[0]?.trigger).toBe('manual');
    const summary = runtime.getMaintenanceSummary();
    expect(summary.totals.manual).toBeGreaterThanOrEqual(1);
    expect(summary.latestEvent?.trigger).toBe('manual');
  });

  it('supports age-based cleanup and maintenance filtering', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-cleanup-age-'));
    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.llm.provider = 'mock';
    config.autonomy.mode = 'autonomous';
    const runtime = new AgentRuntime({ workspaceRoot, config });

    const firstTask = runtime.createTask('write age cleanup output');
    const firstSummary = await runtime.runTask(firstTask.id);

    const cleanupResult = runtime.cleanupState({
      keepLatestArtifacts: 100,
      keepLatestRunEvents: 100,
      keepLatestMemoryEntries: 100,
      maxArtifactAgeDays: 0,
      maxRunEventAgeDays: 0,
      maxMemoryEntryAgeDays: 0,
    });

    expect(cleanupResult.retention.maxArtifactAgeDays).toBe(0);
    expect(cleanupResult.deletedArtifactIds.length).toBeGreaterThan(0);
    expect(existsSync(firstSummary.artifacts[0]?.path ?? '')).toBe(false);

    const filteredMaintenanceEvents = runtime.listMaintenanceEvents(
      { limit: 10, offset: 0 },
      { operation: 'cleanup', dryRun: false },
    );

    expect(filteredMaintenanceEvents.events.length).toBeGreaterThanOrEqual(1);
    expect(filteredMaintenanceEvents.events.every((event) => event.operation === 'cleanup' && event.dry_run === 0)).toBe(true);
  });

  it('runs scheduled maintenance through the worker loop when cleanup is due', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-maintenance-due-'));
    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.llm.provider = 'mock';
    config.autonomy.mode = 'autonomous';
    config.maintenance.cleanup.interval_seconds = 1;
    config.maintenance.retention.keep_latest_artifacts = 1;
    const runtime = new AgentRuntime({ workspaceRoot, config });

    const firstTask = runtime.createTask('write maintenance due one');
    const firstSummary = await runtime.runTask(firstTask.id);
    const secondTask = runtime.createTask('write maintenance due two');
    await runtime.runTask(secondTask.id);

    const maintenanceResult = runtime.runDueMaintenance();

    expect(maintenanceResult?.deletedArtifactIds.length).toBeGreaterThan(0);
    expect(existsSync(firstSummary.artifacts[0]?.path ?? '')).toBe(false);

    const statusAfterCleanup = runtime.getMaintenanceStatus();
    expect(statusAfterCleanup.intervalSeconds).toBe(1);
    expect(statusAfterCleanup.due).toBe(false);
    expect(statusAfterCleanup.lastRunAt).not.toBe(null);

    const idleResult = runtime.runDueMaintenance();
    expect(idleResult).toBe(undefined);

    const workerEvents = runtime.listMaintenanceEvents(
      { limit: 10, offset: 0 },
      { operation: 'cleanup', trigger: 'worker_due', dryRun: false },
    );
    expect(workerEvents.events.length).toBeGreaterThanOrEqual(1);
    expect(workerEvents.events.every((event) => event.trigger === 'worker_due')).toBe(true);
  });

  it('supports paginated task timelines and run events', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-pagination-'));
    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.llm.provider = 'mock';
    config.autonomy.mode = 'autonomous';
    const runtime = new AgentRuntime({ workspaceRoot, config });

    const firstTask = runtime.createTask('write paginated output one');
    const firstSummary = await runtime.runTask(firstTask.id);
    const secondTask = runtime.createTask('write paginated output two');
    await runtime.runTask(secondTask.id);

    const timeline = runtime.getTaskTimeline(firstTask.id, { limit: 1, offset: 0 });
    const runEvents = runtime.getRunEvents(firstSummary.runId, { limit: 1, offset: 0 }, { level: 'info' });

    expect(timeline.page.limit).toBe(1);
    expect(timeline.page.offset).toBe(0);
    expect(timeline.runs).toHaveLength(1);
    expect(runEvents.page.limit).toBe(1);
    expect(runEvents.events.length).toBeGreaterThanOrEqual(1);
    expect(runEvents.events.every((event) => event.level === 'info')).toBe(true);
  });

  it('writes a planning transport diagnostic artifact when codex planning fails', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-planning-diagnostic-'));
    const executablePath = path.join(workspaceRoot, 'mock-codex.js');
    writeFileSync(
      executablePath,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "const outputIndex = process.argv.indexOf('--output-last-message');",
        'if (outputIndex >= 0) {',
        "  fs.writeFileSync(process.argv[outputIndex + 1], '');",
        '}',
        "process.stdout.write('{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"error\",\"message\":\"ignored\"}}\\n');",
      ].join('\n'),
      'utf8',
    );
    chmodSync(executablePath, 0o755);

    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.llm.provider = 'codex';
    config.llm.executable = executablePath;
    config.llm.retry_count = 0;
    config.limits.max_iterations = 1;
    const runtime = new AgentRuntime({ workspaceRoot, config });
    const task = runtime.createTask('planner diagnostic');

    const summary = await runtime.runTask(task.id);
    const timeline = runtime.getTaskTimeline(task.id);
    const failureEvent = timeline.runs[0]?.events.find((event) => event.message === 'plan_generation_failed');
    const failurePayload = failureEvent ? JSON.parse(failureEvent.payload_json) : null;
    const diagnosticPath =
      failurePayload && typeof failurePayload === 'object' && !Array.isArray(failurePayload)
        ? failurePayload['diagnosticPath']
        : null;

    expect(summary.state).toBe('escalated');
    expect(typeof diagnosticPath).toBe('string');
    expect(existsSync(typeof diagnosticPath === 'string' ? diagnosticPath : '')).toBe(true);
  });
});
