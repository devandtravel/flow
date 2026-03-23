import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import { ensureAgentDirectories, loadConfig, type RuntimeConfig } from '../../config';
import {
  capabilityNameSchema,
  taskPlanSchema,
  type ApprovalRequestRecord,
  type ArtifactRecord,
  type MaintenanceEventRecord,
  type MaintenanceTrigger,
  type RunEventRecord,
  type RunRecord,
  type StepRecord,
  type TargetRecord,
  type TargetConfig,
  type TaskPlan,
  type TaskRecord,
} from '../../domain';
import { RuntimeDatabase } from '../../db/database';
import { ConflictError, InvalidOperationError, NotFoundError, ValidationError } from '../../errors';
import { createLlmProvider } from '../../llm';
import { MemoryService } from '../../memory';
import { PolicyEngine } from '../../policy';
import { createLogger, MetricsCollector } from '../../telemetry';
import {
  createToolRegistry,
  executeTool,
  listToolDefinitions,
  toolResultSchema,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolResult,
} from '../../tools';
import { CriticAgent, EvaluatorAgent, ExecutorAgent, PlannerAgent, SupervisorAgent, VerifierAgent } from '../agents';
import { assertValidRunTransition, assertValidStepTransition, assertValidTaskTransition } from '../state';

const approvalInputSchema = z.object({
  id: z.string().uuid(),
});

export interface RuntimeOptions {
  workspaceRoot: string;
  config?: RuntimeConfig;
}

export interface RunSummary {
  task: TaskRecord;
  runId: string;
  state: TaskRecord['state'];
  plan: TaskPlan;
  artifacts: ArtifactRecord[];
  approvals: ApprovalRequestRecord[];
  metrics: ReturnType<MetricsCollector['snapshot']>;
}

export interface TaskArtifactView extends ArtifactRecord {
  runId: string;
  stepIndex: number;
  tool: string;
}

export interface CleanupResult {
  maintenanceEventId: string;
  dryRun: boolean;
  retention: {
    keepLatestArtifacts: number;
    keepLatestRunEvents: number;
    keepLatestMemoryEntries: number;
    maxArtifactAgeDays: number | null;
    maxRunEventAgeDays: number | null;
    maxMemoryEntryAgeDays: number | null;
  };
  deletedArtifactIds: string[];
  deletedRunEventIds: string[];
  deletedMemoryEntryIds: string[];
  deletedArtifactPaths: string[];
}

export interface PageOptions {
  limit?: number;
  offset?: number;
}

export interface RunEventPageFilter {
  level?: RunEventRecord['level'];
}

export interface MaintenanceEventPageFilter {
  operation?: MaintenanceEventRecord['operation'];
  dryRun?: boolean;
  trigger?: MaintenanceEventRecord['trigger'];
}

export interface MaintenanceStatusSummary {
  operation: MaintenanceEventRecord['operation'];
  dryRunDefault: boolean;
  intervalSeconds: number | null;
  due: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface MaintenanceSummary {
  operation: MaintenanceEventRecord['operation'];
  status: MaintenanceStatusSummary;
  totals: {
    all: number;
    dryRun: number;
    executed: number;
    manual: number;
    apiManual: number;
    cliManual: number;
    workerDue: number;
    apiRunDue: number;
    cliRunDue: number;
  };
  latestEvent: MaintenanceEventRecord | null;
}

export type RuntimeUpdateEvent =
  | {
      kind: 'task_changed';
      timestamp: string;
      taskId: string;
      state: TaskRecord['state'];
    }
  | {
      kind: 'run_changed';
      timestamp: string;
      taskId: string;
      runId: string;
      state: RunRecord['status'];
    }
  | {
      kind: 'run_event';
      timestamp: string;
      taskId: string;
      runId: string;
      level: RunEventRecord['level'];
      message: string;
    }
  | {
      kind: 'approval_changed';
      timestamp: string;
      taskId: string;
      runId: string;
      approvalId: string;
      status: ApprovalRequestRecord['status'];
    }
  | {
      kind: 'maintenance_changed';
      timestamp: string;
      operation: MaintenanceEventRecord['operation'];
      maintenanceEventId: string;
    }
  | {
      kind: 'target_changed';
      timestamp: string;
      targetId: string;
    }
  | {
      kind: 'schedule_changed';
      timestamp: string;
      scheduleId: string;
    };

function resolvePageOptions(page?: PageOptions): { limit: number; offset: number } {
  return {
    limit: page?.limit ?? 20,
    offset: page?.offset ?? 0,
  };
}

function parseStepJson(serialized: string): Record<string, unknown> {
  const parsed = JSON.parse(serialized);
  return z.record(z.string(), z.unknown()).parse(parsed);
}

function parseStringArrayEnvelope(serialized: string, key: string): string[] {
  const parsed = JSON.parse(serialized);
  return z.object({ [key]: z.array(z.string()) }).parse(parsed)[key];
}

function createFallbackPlan(goal: string): TaskPlan {
  return taskPlanSchema.parse({
    goal,
    assumptions: ['Planner did not return a plan.'],
    risks: ['Execution stopped before planning completed.'],
    steps: [
      {
        tool: 'fs.list_dir',
        input: { path: '.' },
        expected: { success: true },
        rationale: 'Fallback observation step.',
      },
    ],
    done: false,
    confidence: 0,
  });
}

function normalizeRootPath(rootPath: string): string {
  return path.resolve(rootPath);
}

function pathsConflict(left: string, right: string): boolean {
  const normalizedLeft = normalizeRootPath(left);
  const normalizedRight = normalizeRootPath(right);
  return normalizedLeft === normalizedRight || normalizedLeft.startsWith(`${normalizedRight}${path.sep}`) || normalizedRight.startsWith(`${normalizedLeft}${path.sep}`);
}

export class AgentRuntime {
  readonly workspaceRoot: string;
  readonly config: RuntimeConfig;
  readonly database: RuntimeDatabase;
  readonly policy: PolicyEngine;
  readonly tools: Map<string, ToolDefinition>;
  readonly memory: MemoryService;
  readonly logger: Logger;
  readonly metrics = new MetricsCollector();
  private readonly planner: PlannerAgent;
  private readonly critic: CriticAgent;
  private readonly executor = new ExecutorAgent();
  private readonly verifier = new VerifierAgent();
  private readonly supervisor: SupervisorAgent;
  private readonly evaluator: EvaluatorAgent;
  private readonly artifactsDir: string;
  private readonly changedFilesByRun = new Map<string, Set<string>>();
  private readonly subscribers = new Set<(event: RuntimeUpdateEvent) => void>();

  constructor(options: RuntimeOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.config = options.config ?? loadConfig(this.workspaceRoot);
    const directories = ensureAgentDirectories(this.workspaceRoot);
    this.artifactsDir = directories.artifactsDir;
    this.database = new RuntimeDatabase(path.join(directories.agentDir, 'flow.db'));
    this.policy = new PolicyEngine({
      ...this.buildPolicyConfig(),
      limits: this.config.limits,
      autonomy: this.config.autonomy,
      workspace: this.config.workspace,
    });
    this.tools = createToolRegistry();
    this.memory = new MemoryService(this.database);
    this.logger = createLogger(directories.logsDir);

    const provider = createLlmProvider(this.config.llm);
    this.planner = new PlannerAgent(provider);
    this.critic = new CriticAgent(provider);
    this.supervisor = new SupervisorAgent(provider);
    this.evaluator = new EvaluatorAgent(provider);

    this.synchronizeTargets();
    this.synchronizeSchedules();
  }

  private buildPolicyConfig() {
    const requiredTools = new Set([
      ...this.config.policies.require_approval.tools,
      ...this.config.approvals.required_for.tools,
    ]);
    const requiredCapabilities = new Set([
      ...this.config.policies.require_approval.capabilities,
      ...this.config.approvals.required_for.capabilities,
    ]);

    return {
      ...this.config.policies,
      require_approval: {
        tools: [...requiredTools],
        capabilities: [...requiredCapabilities],
      },
    };
  }

  private synchronizeTargets(): void {
    for (const target of this.config.targets) {
      this.database.upsertTarget(target.id, target.root, target.read_paths, target.write_paths, target.capabilities);
      this.memory.recordSemantic(`target:${target.id}`, {
        root: target.root,
        capabilities: target.capabilities,
        read_paths: target.read_paths,
        write_paths: target.write_paths,
      });
    }
  }

  private synchronizeSchedules(): void {
    for (const schedule of this.config.schedules) {
      this.database.upsertSchedule(
        schedule.id,
        schedule.goal,
        schedule.target_id,
        schedule.interval_seconds,
        schedule.enabled,
      );
    }
  }

  getMaintenanceStatus(now = Date.now()): MaintenanceStatusSummary {
    const intervalSeconds = this.config.maintenance.cleanup.interval_seconds;
    const latestCleanup = this.database.getLatestMaintenanceEvent({
      operation: 'cleanup',
      dryRun: this.config.maintenance.cleanup.dry_run_default,
    });
    const lastRunAt = latestCleanup?.created_at ?? null;
    const nextRunAt =
      latestCleanup && intervalSeconds !== null
        ? new Date(new Date(latestCleanup.created_at).getTime() + intervalSeconds * 1000).toISOString()
        : null;
    const due =
      intervalSeconds !== null &&
      (!latestCleanup || now - new Date(latestCleanup.created_at).getTime() >= intervalSeconds * 1000);

    return {
      operation: 'cleanup',
      dryRunDefault: this.config.maintenance.cleanup.dry_run_default,
      intervalSeconds,
      due,
      lastRunAt,
      nextRunAt,
    };
  }

  runDueMaintenance(options?: { now?: number; trigger?: MaintenanceTrigger }): CleanupResult | undefined {
    const status = this.getMaintenanceStatus(options?.now);
    if (!status.due) {
      return undefined;
    }

    return this.cleanupState({
      trigger: options?.trigger ?? 'worker_due',
    });
  }

  private targetRecordToConfig(record: TargetRecord): TargetConfig {
    const storedCapabilities = z.array(capabilityNameSchema).parse(parseStringArrayEnvelope(record.capabilities_json, 'capabilities'));
    return {
      id: record.id,
      root: record.root,
      read_paths: parseStringArrayEnvelope(record.read_paths_json, 'read_paths'),
      write_paths: parseStringArrayEnvelope(record.write_paths_json, 'write_paths'),
      capabilities: storedCapabilities.filter((capability) =>
        this.config.capabilities.enabled.includes(capability),
      ),
    };
  }

  private resolveTarget(targetId: string): TargetConfig {
    const targetRecord = this.database.getTarget(targetId);
    if (!targetRecord) {
      throw new NotFoundError(`Target ${targetId} is not configured.`, { targetId });
    }

    return this.targetRecordToConfig(targetRecord);
  }

  private requireTask(taskId: string): TaskRecord {
    const task = this.database.getTask(taskId);
    if (!task) {
      throw new NotFoundError(`Task ${taskId} not found.`, { taskId });
    }

    return task;
  }

  private requireRun(runId: string): RunRecord {
    const run = this.database.getRun(runId);
    if (!run) {
      throw new NotFoundError(`Run ${runId} not found.`, { runId });
    }

    return run;
  }

  private buildExecutionContext(target: TargetConfig): ToolExecutionContext {
    const scopedPolicy = new PolicyEngine({
      ...this.buildPolicyConfig(),
      limits: this.config.limits,
      autonomy: this.config.autonomy,
      workspace: {
        root: target.root,
        read_paths: target.read_paths,
        write_paths: target.write_paths,
      },
    });

    return {
      workspaceRoot: target.root,
      policy: scopedPolicy,
      httpAllowlist: this.config.http.allowlist,
    };
  }

  private transitionTask(task: TaskRecord, nextState: TaskRecord['state']): TaskRecord {
    assertValidTaskTransition(task.state, nextState);
    const updatedTask = this.database.updateTaskState(task.id, nextState);
    this.emitRuntimeUpdate({
      kind: 'task_changed',
      taskId: updatedTask.id,
      state: updatedTask.state,
    });
    return updatedTask;
  }

  private transitionRun(run: RunRecord, nextState: RunRecord['status']): RunRecord {
    assertValidRunTransition(run.status, nextState);
    const updatedRun = this.database.updateRunState(run.id, nextState);
    this.emitRuntimeUpdate({
      kind: 'run_changed',
      taskId: updatedRun.task_id,
      runId: updatedRun.id,
      state: updatedRun.status,
    });
    return updatedRun;
  }

  private transitionStep(step: StepRecord, nextState: StepRecord['status']): StepRecord {
    assertValidStepTransition(step.status, nextState);
    return this.database.updateStepStatus(step.id, nextState);
  }

  private finishRun(run: RunRecord, nextState: RunRecord['status']): RunRecord {
    const finishedRun = this.database.finishRun(run.id, nextState);
    this.emitRuntimeUpdate({
      kind: 'run_changed',
      taskId: finishedRun.task_id,
      runId: finishedRun.id,
      state: finishedRun.status,
    });
    return finishedRun;
  }

  private getChangedFilesSet(runId: string): Set<string> {
    const existing = this.changedFilesByRun.get(runId);
    if (existing) {
      return existing;
    }

    const created = new Set<string>();
    this.changedFilesByRun.set(runId, created);
    return created;
  }

  private emitRuntimeUpdate(event: Omit<RuntimeUpdateEvent, 'timestamp'>): void {
    const enrichedEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };
    for (const subscriber of this.subscribers) {
      subscriber(enrichedEvent);
    }
  }

  private createRunEvent(
    taskId: string,
    runId: string,
    level: RunEventRecord['level'],
    message: string,
    payload: Record<string, unknown>,
  ): RunEventRecord {
    const event = this.database.createRunEvent(runId, level, message, payload);
    this.emitRuntimeUpdate({
      kind: 'run_event',
      taskId,
      runId,
      level,
      message,
    });
    return event;
  }

  subscribe(listener: (event: RuntimeUpdateEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  private createArtifacts(
    stepRecord: StepRecord,
    requestPayload: Record<string, unknown>,
    result: ToolResult,
    verification: { verified: boolean; evidence: string },
  ): ArtifactRecord[] {
    const stepDir = path.join(this.artifactsDir, stepRecord.run_id, `${stepRecord.index}-${stepRecord.tool.replace(/[^a-z0-9._-]/gi, '_')}`);
    mkdirSync(stepDir, { recursive: true });

    const requestPath = path.join(stepDir, 'request.json');
    const resultPath = path.join(stepDir, 'result.json');
    const verificationPath = path.join(stepDir, 'verification.json');
    const reportPath = path.join(stepDir, 'report.json');

    writeFileSync(requestPath, JSON.stringify(requestPayload, null, 2));
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    writeFileSync(verificationPath, JSON.stringify(verification, null, 2));
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          changedFiles: result.changedFiles,
          success: result.success,
        },
        null,
        2,
      ),
    );

    return [
      this.database.createArtifact(stepRecord.id, 'request', requestPath, { tool: stepRecord.tool }),
      this.database.createArtifact(stepRecord.id, 'result', resultPath, { success: result.success }),
      this.database.createArtifact(stepRecord.id, 'verification', verificationPath, { verified: verification.verified }),
      this.database.createArtifact(stepRecord.id, 'report', reportPath, { changedFiles: result.changedFiles }),
    ];
  }

  private async planTask(task: TaskRecord, target: TargetConfig): Promise<TaskPlan> {
    const toolCatalog = listToolDefinitions(this.tools).filter((tool) => target.capabilities.includes(tool.capability));
    const memory = this.memory.getContext();
    return this.planner.generate({
      goal: task.goal,
      memory,
      tools: toolCatalog,
      extraContext: JSON.stringify({
        target: {
          id: target.id,
          root: target.root,
        },
        autonomy: this.config.autonomy.mode,
      }),
    });
  }

  private async resolveApprovedStep(task: TaskRecord): Promise<{
    approval?: ApprovalRequestRecord;
    plan: TaskPlan;
  }> {
    const approved = this.database.findApprovedApprovalForTask(task.id);
    if (!approved) {
      return {
        plan: createFallbackPlan(task.goal),
      };
    }

    return {
      approval: approved,
      plan: taskPlanSchema.parse({
        goal: task.goal,
        assumptions: ['Resuming an approved step from the approval queue.'],
        risks: [],
        steps: [
          {
            tool: approved.tool,
            input: parseStepJson(approved.input_json),
            expected: { success: true },
            rationale: approved.reason,
          },
        ],
        done: false,
        confidence: 1,
      }),
    };
  }

  createTask(goal: string, targetId?: string, priority = 0): TaskRecord {
    const resolvedTargetId =
      targetId ??
      (this.config.mode === 'project'
        ? this.config.targets[0]?.id
        : this.config.targets[0]?.id);

    if (!resolvedTargetId) {
      throw new InvalidOperationError('No target is configured for task creation.');
    }

    const createdTask = this.database.createTask(goal, resolvedTargetId, priority);
    this.emitRuntimeUpdate({
      kind: 'task_changed',
      taskId: createdTask.id,
      state: createdTask.state,
    });
    return createdTask;
  }

  listTasks(): TaskRecord[] {
    return this.database.listTasks();
  }

  listApprovals(): ApprovalRequestRecord[] {
    return this.database.listApprovals();
  }

  listTargets() {
    return this.database.listTargets().map((target) => this.targetRecordToConfig(target));
  }

  getTarget(targetId: string): TargetConfig {
    return this.resolveTarget(targetId);
  }

  upsertTarget(target: TargetConfig) {
    for (const existing of this.database.listTargets()) {
      if (existing.id !== target.id && pathsConflict(existing.root, target.root)) {
        throw new ConflictError(`Target root ${target.root} conflicts with existing target ${existing.id}.`, {
          targetId: target.id,
          conflictingTargetId: existing.id,
          root: target.root,
        });
      }
    }

    const persisted = this.database.upsertTarget(
      target.id,
      target.root,
      target.read_paths,
      target.write_paths,
      target.capabilities,
    );
    this.memory.recordSemantic(`target:${target.id}`, {
      root: target.root,
      capabilities: target.capabilities,
      read_paths: target.read_paths,
      write_paths: target.write_paths,
    });
    this.emitRuntimeUpdate({
      kind: 'target_changed',
      targetId: target.id,
    });
    return persisted;
  }

  deleteTarget(targetId: string): void {
    const existing = this.database.getTarget(targetId);
    if (!existing) {
      throw new NotFoundError(`Target ${targetId} does not exist.`, { targetId });
    }

    if (this.database.countTasksByTarget(targetId) > 0) {
      throw new InvalidOperationError(`Target ${targetId} still has task history and cannot be removed safely.`, { targetId });
    }

    this.database.deleteTarget(targetId);
    this.emitRuntimeUpdate({
      kind: 'target_changed',
      targetId,
    });
  }

  listSchedules() {
    return this.database.listSchedules();
  }

  upsertSchedule(input: { id: string; goal: string; targetId?: string; intervalSeconds: number; enabled: boolean }) {
    const persistedSchedule = this.database.upsertSchedule(input.id, input.goal, input.targetId, input.intervalSeconds, input.enabled);
    this.emitRuntimeUpdate({
      kind: 'schedule_changed',
      scheduleId: persistedSchedule.id,
    });
    return persistedSchedule;
  }

  cleanupState(options?: {
    keepLatestArtifacts?: number;
    keepLatestRunEvents?: number;
    keepLatestMemoryEntries?: number;
    maxArtifactAgeDays?: number | null;
    maxRunEventAgeDays?: number | null;
    maxMemoryEntryAgeDays?: number | null;
    dryRun?: boolean;
    trigger?: MaintenanceTrigger;
  }): CleanupResult {
    const keepLatestArtifacts = options?.keepLatestArtifacts ?? this.config.maintenance.retention.keep_latest_artifacts;
    const keepLatestRunEvents = options?.keepLatestRunEvents ?? this.config.maintenance.retention.keep_latest_run_events;
    const keepLatestMemoryEntries = options?.keepLatestMemoryEntries ?? this.config.maintenance.retention.keep_latest_memory_entries;
    const maxArtifactAgeDays = options?.maxArtifactAgeDays ?? this.config.maintenance.retention.max_artifact_age_days;
    const maxRunEventAgeDays = options?.maxRunEventAgeDays ?? this.config.maintenance.retention.max_run_event_age_days;
    const maxMemoryEntryAgeDays = options?.maxMemoryEntryAgeDays ?? this.config.maintenance.retention.max_memory_entry_age_days;
    const dryRun = options?.dryRun ?? this.config.maintenance.cleanup.dry_run_default;
    const trigger = options?.trigger ?? 'manual';

    if (
      keepLatestArtifacts < 0 ||
      keepLatestRunEvents < 0 ||
      keepLatestMemoryEntries < 0 ||
      (maxArtifactAgeDays !== null && maxArtifactAgeDays !== undefined && maxArtifactAgeDays < 0) ||
      (maxRunEventAgeDays !== null && maxRunEventAgeDays !== undefined && maxRunEventAgeDays < 0) ||
      (maxMemoryEntryAgeDays !== null && maxMemoryEntryAgeDays !== undefined && maxMemoryEntryAgeDays < 0)
    ) {
      throw new ValidationError('Cleanup retention values must be zero or greater.');
    }

    const artifactPathById = new Map(
      this.database
        .listTasks()
        .flatMap((task) => this.database.inspectTask(task.id).runs)
        .flatMap((run) => run.steps)
        .flatMap((step) => this.database.listArtifactsByStep(step.id))
        .map((artifact) => [artifact.id, artifact.path]),
    );

    const cleanupSummary = this.database.cleanupState({
      keepLatestArtifacts,
      keepLatestRunEvents,
      keepLatestMemoryEntries,
      maxArtifactAgeDays,
      maxRunEventAgeDays,
      maxMemoryEntryAgeDays,
      dryRun,
    });
    const deletedArtifactPaths: string[] = [];

    for (const artifactId of cleanupSummary.deletedArtifactIds) {
      const artifactPath = artifactPathById.get(artifactId);
      if (artifactPath) {
        if (!dryRun && existsSync(artifactPath)) {
          rmSync(artifactPath, { force: true });
        }
        deletedArtifactPaths.push(artifactPath);
      }
    }

    const maintenanceEvent = this.database.createMaintenanceEvent(
      'cleanup',
      'completed',
      trigger,
      dryRun,
      {
        retention: {
          keepLatestArtifacts,
          keepLatestRunEvents,
          keepLatestMemoryEntries,
          maxArtifactAgeDays,
          maxRunEventAgeDays,
          maxMemoryEntryAgeDays,
        },
      },
      {
        deletedArtifactIds: cleanupSummary.deletedArtifactIds,
        deletedRunEventIds: cleanupSummary.deletedRunEventIds,
        deletedMemoryEntryIds: cleanupSummary.deletedMemoryEntryIds,
        deletedArtifactPaths,
      },
    );

    this.emitRuntimeUpdate({
      kind: 'maintenance_changed',
      operation: maintenanceEvent.operation,
      maintenanceEventId: maintenanceEvent.id,
    });

    return {
      maintenanceEventId: maintenanceEvent.id,
      dryRun,
      retention: {
        keepLatestArtifacts,
        keepLatestRunEvents,
        keepLatestMemoryEntries,
        maxArtifactAgeDays,
        maxRunEventAgeDays,
        maxMemoryEntryAgeDays,
      },
      ...cleanupSummary,
      deletedArtifactPaths,
    };
  }

  inspectTask(taskId: string) {
    this.requireTask(taskId);
    return this.database.inspectTask(taskId);
  }

  getTaskTimeline(taskId: string, page?: PageOptions) {
    this.requireTask(taskId);
    return this.database.getTaskTimeline(taskId, resolvePageOptions(page));
  }

  getRunEvents(runId: string, page?: PageOptions, filter?: RunEventPageFilter) {
    const run = this.requireRun(runId);
    const resolvedPage = resolvePageOptions(page);
    return {
      run,
      page: {
        total: this.database.countRunEvents(runId, filter),
        limit: resolvedPage.limit,
        offset: resolvedPage.offset,
      },
      events: this.database.listRunEventsPage(runId, resolvedPage, filter),
    };
  }

  listMaintenanceEvents(page?: PageOptions): {
    page: { total: number; limit: number; offset: number };
    events: MaintenanceEventRecord[];
  }

  listMaintenanceEvents(page?: PageOptions, filter?: MaintenanceEventPageFilter): {
    page: { total: number; limit: number; offset: number };
    events: MaintenanceEventRecord[];
  } {
    const resolvedPage = resolvePageOptions(page);
    return {
      page: {
        total: this.database.countMaintenanceEvents(filter),
        limit: resolvedPage.limit,
        offset: resolvedPage.offset,
      },
      events: this.database.listMaintenanceEvents(resolvedPage, filter),
    };
  }

  getMaintenanceSummary(): MaintenanceSummary {
    return {
      operation: 'cleanup',
      status: this.getMaintenanceStatus(),
      totals: {
        all: this.database.countMaintenanceEvents({ operation: 'cleanup' }),
        dryRun: this.database.countMaintenanceEvents({ operation: 'cleanup', dryRun: true }),
        executed: this.database.countMaintenanceEvents({ operation: 'cleanup', dryRun: false }),
        manual: this.database.countMaintenanceEvents({ operation: 'cleanup', trigger: 'manual' }),
        apiManual: this.database.countMaintenanceEvents({ operation: 'cleanup', trigger: 'api_manual' }),
        cliManual: this.database.countMaintenanceEvents({ operation: 'cleanup', trigger: 'cli_manual' }),
        workerDue: this.database.countMaintenanceEvents({ operation: 'cleanup', trigger: 'worker_due' }),
        apiRunDue: this.database.countMaintenanceEvents({ operation: 'cleanup', trigger: 'api_run_due' }),
        cliRunDue: this.database.countMaintenanceEvents({ operation: 'cleanup', trigger: 'cli_run_due' }),
      },
      latestEvent: this.database.getLatestMaintenanceEvent({ operation: 'cleanup' }) ?? null,
    };
  }

  getRun(runId: string) {
    const run = this.requireRun(runId);
    return {
      run,
      steps: this.database.listStepsByRun(runId),
      evaluations: this.database.listEvaluationsByRun(runId),
      events: this.database.listRunEvents(runId),
    };
  }

  getArtifact(artifactId: string) {
    return this.database.getArtifact(artifactId);
  }

  getArtifactView(artifactId: string): TaskArtifactView {
    const artifact = this.database.getArtifact(artifactId);
    if (!artifact) {
      throw new NotFoundError(`Artifact ${artifactId} not found.`, { artifactId });
    }

    const step = this.database.getStep(artifact.step_id);
    if (!step) {
      throw new NotFoundError(`Step for artifact ${artifactId} not found.`, { artifactId, stepId: artifact.step_id });
    }

    const run = this.database.getRun(step.run_id);
    if (!run) {
      throw new NotFoundError(`Run for artifact ${artifactId} not found.`, { artifactId, runId: step.run_id });
    }

    return {
      ...artifact,
      runId: run.id,
      stepIndex: step.index,
      tool: step.tool,
    };
  }

  getTaskArtifacts(taskId: string): TaskArtifactView[] {
    this.requireTask(taskId);
    return this.database.inspectTask(taskId).runs.flatMap((run) =>
      run.steps.flatMap((step) =>
        this.database.listArtifactsByStep(step.id).map((artifact) => ({
          ...artifact,
          runId: run.id,
          stepIndex: step.index,
          tool: step.tool,
        })),
      ),
    );
  }

  approve(approvalId: string): ApprovalRequestRecord {
    const approval = approvalInputSchema.parse({ id: approvalId });
    const updated = this.database.updateApprovalStatus(approval.id, 'approved');
    this.database.updateTaskState(updated.task_id, 'queued');
    this.emitRuntimeUpdate({
      kind: 'approval_changed',
      taskId: updated.task_id,
      runId: updated.run_id,
      approvalId: updated.id,
      status: updated.status,
    });
    this.emitRuntimeUpdate({
      kind: 'task_changed',
      taskId: updated.task_id,
      state: 'queued',
    });
    return updated;
  }

  reject(approvalId: string): ApprovalRequestRecord {
    const approval = approvalInputSchema.parse({ id: approvalId });
    const updated = this.database.updateApprovalStatus(approval.id, 'rejected');
    this.database.updateTaskState(updated.task_id, 'blocked');
    this.emitRuntimeUpdate({
      kind: 'approval_changed',
      taskId: updated.task_id,
      runId: updated.run_id,
      approvalId: updated.id,
      status: updated.status,
    });
    this.emitRuntimeUpdate({
      kind: 'task_changed',
      taskId: updated.task_id,
      state: 'blocked',
    });
    return updated;
  }

  enqueueDueSchedules(now = Date.now()): TaskRecord[] {
    const enqueued: TaskRecord[] = [];
    for (const schedule of this.database.listSchedules()) {
      if (schedule.enabled !== 1) {
        continue;
      }

      const lastEnqueuedMs = schedule.last_enqueued_at ? new Date(schedule.last_enqueued_at).getTime() : 0;
      if (lastEnqueuedMs !== 0 && now - lastEnqueuedMs < schedule.interval_seconds * 1000) {
        continue;
      }

      const task = this.createTask(schedule.goal, schedule.target_id ?? undefined);
      this.database.markScheduleEnqueued(schedule.id);
      enqueued.push(task);
    }

    return enqueued;
  }

  async workOnce(): Promise<RunSummary | undefined> {
    this.runDueMaintenance({ trigger: 'worker_due' });
    this.enqueueDueSchedules();
    const candidate = this.listTasks().find((task) => ['queued', 'retryable', 'awaiting_approval'].includes(task.state));
    if (!candidate) {
      return undefined;
    }

    return this.runTask(candidate.id);
  }

  async startWorkerLoop(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      await this.workOnce();
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), this.config.worker.poll_interval_ms);
      });
    }
  }

  async runTask(taskId: string): Promise<RunSummary> {
    let task = this.database.getTask(taskId);
    if (!task) {
      throw new NotFoundError(`Task ${taskId} not found.`, { taskId });
    }

    const target = this.resolveTarget(task.target_id);
    const executionContext = this.buildExecutionContext(target);
    const startedAt = Date.now();
    let iteration = 0;
    let lastPlan = createFallbackPlan(task.goal);
    let lastRunId = '';
    const createdArtifacts: ArtifactRecord[] = [];
    const createdApprovals: ApprovalRequestRecord[] = [];

    while (iteration < this.config.limits.max_iterations) {
      iteration += 1;
      if (task.state === 'queued' || task.state === 'retryable') {
        task = this.transitionTask(task, 'planning');
      }

      const run = this.database.createRun(task.id, iteration, 'queued');
      lastRunId = run.id;
      this.transitionRun(run, 'planning');
      this.createRunEvent(task.id, run.id, 'info', 'run_started', { taskId: task.id, iteration, targetId: task.target_id });
      this.createRunEvent(task.id, run.id, 'info', 'planning_started', { taskId: task.id, targetId: task.target_id });

      const planSource = await this.resolveApprovedStep(task);
      if (!planSource.approval) {
        try {
          lastPlan = await this.planTask(task, target);
          this.createRunEvent(task.id, run.id, 'info', 'planning_completed', {
            stepCount: lastPlan.steps.length,
            confidence: lastPlan.confidence,
          });
          const review = await this.critic.validate(lastPlan, listToolDefinitions(this.tools).filter((tool) => target.capabilities.includes(tool.capability)));
          lastPlan = review.plan;
          task = this.transitionTask(task, 'validating');
          this.transitionRun(this.database.getRun(run.id) ?? run, 'validating');

          if (!review.valid) {
            this.metrics.recordFailure('plan_validation');
            this.memory.recordFailure(`plan:${run.id}`, { reason: review.feedback.join('; ') || 'Plan validation failed.' });
            this.createRunEvent(task.id, run.id, 'error', 'plan_invalid', { feedback: review.feedback });
            this.finishRun(run, 'failed');
            task = this.transitionTask(task, 'failed');
            const decision = await this.supervisor.decide({
              hadFailure: true,
              iteration,
              maxIterations: this.config.limits.max_iterations,
              failures: review.feedback,
            });
            if (decision.decision === 'replan' || decision.decision === 'retry_same_step') {
              this.metrics.recordRetry();
              task = this.transitionTask(task, 'retryable');
              continue;
            }

            task = this.transitionTask(task, 'escalated');
            break;
          }
        } catch (error) {
          const failureMessage = error instanceof Error ? error.message : 'Plan generation failed.';
          this.metrics.recordFailure('plan_generation');
          this.memory.recordFailure(`plan:${run.id}`, { reason: failureMessage });
          this.createRunEvent(task.id, run.id, 'error', 'plan_generation_failed', { error: failureMessage });
          this.finishRun(run, 'failed');
          task = this.transitionTask(task, 'failed');
          const decision = await this.supervisor.decide({
            hadFailure: true,
            iteration,
            maxIterations: this.config.limits.max_iterations,
            failures: [failureMessage],
          });
          if (decision.decision === 'replan' || decision.decision === 'retry_same_step') {
            this.metrics.recordRetry();
            task = this.transitionTask(task, 'retryable');
            continue;
          }

          task = this.transitionTask(task, 'escalated');
          break;
        }
      } else {
        lastPlan = planSource.plan;
        task = this.transitionTask(task, 'validating');
        this.transitionRun(this.database.getRun(run.id) ?? run, 'validating');
      }

      task = this.transitionTask(task, 'executing');
      this.transitionRun(this.database.getRun(run.id) ?? run, 'executing');

      let hadFailure = false;
      let verifiedSteps = 0;
      const failures: string[] = [];

      for (const [index, step] of lastPlan.steps.entries()) {
        const tool = this.tools.get(step.tool);
        if (!tool) {
          hadFailure = true;
          failures.push(`Unknown tool ${step.tool}.`);
          break;
        }

        if (!target.capabilities.includes(tool.capability)) {
          hadFailure = true;
          failures.push(`Capability ${tool.capability} is not enabled for target ${target.id}.`);
          break;
        }

        const stepRecord = this.database.createStep(run.id, index, step.tool, step.input, step.expected);
        this.transitionStep(stepRecord, 'started');
        this.createRunEvent(task.id, run.id, 'info', 'step_started', {
          step: step.tool,
          stepIndex: index,
        });
        const approvalMatchesCurrentStep =
          planSource.approval &&
          planSource.approval.status === 'approved' &&
          planSource.approval.step_index === index &&
          planSource.approval.tool === step.tool;

        const policyDecision = approvalMatchesCurrentStep
          ? { kind: 'allow', reason: `Approved step ${step.tool} is cleared for execution.` }
          : this.policy.evaluateStep(
              {
                tool: step.tool,
                capability: tool.capability,
                input: step.input,
              },
              {
                startedAt,
                completedSteps: index,
                changedFiles: this.getChangedFilesSet(run.id).size,
                iteration,
              },
            );

        if (policyDecision.kind === 'deny') {
          hadFailure = true;
          failures.push(policyDecision.reason);
          this.database.completeStep(
            stepRecord.id,
            {
              policy: policyDecision.reason,
            },
            'blocked',
          );
          createdArtifacts.push(
            ...this.createArtifacts(
              this.database.getStep(stepRecord.id) ?? stepRecord,
              { step, policy: policyDecision },
              {
                success: false,
                error: policyDecision.reason,
                evidence: {
                  summary: policyDecision.reason,
                  details: {},
                },
                changedFiles: [],
              },
              { verified: false, evidence: policyDecision.reason },
            ),
          );
          break;
        }

        if (policyDecision.kind === 'require_approval') {
          const awaitingStep = this.transitionStep(this.database.getStep(stepRecord.id) ?? stepRecord, 'awaiting_approval');
          const approval = this.database.createApprovalRequest(task.id, run.id, index, step.tool, step.input, policyDecision.reason);
          createdApprovals.push(approval);
          this.createRunEvent(task.id, run.id, 'warning', 'approval_requested', { approvalId: approval.id, step: step.tool });
          this.emitRuntimeUpdate({
            kind: 'approval_changed',
            taskId: task.id,
            runId: run.id,
            approvalId: approval.id,
            status: approval.status,
          });
          createdArtifacts.push(
            ...this.createArtifacts(
              awaitingStep,
              { step, policy: policyDecision },
              {
                success: false,
                error: policyDecision.reason,
                evidence: {
                  summary: policyDecision.reason,
                  details: {
                    approvalId: approval.id,
                  },
                },
                changedFiles: [],
              },
              { verified: false, evidence: policyDecision.reason },
            ),
          );
          this.finishRun(run, 'awaiting_approval');
          task = this.transitionTask(task, 'awaiting_approval');
          return {
            task,
            runId: run.id,
            state: task.state,
            plan: lastPlan,
            artifacts: createdArtifacts,
            approvals: createdApprovals,
            metrics: this.metrics.snapshot(),
          };
        }

        const result = toolResultSchema.parse(await this.executor.run(step, (toolName, input) => executeTool(this.tools, toolName, input, executionContext)));
        const verification = this.verifier.check(step, result);
        const completedStep = this.database.completeStep(
          stepRecord.id,
          {
            result,
            verification,
          },
          verification.verified ? 'completed' : 'failed',
        );

        createdArtifacts.push(...this.createArtifacts(completedStep, { step }, result, verification));
        this.createRunEvent(task.id, run.id, verification.verified ? 'info' : 'error', 'step_completed', {
          step: step.tool,
          verified: verification.verified,
        });

        for (const changedFile of result.changedFiles) {
          this.getChangedFilesSet(run.id).add(changedFile);
        }

        if (verification.verified) {
          verifiedSteps += 1;
          this.memory.recordSuccessfulPattern(step.tool, {
            input: step.input,
            target_id: task.target_id,
            timestamp: new Date().toISOString(),
          });
        } else {
          hadFailure = true;
          failures.push(verification.evidence);
          this.memory.recordFailure(`step:${completedStep.id}`, {
            tool: step.tool,
            error: verification.evidence,
          });
          break;
        }
      }

      task = this.transitionTask(task, 'verifying');
      this.transitionRun(this.database.getRun(run.id) ?? run, 'verifying');
      const evaluation = await this.evaluator.evaluate({
        totalSteps: lastPlan.steps.length,
        verifiedSteps,
        failures,
      });
      this.database.createEvaluation(run.id, evaluation.score, evaluation.issues, evaluation.suggestions);
      this.memory.recordRun(run.id, {
        score: evaluation.score,
        failures,
        target_id: task.target_id,
      });

      if (hadFailure) {
        this.metrics.recordFailure(failures[0] ?? 'execution_failure');
        this.finishRun(run, 'failed');
        task = this.transitionTask(task, 'failed');
        const decision = await this.supervisor.decide({
          hadFailure: true,
          iteration,
          maxIterations: this.config.limits.max_iterations,
          failures,
        });
        this.createRunEvent(task.id, run.id, decision.decision === 'escalate' ? 'error' : 'warning', 'supervisor_decision', {
          decision: decision.decision,
          reason: decision.reason,
        });

        if (decision.decision === 'retry_same_step' || decision.decision === 'replan') {
          this.metrics.recordRetry();
          task = this.transitionTask(task, 'retryable');
          continue;
        }

        task = this.transitionTask(task, 'escalated');
        this.metrics.recordRun(false, lastPlan.steps.length);
        break;
      }

      if (planSource.approval) {
        this.database.updateApprovalStatus(planSource.approval.id, 'consumed');
      }

      this.finishRun(run, 'completed');
      this.createRunEvent(task.id, run.id, 'info', 'run_completed', {
        verifiedSteps,
        totalSteps: lastPlan.steps.length,
        score: evaluation.score,
      });
      task = this.transitionTask(task, 'completed');
      this.metrics.recordRun(true, lastPlan.steps.length);
      break;
    }

    const refreshedTask = this.database.getTask(task.id);
    if (!refreshedTask) {
      throw new NotFoundError(`Task ${task.id} disappeared during execution.`, { taskId: task.id });
    }

    return {
      task: refreshedTask,
      runId: lastRunId,
      state: refreshedTask.state,
      plan: lastPlan,
      artifacts: createdArtifacts,
      approvals: createdApprovals,
      metrics: this.metrics.snapshot(),
    };
  }
}
