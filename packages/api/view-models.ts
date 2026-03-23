import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  approvalRequestRecordSchema,
  artifactRecordSchema,
  eventLevelSchema,
  evaluationRecordSchema,
  runEventRecordSchema,
  runRecordSchema,
  stepRecordSchema,
  taskRecordSchema,
  type ApprovalRequestRecord,
  type EvaluationRecord,
  type RunEventRecord,
  type RunRecord,
  type StepRecord,
  type TaskRecord,
} from '../domain';
import type { TaskArtifactView } from '../core/loop/runtime';
import { buildCursorPageEnvelope } from './pagination';

const keyFactSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
});

const cursorPageSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
  previousCursor: z.string().nullable(),
});

const taskControlViewModelSchema = z.object({
  stopRequested: z.boolean(),
  deleteAfterStop: z.boolean(),
});

const taskActionViewModelSchema = z.object({
  action: z.enum(['retry', 'replan', 'retry_with_constraints', 'replan_from_feedback', 'escalate', 'cancel']),
  label: z.string().min(1),
  tone: z.enum(['default', 'warning', 'danger']),
});

const attemptViewModelSchema = z.object({
  current: z.number().int().positive(),
  total: z.number().int().positive(),
  label: z.string().min(1),
});

const planPreviewStepViewModelSchema = z.object({
  tool: z.string().min(1),
  rationale: z.string().min(1),
});

const planPreviewViewModelSchema = z.object({
  assumptions: z.array(z.string()),
  risks: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  steps: z.array(planPreviewStepViewModelSchema),
});

const criticFeedbackViewModelSchema = z.object({
  feedback: z.array(z.string()),
  failureClasses: z.array(z.string()),
  doNotRepeatRules: z.array(z.string()),
});

const diffFileSchema = z.object({
  path: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  hunks: z.array(
    z.object({
      header: z.string().min(1),
      oldStart: z.number().int().nonnegative(),
      oldCount: z.number().int().nonnegative(),
      newStart: z.number().int().nonnegative(),
      newCount: z.number().int().nonnegative(),
      lines: z.array(
        z.object({
          kind: z.enum(['context', 'add', 'delete']),
          content: z.string(),
          oldLineNumber: z.number().int().positive().nullable(),
          newLineNumber: z.number().int().positive().nullable(),
        }),
      ),
    }),
  ),
});

const patchPreviewSchema = z.object({
  fileCount: z.number().int().nonnegative(),
  hunkCount: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  files: z.array(diffFileSchema),
});

const artifactSummarySchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  facts: z.array(keyFactSchema),
  changedFiles: z.array(z.string()),
  patch: patchPreviewSchema.nullable(),
  rawText: z.string().nullable(),
  rawJson: z.record(z.string(), z.unknown()).nullable(),
});

export const artifactBrowserItemViewModelSchema = z.object({
  artifact: artifactRecordSchema.extend({
    taskId: z.string().uuid(),
    runId: z.string().uuid(),
    stepIndex: z.number().int().nonnegative(),
    tool: z.string().min(1),
  }),
  summary: artifactSummarySchema,
});
export type ArtifactBrowserItemViewModel = z.infer<typeof artifactBrowserItemViewModelSchema>;

export const artifactBrowserStepGroupViewModelSchema = z.object({
  runId: z.string().uuid(),
  stepIndex: z.number().int().nonnegative(),
  tool: z.string().min(1),
  artifacts: z.array(artifactBrowserItemViewModelSchema),
});
export type ArtifactBrowserStepGroupViewModel = z.infer<typeof artifactBrowserStepGroupViewModelSchema>;

export const artifactBrowserRunGroupViewModelSchema = z.object({
  runId: z.string().uuid(),
  steps: z.array(artifactBrowserStepGroupViewModelSchema),
});
export type ArtifactBrowserRunGroupViewModel = z.infer<typeof artifactBrowserRunGroupViewModelSchema>;

const artifactBrowserFilterOptionsSchema = z.object({
  runIds: z.array(z.string().uuid()),
  artifactTypes: z.array(artifactRecordSchema.shape.type),
});

export const artifactBrowserViewModelSchema = z.object({
  taskId: z.string().uuid(),
  page: cursorPageSchema,
  filterOptions: artifactBrowserFilterOptionsSchema,
  runs: z.array(artifactBrowserRunGroupViewModelSchema),
});
export type ArtifactBrowserViewModel = z.infer<typeof artifactBrowserViewModelSchema>;

export const artifactPreviewViewModelSchema = z.object({
  artifact: artifactBrowserItemViewModelSchema.shape.artifact,
  summary: artifactSummarySchema,
});
export type ArtifactPreviewViewModel = z.infer<typeof artifactPreviewViewModelSchema>;

export const runSummaryViewModelSchema = z.object({
  run: runRecordSchema,
  summary: z.object({
    attempt: attemptViewModelSchema,
    completedSteps: z.number().int().nonnegative(),
    failedSteps: z.number().int().nonnegative(),
    changedFiles: z.array(z.string()),
    score: z.number().min(0).max(1).nullable(),
    latestEventTitle: z.string().nullable(),
    latestEventLevel: eventLevelSchema.nullable(),
    planPreview: planPreviewViewModelSchema.nullable(),
    criticFeedback: criticFeedbackViewModelSchema.nullable(),
  }),
});
export type RunSummaryViewModel = z.infer<typeof runSummaryViewModelSchema>;

export const runViewModelSchema = z.object({
  task: taskRecordSchema,
  taskControl: taskControlViewModelSchema,
  run: runRecordSchema,
  eventsPage: cursorPageSchema,
  events: z.array(runEventRecordSchema),
  steps: z.array(stepRecordSchema),
  evaluations: z.array(evaluationRecordSchema),
  summary: runSummaryViewModelSchema.shape.summary,
  taskActions: z.array(taskActionViewModelSchema),
});
export type RunViewModel = z.infer<typeof runViewModelSchema>;

export const taskViewModelSchema = z.object({
  task: taskRecordSchema,
  control: taskControlViewModelSchema,
  approvals: z.array(approvalRequestRecordSchema),
  runsPage: cursorPageSchema,
  runs: z.array(runSummaryViewModelSchema),
  summary: z.object({
    latestRunId: z.string().uuid().nullable(),
    latestRunState: z.string().nullable(),
    latestRunChangedFiles: z.number().int().nonnegative(),
    latestRunCompletedSteps: z.number().int().nonnegative(),
    latestRunFailedSteps: z.number().int().nonnegative(),
    updatedAt: z.string().min(1),
  }),
  actions: z.array(taskActionViewModelSchema),
});
export type TaskViewModel = z.infer<typeof taskViewModelSchema>;

export const dashboardTaskViewModelSchema = taskRecordSchema.extend({
  control: taskControlViewModelSchema,
});
export type DashboardTaskViewModel = z.infer<typeof dashboardTaskViewModelSchema>;

export const dashboardFiltersViewModelSchema = z.object({
  taskState: z.string(),
  approvalStatus: z.string(),
  eventLevel: z.string(),
});
export type DashboardFiltersViewModel = z.infer<typeof dashboardFiltersViewModelSchema>;

export const dashboardSelectionViewModelSchema = z.object({
  requestedTaskId: z.string(),
  resolvedTaskId: z.string(),
  requestedTaskMissing: z.boolean(),
});
export type DashboardSelectionViewModel = z.infer<typeof dashboardSelectionViewModelSchema>;

function safeParseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return z.record(z.string(), z.unknown()).parse(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function createAttemptViewModel(iteration: number, maxIterations: number) {
  return attemptViewModelSchema.parse({
    current: iteration,
    total: maxIterations,
    label: `Попытка ${String(iteration)}/${String(maxIterations)}`,
  });
}

function parseEventPayloadRecord(event: RunEventRecord): Record<string, unknown> | null {
  return toJsonRecord(safeParseJson(event.payload_json));
}

function extractPlanPreview(events: RunEventRecord[]) {
  const planningPayloadSchema = z.object({
    preview: planPreviewViewModelSchema,
  });

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.message !== 'planning_completed') {
      continue;
    }

    const payload = parseEventPayloadRecord(event);
    const parsed = planningPayloadSchema.safeParse(payload);
    if (parsed.success) {
      return parsed.data.preview;
    }
  }

  return null;
}

function extractCriticFeedback(events: RunEventRecord[]) {
  const criticPayloadSchema = z.object({
    feedback: z.array(z.string()),
    failureClasses: z.array(z.string()).default([]),
    doNotRepeatRules: z.array(z.string()).default([]),
  });

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.message !== 'plan_invalid') {
      continue;
    }

    const payload = parseEventPayloadRecord(event);
    const parsed = criticPayloadSchema.safeParse(payload);
    if (parsed.success) {
      return criticFeedbackViewModelSchema.parse({
        feedback: parsed.data.feedback,
        failureClasses: parsed.data.failureClasses,
        doNotRepeatRules: parsed.data.doNotRepeatRules,
      });
    }
  }

  return null;
}

function parseHunkHeader(header: string): {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
} | null {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
  if (!match) {
    return null;
  }

  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? '1'),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? '1'),
  };
}

function createPatchPreview(patch: string): z.infer<typeof patchPreviewSchema> {
  const fileStats = new Map<string, z.infer<typeof diffFileSchema>>();
  let currentFilePath = '';
  let currentHunkIndex = -1;
  let nextOldLineNumber = 0;
  let nextNewLineNumber = 0;
  let hunkCount = 0;
  let additions = 0;
  let deletions = 0;

  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFilePath = line.replace('+++ b/', '').trim();
      currentHunkIndex = -1;
      if (!fileStats.has(currentFilePath)) {
        fileStats.set(
          currentFilePath,
          diffFileSchema.parse({
            path: currentFilePath,
            additions: 0,
            deletions: 0,
            hunks: [],
          }),
        );
      }
      continue;
    }
    if (line.startsWith('@@')) {
      if (!currentFilePath) {
        continue;
      }
      const currentFile = fileStats.get(currentFilePath);
      const hunkMeta = parseHunkHeader(line);
      if (!currentFile || !hunkMeta) {
        continue;
      }
      hunkCount += 1;
      currentFile.hunks.push({
        header: line,
        oldStart: hunkMeta.oldStart,
        oldCount: hunkMeta.oldCount,
        newStart: hunkMeta.newStart,
        newCount: hunkMeta.newCount,
        lines: [],
      });
      currentHunkIndex = currentFile.hunks.length - 1;
      nextOldLineNumber = hunkMeta.oldStart;
      nextNewLineNumber = hunkMeta.newStart;
      continue;
    }
    const currentFile = currentFilePath ? fileStats.get(currentFilePath) : undefined;
    const currentHunk =
      currentFile && currentHunkIndex >= 0 && currentHunkIndex < currentFile.hunks.length
        ? currentFile.hunks[currentHunkIndex]
        : undefined;

    if (!currentFile || !currentHunk) {
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions += 1;
      currentFile.additions += 1;
      currentHunk.lines.push({
        kind: 'add',
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: nextNewLineNumber,
      });
      nextNewLineNumber += 1;
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      deletions += 1;
      currentFile.deletions += 1;
      currentHunk.lines.push({
        kind: 'delete',
        content: line.slice(1),
        oldLineNumber: nextOldLineNumber,
        newLineNumber: null,
      });
      nextOldLineNumber += 1;
      continue;
    }
    if (line.startsWith('\\')) {
      continue;
    }
    currentHunk.lines.push({
      kind: 'context',
      content: line.startsWith(' ') ? line.slice(1) : line,
      oldLineNumber: nextOldLineNumber,
      newLineNumber: nextNewLineNumber,
    });
    nextOldLineNumber += 1;
    nextNewLineNumber += 1;
  }

  return patchPreviewSchema.parse({
    fileCount: fileStats.size,
    hunkCount,
    additions,
    deletions,
    files: [...fileStats.values()],
  });
}

function createArtifactSummary(artifact: TaskArtifactView, content: string): z.infer<typeof artifactSummarySchema> {
  const parsed = safeParseJson(content);
  const record = toJsonRecord(parsed);

  if (!record) {
    return artifactSummarySchema.parse({
      title: artifact.type,
      summary: 'Текстовый артефакт без структурированного JSON.',
      facts: [
        { label: 'path', value: artifact.path },
        { label: 'created', value: artifact.created_at },
      ],
      changedFiles: [],
      patch: null,
      rawText: content,
      rawJson: null,
    });
  }

  if (artifact.type === 'request') {
    const stepRecord = toJsonRecord(record.step);
    const stepInput = stepRecord ? toJsonRecord(stepRecord.input) : null;
    const patchValue = stepInput && typeof stepInput.patch === 'string' ? stepInput.patch : null;
    return artifactSummarySchema.parse({
      title: 'Запрос к инструменту',
      summary:
        stepRecord && typeof stepRecord.tool === 'string'
          ? `Подготовка шага ${stepRecord.tool}.`
          : 'Исходный request для bounded tool.',
      facts: [
        { label: 'tool', value: stepRecord && typeof stepRecord.tool === 'string' ? stepRecord.tool : artifact.tool },
        {
          label: 'rationale',
          value: stepRecord && typeof stepRecord.rationale === 'string' ? stepRecord.rationale : 'n/a',
        },
      ],
      changedFiles: [],
      patch: patchValue ? createPatchPreview(patchValue) : null,
      rawText: null,
      rawJson: record,
    });
  }

  if (artifact.type === 'result') {
    const changedFiles = toStringArray(record.changedFiles);
    const evidenceRecord = toJsonRecord(record.evidence);
    const summary = evidenceRecord && typeof evidenceRecord.summary === 'string'
      ? evidenceRecord.summary
      : typeof record.error === 'string'
        ? record.error
        : 'Инструмент завершил выполнение.';
    return artifactSummarySchema.parse({
      title: 'Результат инструмента',
      summary,
      facts: [
        {
          label: 'success',
          value: typeof record.success === 'boolean' ? String(record.success) : 'unknown',
        },
        {
          label: 'changed files',
          value: String(changedFiles.length),
        },
      ],
      changedFiles,
      patch: null,
      rawText: null,
      rawJson: record,
    });
  }

  if (artifact.type === 'verification') {
    return artifactSummarySchema.parse({
      title: 'Проверка результата',
      summary:
        record.verified === true
          ? 'Verifier подтвердил результат.'
          : 'Verifier не подтвердил результат.',
      facts: [
        {
          label: 'verified',
          value: typeof record.verified === 'boolean' ? String(record.verified) : 'unknown',
        },
        {
          label: 'evidence',
          value: typeof record.evidence === 'string' ? record.evidence : 'n/a',
        },
      ],
      changedFiles: [],
      patch: null,
      rawText: null,
      rawJson: record,
    });
  }

  const changedFiles = toStringArray(record.changedFiles);
  return artifactSummarySchema.parse({
    title: artifact.type === 'report' ? 'Итоговый report' : artifact.type,
    summary:
      record.success === true
        ? 'Шаг успешно завершился.'
        : record.success === false
          ? 'Шаг завершился с ошибкой.'
          : 'Технический артефакт.',
    facts: [
      {
        label: 'success',
        value: typeof record.success === 'boolean' ? String(record.success) : 'unknown',
      },
      {
        label: 'changed files',
        value: String(changedFiles.length),
      },
    ],
    changedFiles,
    patch: null,
    rawText: null,
    rawJson: record,
  });
}

export function buildArtifactPreviewViewModel(artifact: TaskArtifactView): ArtifactPreviewViewModel {
  const content = readFileSync(artifact.path, 'utf8');
  return artifactPreviewViewModelSchema.parse({
    artifact,
    summary: createArtifactSummary(artifact, content),
  });
}

export function buildArtifactBrowserViewModel(
  input: {
    taskId: string;
    artifacts: TaskArtifactView[];
    filterOptions: {
      runIds: string[];
      artifactTypes: Array<TaskArtifactView['type']>;
    };
    page: {
      total: number;
      limit: number;
      offset: number;
    };
  },
): ArtifactBrowserViewModel {
  const groupedRuns = new Map<string, Map<number, ArtifactBrowserStepGroupViewModel>>();

  for (const artifact of input.artifacts) {
    if (!groupedRuns.has(artifact.runId)) {
      groupedRuns.set(artifact.runId, new Map<number, ArtifactBrowserStepGroupViewModel>());
    }

    const runGroup = groupedRuns.get(artifact.runId);
    if (!runGroup) {
      continue;
    }

    if (!runGroup.has(artifact.stepIndex)) {
      runGroup.set(
        artifact.stepIndex,
        artifactBrowserStepGroupViewModelSchema.parse({
          runId: artifact.runId,
          stepIndex: artifact.stepIndex,
          tool: artifact.tool,
          artifacts: [],
        }),
      );
    }

    const stepGroup = runGroup.get(artifact.stepIndex);
    if (!stepGroup) {
      continue;
    }

    stepGroup.artifacts.push(
      artifactBrowserItemViewModelSchema.parse({
        artifact,
        summary: createArtifactSummary(artifact, readFileSync(artifact.path, 'utf8')),
      }),
    );
  }

  return artifactBrowserViewModelSchema.parse({
    taskId: input.taskId,
    page: {
      ...buildCursorPageEnvelope(input.page),
    },
    filterOptions: {
      runIds: input.filterOptions.runIds,
      artifactTypes: input.filterOptions.artifactTypes,
    },
    runs: [...groupedRuns.entries()].map((entry) =>
      artifactBrowserRunGroupViewModelSchema.parse({
        runId: entry[0],
        steps: [...entry[1].values()].sort((left, right) => left.stepIndex - right.stepIndex),
      }),
    ),
  });
}

function extractChangedFiles(steps: StepRecord[]): string[] {
  const files = new Set<string>();
  for (const step of steps) {
    const payload = safeParseJson(step.output_json ?? '');
    const record = toJsonRecord(payload);
    if (!record) {
      continue;
    }
    const resultRecord = toJsonRecord(record.result);
    const toolRecord = resultRecord ? toJsonRecord(resultRecord.output) : null;
    const changedFiles = resultRecord ? toStringArray(resultRecord.changedFiles) : [];
    for (const file of changedFiles) {
      files.add(file);
    }
    if (toolRecord && typeof toolRecord.path === 'string') {
      files.add(toolRecord.path);
    }
  }
  return [...files];
}

function resolveLatestEvent(events: RunEventRecord[]): { title: string | null; level: RunEventRecord['level'] | null } {
  const latestEvent = events[events.length - 1];
  if (!latestEvent) {
    return {
      title: null,
      level: null,
    };
  }
  return {
    title: latestEvent.message,
    level: latestEvent.level,
  };
}

function buildRunSummary(
  run: RunRecord,
  steps: StepRecord[],
  events: RunEventRecord[],
  evaluations: EvaluationRecord[],
  maxIterations: number,
): RunSummaryViewModel {
  const completedSteps = steps.filter((step) => step.status === 'completed').length;
  const failedSteps = steps.filter((step) => step.status === 'failed').length;
  const latestEvent = resolveLatestEvent(events);
  const latestEvaluation = evaluations[evaluations.length - 1] ?? null;

  return runSummaryViewModelSchema.parse({
    run,
    summary: {
      attempt: createAttemptViewModel(run.iteration, maxIterations),
      completedSteps,
      failedSteps,
      changedFiles: extractChangedFiles(steps),
      score: latestEvaluation ? latestEvaluation.score : null,
      latestEventTitle: latestEvent.title,
      latestEventLevel: latestEvent.level,
      planPreview: extractPlanPreview(events),
      criticFeedback: extractCriticFeedback(events),
    },
  });
}

function buildTaskActionViewModels(actions: Array<'retry' | 'replan' | 'retry_with_constraints' | 'replan_from_feedback' | 'escalate' | 'cancel'>): Array<z.infer<typeof taskActionViewModelSchema>> {
  return actions.map((action) =>
    taskActionViewModelSchema.parse({
      action,
      label:
        action === 'retry'
          ? 'Повторить'
          : action === 'retry_with_constraints'
            ? 'Повторить с учётом ограничений'
          : action === 'replan'
            ? 'Построить новый план'
            : action === 'replan_from_feedback'
              ? 'Построить план по замечаниям'
            : action === 'escalate'
              ? 'Эскалировать'
              : 'Отменить',
      tone:
        action === 'escalate'
          ? 'warning'
          : action === 'cancel'
            ? 'danger'
            : 'default',
    }),
  );
}

export function buildTaskViewModel(input: {
  task: TaskRecord;
  control: {
    stopRequested: boolean;
    deleteAfterStop: boolean;
  };
  approvals: ApprovalRequestRecord[];
  runs: Array<{
    run: RunRecord;
    steps: StepRecord[];
    events: RunEventRecord[];
    evaluations: EvaluationRecord[];
  }>;
  page: {
    total: number;
    limit: number;
    offset: number;
  };
  maxIterations: number;
  actions: Array<'retry' | 'replan' | 'retry_with_constraints' | 'replan_from_feedback' | 'escalate' | 'cancel'>;
}): TaskViewModel {
  const runSummaries = input.runs.map((entry) =>
    buildRunSummary(entry.run, entry.steps, entry.events, entry.evaluations, input.maxIterations),
  );
  const latestRun = runSummaries[0] ?? null;

  return taskViewModelSchema.parse({
    task: input.task,
    control: input.control,
    approvals: input.approvals,
    runsPage: buildCursorPageEnvelope(input.page),
    runs: runSummaries,
    summary: {
      latestRunId: latestRun ? latestRun.run.id : null,
      latestRunState: latestRun ? latestRun.run.status : null,
      latestRunChangedFiles: latestRun ? latestRun.summary.changedFiles.length : 0,
      latestRunCompletedSteps: latestRun ? latestRun.summary.completedSteps : 0,
      latestRunFailedSteps: latestRun ? latestRun.summary.failedSteps : 0,
      updatedAt: input.task.updated_at,
    },
    actions: buildTaskActionViewModels(input.actions),
  });
}

export function buildRunViewModel(
  task: TaskRecord,
  taskControl: {
    stopRequested: boolean;
    deleteAfterStop: boolean;
  },
  run: RunRecord,
  steps: StepRecord[],
  events: RunEventRecord[],
  summaryEvents: RunEventRecord[],
  evaluations: EvaluationRecord[],
  page: {
    total: number;
    limit: number;
    offset: number;
  },
  maxIterations: number,
  actions: Array<'retry' | 'replan' | 'retry_with_constraints' | 'replan_from_feedback' | 'escalate' | 'cancel'>,
): RunViewModel {
  const summary = buildRunSummary(run, steps, summaryEvents, evaluations, maxIterations);
  return runViewModelSchema.parse({
    task,
    taskControl,
    run,
    eventsPage: buildCursorPageEnvelope(page),
    events,
    steps,
    evaluations,
    summary: summary.summary,
    taskActions: buildTaskActionViewModels(actions),
  });
}

export function buildDashboardTaskListViewModel(input: {
  tasks: TaskRecord[];
  controlStates: Record<string, { stopRequested: boolean; deleteAfterStop: boolean }>;
}): DashboardTaskViewModel[] {
  return input.tasks.map((task) =>
    dashboardTaskViewModelSchema.parse({
      ...task,
      control: input.controlStates[task.id] ?? {
        stopRequested: false,
        deleteAfterStop: false,
      },
    }),
  );
}

export function buildDashboardFiltersViewModel(input: {
  taskState?: string;
  approvalStatus?: string;
  eventLevel?: string;
}): DashboardFiltersViewModel {
  return dashboardFiltersViewModelSchema.parse({
    taskState: input.taskState ?? '',
    approvalStatus: input.approvalStatus ?? '',
    eventLevel: input.eventLevel ?? '',
  });
}

export function buildDashboardSelectionViewModel(input: {
  requestedTaskId?: string;
  requestedTaskExists: boolean;
}): DashboardSelectionViewModel {
  const requestedTaskId = input.requestedTaskId ?? '';
  const resolvedTaskId = input.requestedTaskExists ? requestedTaskId : '';
  return dashboardSelectionViewModelSchema.parse({
    requestedTaskId,
    resolvedTaskId,
    requestedTaskMissing: requestedTaskId.length > 0 && !input.requestedTaskExists,
  });
}

export function filterTasksByState(tasks: TaskRecord[], taskState?: string): TaskRecord[] {
  return taskState ? tasks.filter((task) => task.state === taskState) : tasks;
}

export function filterApprovalsByStatus(
  approvals: ApprovalRequestRecord[],
  approvalStatus?: string,
): ApprovalRequestRecord[] {
  approvalRequestRecordSchema.array().parse(approvals);
  return approvalStatus ? approvals.filter((approval) => approval.status === approvalStatus) : approvals;
}

export function filterRunEventsByLevel(events: RunEventRecord[], eventLevel?: string): RunEventRecord[] {
  return eventLevel ? events.filter((event) => event.level === eventLevel) : events;
}
