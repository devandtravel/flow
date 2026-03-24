import { z } from 'zod';

export const runtimeModeSchema = z.enum(['project', 'system']);
export type RuntimeMode = z.infer<typeof runtimeModeSchema>;

export const autonomyModeSchema = z.enum(['supervised', 'autonomous']);
export type AutonomyMode = z.infer<typeof autonomyModeSchema>;

export const executionProfileSchema = z.enum(['strict', 'balanced', 'aggressive']);
export type ExecutionProfile = z.infer<typeof executionProfileSchema>;

export const capabilityNameSchema = z.enum([
  'fs.read',
  'fs.write',
  'git.status',
  'git.branch',
  'git.commit',
  'repo.search',
  'repo.test',
  'repo.build',
  'repo.check',
  'repo.patch',
  'http.fetch',
  'shell.exec',
]);
export type CapabilityName = z.infer<typeof capabilityNameSchema>;

export const approvalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'consumed']);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const taskStateSchema = z.enum([
  'queued',
  'planning',
  'validating',
  'executing',
  'awaiting_approval',
  'verifying',
  'completed',
  'failed',
  'retryable',
  'blocked',
  'cancelled',
  'rolled_back',
  'escalated',
]);
export type TaskState = z.infer<typeof taskStateSchema>;

export const runStateSchema = z.enum([
  'queued',
  'planning',
  'validating',
  'executing',
  'awaiting_approval',
  'verifying',
  'completed',
  'failed',
  'cancelled',
  'escalated',
]);
export type RunState = z.infer<typeof runStateSchema>;

export const stepStateSchema = z.enum([
  'queued',
  'started',
  'awaiting_approval',
  'completed',
  'failed',
  'blocked',
  'cancelled',
]);
export type StepState = z.infer<typeof stepStateSchema>;

export const eventLevelSchema = z.enum(['info', 'warning', 'error']);
export type EventLevel = z.infer<typeof eventLevelSchema>;

export const artifactTypeSchema = z.enum(['log', 'report', 'request', 'result', 'verification']);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

export const maintenanceOperationSchema = z.enum(['cleanup']);
export type MaintenanceOperation = z.infer<typeof maintenanceOperationSchema>;

export const maintenanceStatusSchema = z.enum(['completed']);
export type MaintenanceStatus = z.infer<typeof maintenanceStatusSchema>;

export const maintenanceTriggerSchema = z.enum(['manual', 'api_manual', 'cli_manual', 'worker_due', 'api_run_due', 'cli_run_due']);
export type MaintenanceTrigger = z.infer<typeof maintenanceTriggerSchema>;

export const llmProviderNameSchema = z.enum(['codex', 'mock']);
export type LlmProviderName = z.infer<typeof llmProviderNameSchema>;

export const toolStepSchema = z.object({
  tool: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  expected: z.record(z.string(), z.unknown()).default({}),
  rationale: z.string().min(1),
});
export type ToolStep = z.infer<typeof toolStepSchema>;

export const taskPlanSchema = z.object({
  goal: z.string().min(1),
  assumptions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  steps: z.array(toolStepSchema).min(1),
  done: z.boolean(),
  confidence: z.number().min(0).max(1),
});
export type TaskPlan = z.infer<typeof taskPlanSchema>;

export const criticReviewSchema = z.object({
  valid: z.boolean(),
  feedback: z.array(z.string()).default([]),
  plan: taskPlanSchema,
});
export type CriticReview = z.infer<typeof criticReviewSchema>;

export const supervisorDecisionSchema = z.object({
  decision: z.enum(['continue', 'retry_same_step', 'replan', 'escalate', 'stop']),
  reason: z.string().min(1),
});
export type SupervisorDecision = z.infer<typeof supervisorDecisionSchema>;

export const evaluationSchema = z.object({
  score: z.number().min(0).max(1),
  issues: z.array(z.string()).default([]),
  suggestions: z.array(z.string()).default([]),
});
export type Evaluation = z.infer<typeof evaluationSchema>;

export const targetConfigSchema = z.object({
  id: z.string().min(1),
  root: z.string().min(1),
  read_paths: z.array(z.string().min(1)).min(1),
  write_paths: z.array(z.string().min(1)).min(1),
  capabilities: z.array(capabilityNameSchema).min(1),
});
export type TargetConfig = z.infer<typeof targetConfigSchema>;

export const scheduleConfigSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  target_id: z.string().min(1).optional(),
  interval_seconds: z.number().int().positive(),
  enabled: z.boolean().default(true),
});
export type ScheduleConfig = z.infer<typeof scheduleConfigSchema>;

export const taskRecordSchema = z.object({
  id: z.string().uuid(),
  goal: z.string().min(1),
  state: taskStateSchema,
  priority: z.number().int(),
  target_id: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type TaskRecord = z.infer<typeof taskRecordSchema>;

export const runRecordSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  status: runStateSchema,
  iteration: z.number().int().nonnegative(),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime().nullable(),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

export const stepRecordSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  index: z.number().int().nonnegative(),
  tool: z.string().min(1),
  input_json: z.string(),
  expected_json: z.string(),
  output_json: z.string().nullable(),
  status: stepStateSchema,
  started_at: z.string().datetime(),
  finished_at: z.string().datetime().nullable(),
});
export type StepRecord = z.infer<typeof stepRecordSchema>;

export const artifactRecordSchema = z.object({
  id: z.string().uuid(),
  step_id: z.string().uuid(),
  type: artifactTypeSchema,
  path: z.string().min(1),
  metadata_json: z.string(),
  created_at: z.string().datetime(),
});
export type ArtifactRecord = z.infer<typeof artifactRecordSchema>;

export const evaluationRecordSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  score: z.number().min(0).max(1),
  issues_json: z.string(),
  suggestions_json: z.string(),
});
export type EvaluationRecord = z.infer<typeof evaluationRecordSchema>;

export const memoryEntryRecordSchema = z.object({
  id: z.string().uuid(),
  scope: z.enum(['episodic', 'procedural', 'failure', 'semantic']),
  key: z.string().min(1),
  value_json: z.string(),
  created_at: z.string().datetime(),
});
export type MemoryEntryRecord = z.infer<typeof memoryEntryRecordSchema>;

export const approvalRequestRecordSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  run_id: z.string().uuid(),
  step_index: z.number().int().nonnegative(),
  tool: z.string().min(1),
  input_json: z.string(),
  reason: z.string().min(1),
  status: approvalStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ApprovalRequestRecord = z.infer<typeof approvalRequestRecordSchema>;

export const scheduleRecordSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  target_id: z.string().min(1).nullable(),
  interval_seconds: z.number().int().positive(),
  enabled: z.number().int(),
  last_enqueued_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ScheduleRecord = z.infer<typeof scheduleRecordSchema>;

export const targetRecordSchema = z.object({
  id: z.string().min(1),
  root: z.string().min(1),
  read_paths_json: z.string(),
  write_paths_json: z.string(),
  capabilities_json: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type TargetRecord = z.infer<typeof targetRecordSchema>;

export const runEventRecordSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  level: eventLevelSchema,
  message: z.string().min(1),
  payload_json: z.string(),
  created_at: z.string().datetime(),
});
export type RunEventRecord = z.infer<typeof runEventRecordSchema>;

export const maintenanceEventRecordSchema = z.object({
  id: z.string().uuid(),
  operation: maintenanceOperationSchema,
  status: maintenanceStatusSchema,
  trigger: maintenanceTriggerSchema,
  dry_run: z.number().int(),
  payload_json: z.string(),
  result_json: z.string(),
  created_at: z.string().datetime(),
});
export type MaintenanceEventRecord = z.infer<typeof maintenanceEventRecordSchema>;

export const memorySummarySchema = z.object({
  episodic: z.array(z.record(z.string(), z.unknown())),
  procedural: z.array(z.record(z.string(), z.unknown())),
  failure: z.array(z.record(z.string(), z.unknown())),
  semantic: z.array(z.record(z.string(), z.unknown())),
});
export type MemorySummary = z.infer<typeof memorySummarySchema>;

export const fileSnapshotMemorySchema = z.object({
  type: z.literal('file_snapshot'),
  task_id: z.string().uuid(),
  target_id: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
  run_id: z.string().uuid(),
  step_id: z.string().uuid(),
  recorded_at: z.string().datetime(),
});
export type FileSnapshotMemory = z.infer<typeof fileSnapshotMemorySchema>;
