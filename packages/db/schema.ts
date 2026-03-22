import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  goal: text('goal').notNull(),
  state: text('state').notNull(),
  priority: integer('priority').notNull().default(0),
  targetId: text('target_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  status: text('status').notNull(),
  iteration: integer('iteration').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
});

export const steps = sqliteTable('steps', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  index: integer('index').notNull(),
  tool: text('tool').notNull(),
  inputJson: text('input_json').notNull(),
  expectedJson: text('expected_json').notNull(),
  outputJson: text('output_json'),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
});

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  stepId: text('step_id').notNull(),
  type: text('type').notNull(),
  path: text('path').notNull(),
  metadataJson: text('metadata_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const memoryEntries = sqliteTable('memory_entries', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(),
  key: text('key').notNull(),
  valueJson: text('value_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const evaluations = sqliteTable('evaluations', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  score: real('score').notNull(),
  issuesJson: text('issues_json').notNull(),
  suggestionsJson: text('suggestions_json').notNull(),
});

export const approvalRequests = sqliteTable('approval_requests', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  runId: text('run_id').notNull(),
  stepIndex: integer('step_index').notNull(),
  tool: text('tool').notNull(),
  inputJson: text('input_json').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const schedules = sqliteTable('schedules', {
  id: text('id').primaryKey(),
  goal: text('goal').notNull(),
  targetId: text('target_id'),
  intervalSeconds: integer('interval_seconds').notNull(),
  enabled: integer('enabled').notNull(),
  lastEnqueuedAt: text('last_enqueued_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const targets = sqliteTable('targets', {
  id: text('id').primaryKey(),
  root: text('root').notNull(),
  readPathsJson: text('read_paths_json').notNull(),
  writePathsJson: text('write_paths_json').notNull(),
  capabilitiesJson: text('capabilities_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const runEvents = sqliteTable('run_events', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  level: text('level').notNull(),
  message: text('message').notNull(),
  payloadJson: text('payload_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const maintenanceEvents = sqliteTable('maintenance_events', {
  id: text('id').primaryKey(),
  operation: text('operation').notNull(),
  status: text('status').notNull(),
  trigger: text('trigger').notNull(),
  dryRun: integer('dry_run').notNull(),
  payloadJson: text('payload_json').notNull(),
  resultJson: text('result_json').notNull(),
  createdAt: text('created_at').notNull(),
});
