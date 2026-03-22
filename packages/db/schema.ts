import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  goal: text('goal').notNull(),
  state: text('state').notNull(),
  priority: integer('priority').notNull().default(0),
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
