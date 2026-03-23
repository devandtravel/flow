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

const keyFactSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
});

const diffFileSchema = z.object({
  path: z.string().min(1),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
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

export const artifactBrowserViewModelSchema = z.object({
  taskId: z.string().uuid(),
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
    completedSteps: z.number().int().nonnegative(),
    failedSteps: z.number().int().nonnegative(),
    changedFiles: z.array(z.string()),
    score: z.number().min(0).max(1).nullable(),
    latestEventTitle: z.string().nullable(),
    latestEventLevel: eventLevelSchema.nullable(),
  }),
});
export type RunSummaryViewModel = z.infer<typeof runSummaryViewModelSchema>;

export const runViewModelSchema = z.object({
  task: taskRecordSchema,
  run: runRecordSchema,
  events: z.array(runEventRecordSchema),
  steps: z.array(stepRecordSchema),
  evaluations: z.array(evaluationRecordSchema),
  summary: runSummaryViewModelSchema.shape.summary,
});
export type RunViewModel = z.infer<typeof runViewModelSchema>;

export const dashboardFiltersViewModelSchema = z.object({
  taskState: z.string(),
  approvalStatus: z.string(),
  eventLevel: z.string(),
});
export type DashboardFiltersViewModel = z.infer<typeof dashboardFiltersViewModelSchema>;

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

function createPatchPreview(patch: string): z.infer<typeof patchPreviewSchema> {
  const fileStats = new Map<string, { additions: number; deletions: number }>();
  let currentFile = '';
  let hunkCount = 0;
  let additions = 0;
  let deletions = 0;

  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.replace('+++ b/', '').trim();
      if (!fileStats.has(currentFile)) {
        fileStats.set(currentFile, { additions: 0, deletions: 0 });
      }
      continue;
    }
    if (line.startsWith('@@')) {
      hunkCount += 1;
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions += 1;
      if (currentFile) {
        const entry = fileStats.get(currentFile);
        if (entry) {
          entry.additions += 1;
        }
      }
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      deletions += 1;
      if (currentFile) {
        const entry = fileStats.get(currentFile);
        if (entry) {
          entry.deletions += 1;
        }
      }
    }
  }

  return patchPreviewSchema.parse({
    fileCount: fileStats.size,
    hunkCount,
    additions,
    deletions,
    files: [...fileStats.entries()].map((entry) => ({
      path: entry[0],
      additions: entry[1].additions,
      deletions: entry[1].deletions,
    })),
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

export function buildArtifactBrowserViewModel(taskId: string, artifacts: TaskArtifactView[]): ArtifactBrowserViewModel {
  const groupedRuns = new Map<string, Map<number, ArtifactBrowserStepGroupViewModel>>();

  for (const artifact of artifacts) {
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
    taskId,
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

export function buildRunViewModel(task: TaskRecord, run: RunRecord, steps: StepRecord[], events: RunEventRecord[], evaluations: EvaluationRecord[]): RunViewModel {
  const completedSteps = steps.filter((step) => step.status === 'completed').length;
  const failedSteps = steps.filter((step) => step.status === 'failed').length;
  const latestEvent = resolveLatestEvent(events);
  const latestEvaluation = evaluations[evaluations.length - 1] ?? null;

  return runViewModelSchema.parse({
    task,
    run,
    events,
    steps,
    evaluations,
    summary: {
      completedSteps,
      failedSteps,
      changedFiles: extractChangedFiles(steps),
      score: latestEvaluation ? latestEvaluation.score : null,
      latestEventTitle: latestEvent.title,
      latestEventLevel: latestEvent.level,
    },
  });
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
