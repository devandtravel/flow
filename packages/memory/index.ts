import type { RuntimeDatabase } from '../db/database';

function parseValue(value: string): unknown {
  return JSON.parse(value);
}

export class MemoryService {
  constructor(private readonly db: RuntimeDatabase) {}

  getContext(): { episodic: unknown[]; procedural: unknown[]; failure: unknown[] } {
    return {
      episodic: this.db.listMemory('episodic').map((entry) => parseValue(entry.value_json)),
      procedural: this.db.listMemory('procedural').map((entry) => parseValue(entry.value_json)),
      failure: this.db.listMemory('failure').map((entry) => parseValue(entry.value_json)),
    };
  }

  recordRun(runId: string, summary: unknown): void {
    this.db.upsertMemory('episodic', `run:${runId}`, summary as Record<string, unknown>);
  }

  recordSuccessfulPattern(tool: string, value: unknown): void {
    this.db.upsertMemory('procedural', `tool:${tool}`, value as Record<string, unknown>);
  }

  recordFailure(key: string, value: unknown): void {
    this.db.upsertMemory('failure', key, value as Record<string, unknown>);
  }
}
