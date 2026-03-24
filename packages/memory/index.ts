import { z } from 'zod';
import {
  fileSnapshotMemorySchema,
  memorySummarySchema,
  pathObservationMemorySchema,
  type FileSnapshotMemory,
  type MemoryEntryRecord,
  type MemorySummary,
  type PathObservationMemory,
} from '../domain';
import type { RuntimeDatabase } from '../db/database';

const memoryObjectSchema = z.record(z.string(), z.unknown());

function parseMemoryValue(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  return memoryObjectSchema.parse(parsed);
}

function takeRecent(entries: MemoryEntryRecord[], limit: number): Record<string, unknown>[] {
  return entries.slice(0, limit).map((entry) => parseMemoryValue(entry.value_json));
}

function toSortedLimitedValues(values: Set<string>, limit: number): string[] {
  return [...values].sort((left, right) => left.localeCompare(right)).slice(0, limit);
}

export class MemoryService {
  constructor(private readonly db: RuntimeDatabase) {}

  getContext(limit = 20): MemorySummary {
    return memorySummarySchema.parse({
      episodic: takeRecent(this.db.listMemory('episodic'), limit),
      procedural: takeRecent(this.db.listMemory('procedural'), limit),
      failure: takeRecent(this.db.listMemory('failure'), limit),
      semantic: takeRecent(this.db.listMemory('semantic'), limit),
    });
  }

  getTaskFileSnapshots(taskId: string, limit = 20): FileSnapshotMemory[] {
    return this.db
      .listMemory('semantic')
      .map((entry) => parseMemoryValue(entry.value_json))
      .filter((value) => fileSnapshotMemorySchema.safeParse(value).success)
      .map((value) => fileSnapshotMemorySchema.parse(value))
      .filter((value) => value.task_id === taskId)
      .slice(0, limit);
  }

  getTaskPathObservations(taskId: string, limit = 20): PathObservationMemory[] {
    return this.db
      .listMemory('semantic')
      .map((entry) => parseMemoryValue(entry.value_json))
      .filter((value) => pathObservationMemorySchema.safeParse(value).success)
      .map((value) => pathObservationMemorySchema.parse(value))
      .filter((value) => value.task_id === taskId)
      .slice(0, limit);
  }

  getTaskObservedPaths(taskId: string, limit = 40): string[] {
    const observedPaths = new Set<string>();

    for (const observation of this.getTaskPathObservations(taskId, limit)) {
      for (const observedPath of observation.observed_paths) {
        observedPaths.add(observedPath);
      }
    }

    return toSortedLimitedValues(observedPaths, limit);
  }

  getTargetObservedPaths(targetId: string, limit = 40): string[] {
    const observedPaths = new Set<string>();

    for (const observation of this.db
      .listMemory('semantic')
      .map((entry) => parseMemoryValue(entry.value_json))
      .filter((value) => pathObservationMemorySchema.safeParse(value).success)
      .map((value) => pathObservationMemorySchema.parse(value))
      .filter((value) => value.target_id === targetId)
      .slice(0, limit)) {
      for (const observedPath of observation.observed_paths) {
        observedPaths.add(observedPath);
      }
    }

    return toSortedLimitedValues(observedPaths, limit);
  }

  recordRun(runId: string, summary: Record<string, unknown>): void {
    this.db.upsertMemory('episodic', `run:${runId}`, summary);
  }

  recordSuccessfulPattern(tool: string, value: Record<string, unknown>): void {
    this.db.upsertMemory('procedural', `tool:${tool}`, value);
  }

  recordFailure(key: string, value: Record<string, unknown>): void {
    this.db.upsertMemory('failure', key, value);
  }

  recordSemantic(key: string, value: Record<string, unknown>): void {
    this.db.upsertMemory('semantic', key, value);
  }
}
