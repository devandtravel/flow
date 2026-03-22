import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

export interface TaskRecord {
  id: string;
  goal: string;
  state: string;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface RunRecord {
  id: string;
  task_id: string;
  status: string;
  iteration: number;
  started_at: string;
  finished_at: string | null;
}

export interface StepRecord {
  id: string;
  run_id: string;
  index: number;
  tool: string;
  input_json: string;
  output_json: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
}

export interface ArtifactRecord {
  id: string;
  step_id: string;
  type: string;
  path: string;
  metadata_json: string;
}

export interface EvaluationRecord {
  id: string;
  run_id: string;
  score: number;
  issues_json: string;
  suggestions_json: string;
}

function toJson(value: JsonValue): string {
  return JSON.stringify(value ?? null);
}

export class RuntimeDatabase {
  private readonly sqlite: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.sqlite = new DatabaseSync(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        state TEXT NOT NULL,
        priority INTEGER NOT NULL,
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
        metadata_json TEXT NOT NULL
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
    `);
  }

  close(): void {
    this.sqlite.close();
  }

  createTask(goal: string, priority = 0, state = 'queued'): TaskRecord {
    const now = new Date().toISOString();
    const task = {
      id: randomUUID(),
      goal,
      state,
      priority,
      created_at: now,
      updated_at: now,
    };
    this.sqlite
      .prepare('INSERT INTO tasks (id, goal, state, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(task.id, task.goal, task.state, task.priority, task.created_at, task.updated_at);
    return task;
  }

  updateTaskState(taskId: string, state: string): TaskRecord {
    const updatedAt = new Date().toISOString();
    this.sqlite.prepare('UPDATE tasks SET state = ?, updated_at = ? WHERE id = ?').run(state, updatedAt, taskId);
    return this.getTask(taskId)!;
  }

  getTask(taskId: string): TaskRecord | undefined {
    return this.sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRecord | undefined;
  }

  listTasks(): TaskRecord[] {
    return this.sqlite.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as TaskRecord[];
  }

  createRun(taskId: string, iteration: number, status = 'running'): RunRecord {
    const run = {
      id: randomUUID(),
      task_id: taskId,
      status,
      iteration,
      started_at: new Date().toISOString(),
      finished_at: null,
    };
    this.sqlite
      .prepare('INSERT INTO runs (id, task_id, status, iteration, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(run.id, run.task_id, run.status, run.iteration, run.started_at, run.finished_at);
    return run;
  }

  finishRun(runId: string, status: string): RunRecord {
    const finishedAt = new Date().toISOString();
    this.sqlite.prepare('UPDATE runs SET status = ?, finished_at = ? WHERE id = ?').run(status, finishedAt, runId);
    return this.getRun(runId)!;
  }

  getRun(runId: string): RunRecord | undefined {
    return this.sqlite.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRecord | undefined;
  }

  listRunsByTask(taskId: string): RunRecord[] {
    return this.sqlite.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC').all(taskId) as RunRecord[];
  }

  createStep(runId: string, index: number, tool: string, input: JsonValue, status = 'started'): StepRecord {
    const step = {
      id: randomUUID(),
      run_id: runId,
      index,
      tool,
      input_json: toJson(input),
      output_json: null,
      status,
      started_at: new Date().toISOString(),
      finished_at: null,
    };
    this.sqlite
      .prepare(
        'INSERT INTO steps (id, run_id, "index", tool, input_json, output_json, status, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(step.id, step.run_id, step.index, step.tool, step.input_json, step.output_json, step.status, step.started_at, step.finished_at);
    return step;
  }

  completeStep(stepId: string, output: JsonValue, status: string): StepRecord {
    const finishedAt = new Date().toISOString();
    this.sqlite.prepare('UPDATE steps SET output_json = ?, status = ?, finished_at = ? WHERE id = ?').run(toJson(output), status, finishedAt, stepId);
    return this.getStep(stepId)!;
  }

  getStep(stepId: string): StepRecord | undefined {
    return this.sqlite.prepare('SELECT * FROM steps WHERE id = ?').get(stepId) as StepRecord | undefined;
  }

  listStepsByRun(runId: string): StepRecord[] {
    return this.sqlite.prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY "index" ASC').all(runId) as StepRecord[];
  }

  createArtifact(stepId: string, type: string, artifactPath: string, metadata: JsonValue): ArtifactRecord {
    const artifact = {
      id: randomUUID(),
      step_id: stepId,
      type,
      path: artifactPath,
      metadata_json: toJson(metadata),
    };
    this.sqlite
      .prepare('INSERT INTO artifacts (id, step_id, type, path, metadata_json) VALUES (?, ?, ?, ?, ?)')
      .run(artifact.id, artifact.step_id, artifact.type, artifact.path, artifact.metadata_json);
    return artifact;
  }

  listArtifactsByStep(stepId: string): ArtifactRecord[] {
    return this.sqlite.prepare('SELECT * FROM artifacts WHERE step_id = ? ORDER BY rowid ASC').all(stepId) as ArtifactRecord[];
  }

  getArtifact(artifactId: string): ArtifactRecord | undefined {
    return this.sqlite.prepare('SELECT * FROM artifacts WHERE id = ?').get(artifactId) as ArtifactRecord | undefined;
  }

  createEvaluation(runId: string, score: number, issues: JsonValue, suggestions: JsonValue): EvaluationRecord {
    const evaluation = {
      id: randomUUID(),
      run_id: runId,
      score,
      issues_json: toJson(issues),
      suggestions_json: toJson(suggestions),
    };
    this.sqlite
      .prepare('INSERT INTO evaluations (id, run_id, score, issues_json, suggestions_json) VALUES (?, ?, ?, ?, ?)')
      .run(evaluation.id, evaluation.run_id, evaluation.score, evaluation.issues_json, evaluation.suggestions_json);
    return evaluation;
  }

  listEvaluationsByRun(runId: string): EvaluationRecord[] {
    return this.sqlite.prepare('SELECT * FROM evaluations WHERE run_id = ? ORDER BY rowid ASC').all(runId) as EvaluationRecord[];
  }

  upsertMemory(scope: string, key: string, value: JsonValue): void {
    this.sqlite.prepare('DELETE FROM memory_entries WHERE scope = ? AND key = ?').run(scope, key);
    this.sqlite
      .prepare('INSERT INTO memory_entries (id, scope, key, value_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), scope, key, toJson(value), new Date().toISOString());
  }

  listMemory(scope?: string): Array<{ id: string; scope: string; key: string; value_json: string; created_at: string }> {
    if (scope) {
      return this.sqlite.prepare('SELECT * FROM memory_entries WHERE scope = ? ORDER BY created_at DESC').all(scope) as Array<{ id: string; scope: string; key: string; value_json: string; created_at: string }>;
    }

    return this.sqlite.prepare('SELECT * FROM memory_entries ORDER BY created_at DESC').all() as Array<{ id: string; scope: string; key: string; value_json: string; created_at: string }>;
  }

  inspectTask(taskId: string): { task?: TaskRecord; runs: Array<RunRecord & { steps: StepRecord[] }> } {
    const task = this.getTask(taskId);
    const runs = this.listRunsByTask(taskId).map((run) => ({
      ...run,
      steps: this.listStepsByRun(run.id),
    }));

    return { task, runs };
  }
}
