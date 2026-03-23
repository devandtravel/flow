import { z } from 'zod';
import { eventLevelSchema } from '../domain';

const keyFactSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
});

const runtimeLogEntryViewModelSchema = z.object({
  time: z.string().nullable(),
  level: eventLevelSchema,
  category: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  facts: z.array(keyFactSchema),
  details: z.record(z.string(), z.unknown()).nullable(),
});
export type RuntimeLogEntryViewModel = z.infer<typeof runtimeLogEntryViewModelSchema>;

const runtimeLogSummaryViewModelSchema = z.object({
  totalEntries: z.number().int().nonnegative(),
  infoEntries: z.number().int().nonnegative(),
  warningEntries: z.number().int().nonnegative(),
  errorEntries: z.number().int().nonnegative(),
  lastEntryAt: z.string().nullable(),
  categories: z.record(z.string(), z.number().int().nonnegative()),
});
export type RuntimeLogSummaryViewModel = z.infer<typeof runtimeLogSummaryViewModelSchema>;

export const runtimeLogViewModelSchema = z.object({
  path: z.string().min(1),
  limit: z.number().int().positive(),
  summary: runtimeLogSummaryViewModelSchema,
  entries: z.array(runtimeLogEntryViewModelSchema),
});
export type RuntimeLogViewModel = z.infer<typeof runtimeLogViewModelSchema>;

function parseLogLevel(value: unknown): z.infer<typeof eventLevelSchema> {
  if (typeof value === 'number') {
    if (value >= 50) {
      return 'error';
    }
    if (value >= 40) {
      return 'warning';
    }
    return 'info';
  }

  if (value === 'error' || value === 'warning' || value === 'info') {
    return value;
  }

  return 'info';
}

function parseLogLine(line: string): RuntimeLogEntryViewModel {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return runtimeLogEntryViewModelSchema.parse({
      time: null,
      level: 'info',
      category: 'runtime',
      title: 'Операционное событие',
      summary: line,
      facts: [],
      details: null,
    });
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return runtimeLogEntryViewModelSchema.parse({
      time: null,
      level: 'info',
      category: 'runtime',
      title: 'Операционное событие',
      summary: line,
      facts: [],
      details: null,
    });
  }

  const record = z.record(z.string(), z.unknown()).parse(raw);
  const category = typeof record.category === 'string' && record.category.length > 0 ? record.category : 'runtime';
  const title = typeof record.msg === 'string' && record.msg.length > 0
    ? record.msg
    : typeof record.event === 'string' && record.event.length > 0
      ? record.event
      : 'Операционное событие';
  const summary = typeof record.summary === 'string' ? record.summary : '';
  const time = typeof record.time === 'number'
    ? new Date(record.time).toISOString()
    : typeof record.time === 'string'
      ? record.time
      : null;

  const facts: Array<{ label: string; value: string }> = [];
  const factKeys = [
    ['taskId', 'task'],
    ['runId', 'run'],
    ['targetId', 'target'],
    ['state', 'state'],
    ['event', 'event'],
    ['tool', 'tool'],
    ['decision', 'decision'],
    ['reason', 'reason'],
    ['artifactCount', 'artifacts'],
  ] as const;

  for (const [key, label] of factKeys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      facts.push({ label, value });
      continue;
    }
    if (typeof value === 'number') {
      facts.push({ label, value: String(value) });
    }
  }

  const details = Object.fromEntries(
    Object.entries(record).filter(([key]) =>
      !['level', 'time', 'msg', 'summary', 'category'].includes(key),
    ),
  );

  return runtimeLogEntryViewModelSchema.parse({
    time,
    level: parseLogLevel(record.level),
    category,
    title,
    summary,
    facts,
    details: Object.keys(details).length > 0 ? details : null,
  });
}

export function buildRuntimeLogViewModel(input: {
  path: string;
  limit: number;
  content: string;
}): RuntimeLogViewModel {
  const entries = input.content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseLogLine);

  const categories: Record<string, number> = {};
  for (const entry of entries) {
    categories[entry.category] = (categories[entry.category] ?? 0) + 1;
  }

  return runtimeLogViewModelSchema.parse({
    path: input.path,
    limit: input.limit,
    summary: {
      totalEntries: entries.length,
      infoEntries: entries.filter((entry) => entry.level === 'info').length,
      warningEntries: entries.filter((entry) => entry.level === 'warning').length,
      errorEntries: entries.filter((entry) => entry.level === 'error').length,
      lastEntryAt: entries[entries.length - 1]?.time ?? null,
      categories,
    },
    entries,
  });
}
