import { z } from 'zod';
import { memorySummarySchema, type MemoryEntryRecord, type MemorySummary } from '../domain';
import type { RuntimeDatabase } from '../db/database';

const memoryObjectSchema = z.record(z.string(), z.unknown());

function parseMemoryValue(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  return memoryObjectSchema.parse(parsed);
}

function takeRecent(entries: MemoryEntryRecord[], limit: number): Record<string, unknown>[] {
  return entries.slice(0, limit).map((entry) => parseMemoryValue(entry.value_json));
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
