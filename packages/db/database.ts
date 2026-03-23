import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { z } from 'zod';
import {
  approvalRequestRecordSchema,
  artifactRecordSchema,
  evaluationRecordSchema,
  maintenanceEventRecordSchema,
  memoryEntryRecordSchema,
  runEventRecordSchema,
  runRecordSchema,
  scheduleRecordSchema,
  stepRecordSchema,
  targetRecordSchema,
  taskRecordSchema,
  type ApprovalRequestRecord,
  type ArtifactRecord,
  type EvaluationRecord,
  type MaintenanceEventRecord,
  type RunEventRecord,
  type RunRecord,
  type ScheduleRecord,
  type StepRecord,
  type TargetRecord,
  type TaskRecord,
} from '../domain';
import { NotFoundError } from '../errors';

const requireFromModule = createRequire(__filename);
const nodeSqliteSpecifier = `node:${'sqlite'}`;
const nodeSqliteModule: typeof import('node:sqlite') = requireFromModule(nodeSqliteSpecifier);
const { DatabaseSync } = nodeSqliteModule;

export type JsonObject = Record<string, unknown>;

export interface CleanupSummary {
  deletedArtifactIds: string[];
  deletedRunEventIds: string[];
  deletedMemoryEntryIds: string[];
}

export interface PageInput {
  limit: number;
  offset: number;
}

export interface PageInfo {
  total: number;
  limit: number;
  offset: number;
}

export interface RunEventFilter {
  level?: RunEventRecord['level'];
}

export interface MaintenanceEventFilter {
  operation?: MaintenanceEventRecord['operation'];
  dryRun?: boolean;
  trigger?: MaintenanceEventRecord['trigger'];
}

const rawRowArraySchema = z.array(z.unknown());

function stringifyJson(value: JsonObject): string {
  return JSON.stringify(value);
}

function parseObjectRow<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

function parseArrayRows<T>(schema: z.ZodType<T>, value: unknown): T[] {
  const rows = rawRowArraySchema.parse(value);
  return rows.map((row) => parseObjectRow(schema, row));
}

function parseNullableRecord<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  return parseObjectRow(schema, value);
}

function buildAgeCutoffIso(maxAgeDays: number | null | undefined): string | undefined {
  if (maxAgeDays === undefined || maxAgeDays === null) {
    return undefined;
  }

  return new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
}

function appendWhereClause(clauses: string[], sql: string): void {
  clauses.push(sql);
}

const inspectedRunSchema = runRecordSchema.extend({
  steps: z.array(stepRecordSchema),
});

export class RuntimeDatabase {
  private readonly sqlite: InstanceType<typeof DatabaseSync>;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.sqlite = new DatabaseSync(dbPath);
    this.sqlite.exec('PRAGMA journal_mode = WAL;');
    this.sqlite.exec('PRAGMA busy_timeout = 5000;');
    this.initialize();
  }

  close(): void {
    this.sqlite.close();
  }

  private initialize(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        state TEXT NOT NULL,
        priority INTEGER NOT NULL,
        target_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        "index" INTEGER NOT NULL,
        tool TEXT NOT NULL,
        input_json TEXT NOT NULL,
        expected_json TEXT NOT NULL,
        output_json TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        step_id TEXT NOT NULL,
        type TEXT NOT NULL,
        path TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evaluations (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        score REAL NOT NULL,
        issues_json TEXT NOT NULL,
        suggestions_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        tool TEXT NOT NULL,
        input_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        target_id TEXT,
        interval_seconds INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        last_enqueued_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS targets (
        id TEXT PRIMARY KEY,
        root TEXT NOT NULL,
        read_paths_json TEXT NOT NULL,
        write_paths_json TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS maintenance_events (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        trigger TEXT NOT NULL,
        dry_run INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.ensureColumn('tasks', 'target_id', "TEXT NOT NULL DEFAULT 'local'");
    this.ensureColumn('steps', 'expected_json', "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn('artifacts', 'created_at', "TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'");
    this.ensureColumn('maintenance_events', 'trigger', "TEXT NOT NULL DEFAULT 'manual'");
    this.ensureColumn('targets', 'read_paths_json', "TEXT NOT NULL DEFAULT '{\"read_paths\":[\".\"]}'");
    this.ensureColumn('targets', 'write_paths_json', "TEXT NOT NULL DEFAULT '{\"write_paths\":[\".\"]}'");
    this.ensureColumn('targets', 'capabilities_json', "TEXT NOT NULL DEFAULT '{\"capabilities\":[\"fs.read\"]}'");
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const columns = this.sqlite.prepare(`PRAGMA table_info(${tableName})`).all();
    const hasColumn = rawRowArraySchema
      .parse(columns)
      .some((column) => z.object({ name: z.string() }).parse(column).name === columnName);

    if (!hasColumn) {
      this.sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  createTask(goal: string, targetId: string, priority = 0, state: TaskRecord['state'] = 'queued'): TaskRecord {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      goal,
      state,
      priority,
      target_id: targetId,
      created_at: now,
      updated_at: now,
    };
    this.sqlite
      .prepare('INSERT INTO tasks (id, goal, state, priority, target_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.goal, row.state, row.priority, row.target_id, row.created_at, row.updated_at);
    return taskRecordSchema.parse(row);
  }

  updateTaskState(taskId: string, state: TaskRecord['state']): TaskRecord {
    const updatedAt = new Date().toISOString();
    this.sqlite.prepare('UPDATE tasks SET state = ?, updated_at = ? WHERE id = ?').run(state, updatedAt, taskId);
    const task = this.getTask(taskId);
    if (!task) {
      throw new NotFoundError(`Task ${taskId} not found after state update.`, { taskId });
    }

    return task;
  }

  getTask(taskId: string): TaskRecord | undefined {
    return parseNullableRecord(taskRecordSchema, this.sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId));
  }

  listTasks(): TaskRecord[] {
    return parseArrayRows(taskRecordSchema, this.sqlite.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all());
  }

  countTasksByTarget(targetId: string): number {
    const row = this.sqlite.prepare('SELECT COUNT(*) AS count FROM tasks WHERE target_id = ?').get(targetId);
    return z.object({ count: z.number() }).parse(row).count;
  }

  createRun(taskId: string, iteration: number, status: RunRecord['status'] = 'queued'): RunRecord {
    const row = {
      id: randomUUID(),
      task_id: taskId,
      status,
      iteration,
      started_at: new Date().toISOString(),
      finished_at: null,
    };
    this.sqlite
      .prepare('INSERT INTO runs (id, task_id, status, iteration, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, row.task_id, row.status, row.iteration, row.started_at, row.finished_at);
    return runRecordSchema.parse(row);
  }

  updateRunState(runId: string, status: RunRecord['status']): RunRecord {
    this.sqlite.prepare('UPDATE runs SET status = ? WHERE id = ?').run(status, runId);
    const run = this.getRun(runId);
    if (!run) {
      throw new NotFoundError(`Run ${runId} not found after update.`, { runId });
    }

    return run;
  }

  finishRun(runId: string, status: RunRecord['status']): RunRecord {
    const finishedAt = new Date().toISOString();
    this.sqlite.prepare('UPDATE runs SET status = ?, finished_at = ? WHERE id = ?').run(status, finishedAt, runId);
    const run = this.getRun(runId);
    if (!run) {
      throw new NotFoundError(`Run ${runId} not found after finish.`, { runId });
    }

    return run;
  }

  getRun(runId: string): RunRecord | undefined {
    return parseNullableRecord(runRecordSchema, this.sqlite.prepare('SELECT * FROM runs WHERE id = ?').get(runId));
  }

  listRunsByTask(taskId: string): RunRecord[] {
    return parseArrayRows(runRecordSchema, this.sqlite.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC').all(taskId));
  }

  countRunsByTask(taskId: string): number {
    const row = this.sqlite.prepare('SELECT COUNT(*) AS count FROM runs WHERE task_id = ?').get(taskId);
    return z.object({ count: z.number() }).parse(row).count;
  }

  listRunsByTaskPage(taskId: string, page: PageInput): RunRecord[] {
    return parseArrayRows(
      runRecordSchema,
      this.sqlite.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?').all(taskId, page.limit, page.offset),
    );
  }

  createStep(
    runId: string,
    index: number,
    tool: string,
    input: JsonObject,
    expected: JsonObject,
    status: StepRecord['status'] = 'queued',
  ): StepRecord {
    const row = {
      id: randomUUID(),
      run_id: runId,
      index,
      tool,
      input_json: stringifyJson(input),
      expected_json: stringifyJson(expected),
      output_json: null,
      status,
      started_at: new Date().toISOString(),
      finished_at: null,
    };
    this.sqlite
      .prepare(
        'INSERT INTO steps (id, run_id, "index", tool, input_json, expected_json, output_json, status, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        row.id,
        row.run_id,
        row.index,
        row.tool,
        row.input_json,
        row.expected_json,
        row.output_json,
        row.status,
        row.started_at,
        row.finished_at,
      );
    return stepRecordSchema.parse(row);
  }

  updateStepStatus(stepId: string, status: StepRecord['status']): StepRecord {
    this.sqlite.prepare('UPDATE steps SET status = ? WHERE id = ?').run(status, stepId);
    const step = this.getStep(stepId);
    if (!step) {
      throw new NotFoundError(`Step ${stepId} not found after update.`, { stepId });
    }

    return step;
  }

  completeStep(stepId: string, output: JsonObject, status: StepRecord['status']): StepRecord {
    const finishedAt = new Date().toISOString();
    this.sqlite.prepare('UPDATE steps SET output_json = ?, status = ?, finished_at = ? WHERE id = ?').run(stringifyJson(output), status, finishedAt, stepId);
    const step = this.getStep(stepId);
    if (!step) {
      throw new NotFoundError(`Step ${stepId} not found after completion.`, { stepId });
    }

    return step;
  }

  getStep(stepId: string): StepRecord | undefined {
    return parseNullableRecord(stepRecordSchema, this.sqlite.prepare('SELECT * FROM steps WHERE id = ?').get(stepId));
  }

  listStepsByRun(runId: string): StepRecord[] {
    return parseArrayRows(stepRecordSchema, this.sqlite.prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY "index" ASC').all(runId));
  }

  createArtifact(stepId: string, type: ArtifactRecord['type'], artifactPath: string, metadata: JsonObject): ArtifactRecord {
    const row = {
      id: randomUUID(),
      step_id: stepId,
      type,
      path: artifactPath,
      metadata_json: stringifyJson(metadata),
      created_at: new Date().toISOString(),
    };
    this.sqlite
      .prepare('INSERT INTO artifacts (id, step_id, type, path, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, row.step_id, row.type, row.path, row.metadata_json, row.created_at);
    return artifactRecordSchema.parse(row);
  }

  listArtifactsByStep(stepId: string): ArtifactRecord[] {
    return parseArrayRows(artifactRecordSchema, this.sqlite.prepare('SELECT * FROM artifacts WHERE step_id = ? ORDER BY rowid ASC').all(stepId));
  }

  getArtifact(artifactId: string): ArtifactRecord | undefined {
    return parseNullableRecord(artifactRecordSchema, this.sqlite.prepare('SELECT * FROM artifacts WHERE id = ?').get(artifactId));
  }

  createEvaluation(runId: string, score: number, issues: string[], suggestions: string[]): EvaluationRecord {
    const row = {
      id: randomUUID(),
      run_id: runId,
      score,
      issues_json: stringifyJson({ issues }),
      suggestions_json: stringifyJson({ suggestions }),
    };
    this.sqlite
      .prepare('INSERT INTO evaluations (id, run_id, score, issues_json, suggestions_json) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.run_id, row.score, row.issues_json, row.suggestions_json);
    return evaluationRecordSchema.parse(row);
  }

  listEvaluationsByRun(runId: string): EvaluationRecord[] {
    return parseArrayRows(evaluationRecordSchema, this.sqlite.prepare('SELECT * FROM evaluations WHERE run_id = ? ORDER BY rowid ASC').all(runId));
  }

  upsertMemory(scope: MemoryEntryRecord['scope'], key: string, value: JsonObject): void {
    this.sqlite.prepare('DELETE FROM memory_entries WHERE scope = ? AND key = ?').run(scope, key);
    this.sqlite
      .prepare('INSERT INTO memory_entries (id, scope, key, value_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), scope, key, stringifyJson(value), new Date().toISOString());
  }

  listMemory(scope?: MemoryEntryRecord['scope']): MemoryEntryRecord[] {
    if (scope) {
      return parseArrayRows(memoryEntryRecordSchema, this.sqlite.prepare('SELECT * FROM memory_entries WHERE scope = ? ORDER BY created_at DESC').all(scope));
    }

    return parseArrayRows(memoryEntryRecordSchema, this.sqlite.prepare('SELECT * FROM memory_entries ORDER BY created_at DESC').all());
  }

  createApprovalRequest(taskId: string, runId: string, stepIndex: number, tool: string, input: JsonObject, reason: string): ApprovalRequestRecord {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      task_id: taskId,
      run_id: runId,
      step_index: stepIndex,
      tool,
      input_json: stringifyJson(input),
      reason,
      status: 'pending',
      created_at: now,
      updated_at: now,
    };
    this.sqlite
      .prepare(
        'INSERT INTO approval_requests (id, task_id, run_id, step_index, tool, input_json, reason, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        row.id,
        row.task_id,
        row.run_id,
        row.step_index,
        row.tool,
        row.input_json,
        row.reason,
        row.status,
        row.created_at,
        row.updated_at,
      );
    return approvalRequestRecordSchema.parse(row);
  }

  updateApprovalStatus(approvalId: string, status: ApprovalRequestRecord['status']): ApprovalRequestRecord {
    const updatedAt = new Date().toISOString();
    this.sqlite.prepare('UPDATE approval_requests SET status = ?, updated_at = ? WHERE id = ?').run(status, updatedAt, approvalId);
    const approval = this.getApprovalRequest(approvalId);
    if (!approval) {
      throw new NotFoundError(`Approval ${approvalId} not found after update.`, { approvalId });
    }

    return approval;
  }

  getApprovalRequest(approvalId: string): ApprovalRequestRecord | undefined {
    return parseNullableRecord(approvalRequestRecordSchema, this.sqlite.prepare('SELECT * FROM approval_requests WHERE id = ?').get(approvalId));
  }

  listApprovals(status?: ApprovalRequestRecord['status']): ApprovalRequestRecord[] {
    if (status) {
      return parseArrayRows(
        approvalRequestRecordSchema,
        this.sqlite.prepare('SELECT * FROM approval_requests WHERE status = ? ORDER BY created_at DESC').all(status),
      );
    }

    return parseArrayRows(approvalRequestRecordSchema, this.sqlite.prepare('SELECT * FROM approval_requests ORDER BY created_at DESC').all());
  }

  findApprovedApprovalForTask(taskId: string): ApprovalRequestRecord | undefined {
    return parseNullableRecord(
      approvalRequestRecordSchema,
      this.sqlite
        .prepare('SELECT * FROM approval_requests WHERE task_id = ? AND status = ? ORDER BY updated_at DESC LIMIT 1')
        .get(taskId, 'approved'),
    );
  }

  upsertSchedule(id: string, goal: string, targetId: string | undefined, intervalSeconds: number, enabled: boolean): ScheduleRecord {
    const now = new Date().toISOString();
    const existing = this.getSchedule(id);
    if (existing) {
      this.sqlite
        .prepare('UPDATE schedules SET goal = ?, target_id = ?, interval_seconds = ?, enabled = ?, updated_at = ? WHERE id = ?')
        .run(goal, targetId ?? null, intervalSeconds, enabled ? 1 : 0, now, id);
    } else {
      this.sqlite
        .prepare(
          'INSERT INTO schedules (id, goal, target_id, interval_seconds, enabled, last_enqueued_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, goal, targetId ?? null, intervalSeconds, enabled ? 1 : 0, null, now, now);
    }

    const schedule = this.getSchedule(id);
    if (!schedule) {
      throw new NotFoundError(`Schedule ${id} not found after upsert.`, { scheduleId: id });
    }

    return schedule;
  }

  markScheduleEnqueued(id: string): ScheduleRecord {
    const now = new Date().toISOString();
    this.sqlite.prepare('UPDATE schedules SET last_enqueued_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
    const schedule = this.getSchedule(id);
    if (!schedule) {
      throw new NotFoundError(`Schedule ${id} not found after markScheduleEnqueued.`, { scheduleId: id });
    }

    return schedule;
  }

  getSchedule(id: string): ScheduleRecord | undefined {
    return parseNullableRecord(scheduleRecordSchema, this.sqlite.prepare('SELECT * FROM schedules WHERE id = ?').get(id));
  }

  listSchedules(): ScheduleRecord[] {
    return parseArrayRows(scheduleRecordSchema, this.sqlite.prepare('SELECT * FROM schedules ORDER BY created_at ASC').all());
  }

  upsertTarget(id: string, root: string, readPaths: string[], writePaths: string[], capabilities: string[]): TargetRecord {
    const now = new Date().toISOString();
    const existing = this.getTarget(id);
    const readPathsJson = stringifyJson({ read_paths: readPaths });
    const writePathsJson = stringifyJson({ write_paths: writePaths });
    const capabilitiesJson = stringifyJson({ capabilities });
    if (existing) {
      this.sqlite
        .prepare('UPDATE targets SET root = ?, read_paths_json = ?, write_paths_json = ?, capabilities_json = ?, updated_at = ? WHERE id = ?')
        .run(root, readPathsJson, writePathsJson, capabilitiesJson, now, id);
    } else {
      this.sqlite
        .prepare(
          'INSERT INTO targets (id, root, read_paths_json, write_paths_json, capabilities_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, root, readPathsJson, writePathsJson, capabilitiesJson, now, now);
    }

    const target = this.getTarget(id);
    if (!target) {
      throw new NotFoundError(`Target ${id} not found after upsert.`, { targetId: id });
    }

    return target;
  }

  getTarget(id: string): TargetRecord | undefined {
    return parseNullableRecord(targetRecordSchema, this.sqlite.prepare('SELECT * FROM targets WHERE id = ?').get(id));
  }

  listTargets(): TargetRecord[] {
    return parseArrayRows(targetRecordSchema, this.sqlite.prepare('SELECT * FROM targets ORDER BY created_at ASC').all());
  }

  deleteTarget(id: string): void {
    this.sqlite.prepare('DELETE FROM targets WHERE id = ?').run(id);
  }

  createRunEvent(runId: string, level: RunEventRecord['level'], message: string, payload: JsonObject): RunEventRecord {
    const row = {
      id: randomUUID(),
      run_id: runId,
      level,
      message,
      payload_json: stringifyJson(payload),
      created_at: new Date().toISOString(),
    };
    this.sqlite
      .prepare('INSERT INTO run_events (id, run_id, level, message, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, row.run_id, row.level, row.message, row.payload_json, row.created_at);
    return runEventRecordSchema.parse(row);
  }

  listRunEvents(runId: string): RunEventRecord[] {
    return parseArrayRows(runEventRecordSchema, this.sqlite.prepare('SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC').all(runId));
  }

  countRunEvents(runId: string, filter?: RunEventFilter): number {
    const clauses = ['run_id = ?'];
    const args: Array<string | number> = [runId];
    if (filter?.level) {
      appendWhereClause(clauses, 'level = ?');
      args.push(filter.level);
    }
    const row = this.sqlite.prepare(`SELECT COUNT(*) AS count FROM run_events WHERE ${clauses.join(' AND ')}`).get(...args);
    return z.object({ count: z.number() }).parse(row).count;
  }

  listRunEventsPage(runId: string, page: PageInput, filter?: RunEventFilter): RunEventRecord[] {
    const clauses = ['run_id = ?'];
    const args: Array<string | number> = [runId];
    if (filter?.level) {
      appendWhereClause(clauses, 'level = ?');
      args.push(filter.level);
    }
    return parseArrayRows(
      runEventRecordSchema,
      this.sqlite
        .prepare(`SELECT * FROM run_events WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC LIMIT ? OFFSET ?`)
        .all(...args, page.limit, page.offset),
    );
  }

  createMaintenanceEvent(
    operation: MaintenanceEventRecord['operation'],
    status: MaintenanceEventRecord['status'],
    trigger: MaintenanceEventRecord['trigger'],
    dryRun: boolean,
    payload: JsonObject,
    result: JsonObject,
  ): MaintenanceEventRecord {
    const row = {
      id: randomUUID(),
      operation,
      status,
      trigger,
      dry_run: dryRun ? 1 : 0,
      payload_json: stringifyJson(payload),
      result_json: stringifyJson(result),
      created_at: new Date().toISOString(),
    };
    this.sqlite
      .prepare('INSERT INTO maintenance_events (id, operation, status, trigger, dry_run, payload_json, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.operation, row.status, row.trigger, row.dry_run, row.payload_json, row.result_json, row.created_at);
    return maintenanceEventRecordSchema.parse(row);
  }

  countMaintenanceEvents(filter?: MaintenanceEventFilter): number {
    const clauses: string[] = [];
    const args: Array<string | number> = [];
    if (filter?.operation) {
      appendWhereClause(clauses, 'operation = ?');
      args.push(filter.operation);
    }
    if (filter?.dryRun !== undefined) {
      appendWhereClause(clauses, 'dry_run = ?');
      args.push(filter.dryRun ? 1 : 0);
    }
    if (filter?.trigger) {
      appendWhereClause(clauses, 'trigger = ?');
      args.push(filter.trigger);
    }
    const whereClause = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const row = this.sqlite.prepare(`SELECT COUNT(*) AS count FROM maintenance_events${whereClause}`).get(...args);
    return z.object({ count: z.number() }).parse(row).count;
  }

  listMaintenanceEvents(page: PageInput, filter?: MaintenanceEventFilter): MaintenanceEventRecord[] {
    const clauses: string[] = [];
    const args: Array<string | number> = [];
    if (filter?.operation) {
      appendWhereClause(clauses, 'operation = ?');
      args.push(filter.operation);
    }
    if (filter?.dryRun !== undefined) {
      appendWhereClause(clauses, 'dry_run = ?');
      args.push(filter.dryRun ? 1 : 0);
    }
    if (filter?.trigger) {
      appendWhereClause(clauses, 'trigger = ?');
      args.push(filter.trigger);
    }
    const whereClause = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    return parseArrayRows(
      maintenanceEventRecordSchema,
      this.sqlite.prepare(`SELECT * FROM maintenance_events${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...args, page.limit, page.offset),
    );
  }

  getLatestMaintenanceEvent(filter?: MaintenanceEventFilter): MaintenanceEventRecord | undefined {
    const clauses: string[] = [];
    const args: Array<string | number> = [];
    if (filter?.operation) {
      appendWhereClause(clauses, 'operation = ?');
      args.push(filter.operation);
    }
    if (filter?.dryRun !== undefined) {
      appendWhereClause(clauses, 'dry_run = ?');
      args.push(filter.dryRun ? 1 : 0);
    }
    if (filter?.trigger) {
      appendWhereClause(clauses, 'trigger = ?');
      args.push(filter.trigger);
    }
    const whereClause = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    return parseNullableRecord(
      maintenanceEventRecordSchema,
      this.sqlite.prepare(`SELECT * FROM maintenance_events${whereClause} ORDER BY created_at DESC LIMIT 1`).get(...args),
    );
  }

  inspectTask(taskId: string): { task?: TaskRecord; runs: Array<z.infer<typeof inspectedRunSchema>> } {
    const task = this.getTask(taskId);
    const runs = this.listRunsByTask(taskId).map((run) =>
      inspectedRunSchema.parse({
        ...run,
        steps: this.listStepsByRun(run.id),
      }),
    );

    return {
      task,
      runs,
    };
  }

  getTaskTimeline(taskId: string, page?: PageInput): {
    task?: TaskRecord;
    approvals: ApprovalRequestRecord[];
    page: PageInfo;
    runs: Array<z.infer<typeof inspectedRunSchema> & { events: RunEventRecord[]; evaluations: EvaluationRecord[] }>;
  } {
    const task = this.getTask(taskId);
    const approvals = parseArrayRows(
      approvalRequestRecordSchema,
      this.sqlite.prepare('SELECT * FROM approval_requests WHERE task_id = ? ORDER BY created_at ASC').all(taskId),
    );
    const resolvedPage = page ?? { limit: 20, offset: 0 };
    const total = this.countRunsByTask(taskId);
    const runs = this.listRunsByTaskPage(taskId, resolvedPage).map((run) => ({
      ...inspectedRunSchema.parse({
        ...run,
        steps: this.listStepsByRun(run.id),
      }),
      events: this.listRunEvents(run.id),
      evaluations: this.listEvaluationsByRun(run.id),
    }));

    return {
      task,
      approvals,
      page: {
        total,
        limit: resolvedPage.limit,
        offset: resolvedPage.offset,
      },
      runs,
    };
  }

  cleanupState(options: {
    keepLatestArtifacts: number;
    keepLatestRunEvents: number;
    keepLatestMemoryEntries: number;
    maxArtifactAgeDays?: number | null;
    maxRunEventAgeDays?: number | null;
    maxMemoryEntryAgeDays?: number | null;
    dryRun: boolean;
  }): CleanupSummary {
    const artifactRows = parseArrayRows(
      z.object({ id: z.string(), path: z.string(), created_at: z.string().datetime() }),
      this.sqlite.prepare('SELECT id, path, created_at FROM artifacts ORDER BY created_at DESC, rowid DESC').all(),
    );
    const runEventRows = parseArrayRows(
      z.object({ id: z.string(), created_at: z.string().datetime() }),
      this.sqlite.prepare('SELECT id, created_at FROM run_events ORDER BY created_at DESC, rowid DESC').all(),
    );
    const memoryRows = parseArrayRows(
      z.object({ id: z.string(), created_at: z.string().datetime() }),
      this.sqlite.prepare('SELECT id, created_at FROM memory_entries ORDER BY created_at DESC, rowid DESC').all(),
    );

    const artifactCutoff = buildAgeCutoffIso(options.maxArtifactAgeDays);
    const runEventCutoff = buildAgeCutoffIso(options.maxRunEventAgeDays);
    const memoryCutoff = buildAgeCutoffIso(options.maxMemoryEntryAgeDays);

    const removableArtifactsByCount = artifactRows.slice(options.keepLatestArtifacts);
    const removableArtifactsByAge = artifactCutoff
      ? artifactRows.filter((artifact) => artifact.created_at < artifactCutoff)
      : [];
    const removableArtifacts = [...new Map([...removableArtifactsByCount, ...removableArtifactsByAge].map((artifact) => [artifact.id, artifact])).values()];

    const removableRunEventsByCount = runEventRows.slice(options.keepLatestRunEvents);
    const removableRunEventsByAge = runEventCutoff
      ? runEventRows.filter((runEvent) => runEvent.created_at < runEventCutoff)
      : [];
    const removableRunEvents = [...new Map([...removableRunEventsByCount, ...removableRunEventsByAge].map((runEvent) => [runEvent.id, runEvent])).values()];

    const removableMemoryRowsByCount = memoryRows.slice(options.keepLatestMemoryEntries);
    const removableMemoryRowsByAge = memoryCutoff
      ? memoryRows.filter((memoryEntry) => memoryEntry.created_at < memoryCutoff)
      : [];
    const removableMemoryRows = [...new Map([...removableMemoryRowsByCount, ...removableMemoryRowsByAge].map((memoryEntry) => [memoryEntry.id, memoryEntry])).values()];

    if (!options.dryRun) {
      for (const artifact of removableArtifacts) {
        this.sqlite.prepare('DELETE FROM artifacts WHERE id = ?').run(artifact.id);
      }

      for (const runEvent of removableRunEvents) {
        this.sqlite.prepare('DELETE FROM run_events WHERE id = ?').run(runEvent.id);
      }

      for (const memoryEntry of removableMemoryRows) {
        this.sqlite.prepare('DELETE FROM memory_entries WHERE id = ?').run(memoryEntry.id);
      }
    }

    return {
      deletedArtifactIds: removableArtifacts.map((artifact) => artifact.id),
      deletedRunEventIds: removableRunEvents.map((runEvent) => runEvent.id),
      deletedMemoryEntryIds: removableMemoryRows.map((memoryEntry) => memoryEntry.id),
    };
  }
}
