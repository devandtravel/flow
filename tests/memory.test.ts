import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDefaultConfig } from '../packages/config';
import { AgentRuntime } from '../packages/core/loop/runtime';

describe('MemoryService', () => {
  it('returns flattened observed paths for a task from path observation memory', () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-memory-observed-paths-'));
    const config = buildDefaultConfig(workspaceRoot, 'project');
    config.llm.provider = 'mock';
    const runtime = new AgentRuntime({ workspaceRoot, config });
    const task = runtime.createTask('discovery memory');
    const runId = randomUUID();
    const firstStepId = randomUUID();
    const secondStepId = randomUUID();

    runtime.memory.recordSemantic(`observed-paths:${task.id}:one`, {
      type: 'path_observation',
      task_id: task.id,
      target_id: task.target_id,
      source_tool: 'repo.search_text',
      anchor_path: '.',
      query: 'purchaseDate',
      observed_paths: ['apps/web/src/lib/guest-schema.ts', 'apps/web/src/lib/admin-guests-import.ts'],
      run_id: runId,
      step_id: firstStepId,
      recorded_at: new Date().toISOString(),
    });
    runtime.memory.recordSemantic(`observed-paths:${task.id}:two`, {
      type: 'path_observation',
      task_id: task.id,
      target_id: task.target_id,
      source_tool: 'fs.list_dir',
      anchor_path: 'apps/web/src/lib',
      observed_paths: ['apps/web/src/lib/admin-guests-import.ts', 'apps/web/src/lib/guest-csv-import.ts'],
      run_id: runId,
      step_id: secondStepId,
      recorded_at: new Date().toISOString(),
    });

    expect(runtime.memory.getTaskObservedPaths(task.id)).toEqual([
      'apps/web/src/lib/admin-guests-import.ts',
      'apps/web/src/lib/guest-csv-import.ts',
      'apps/web/src/lib/guest-schema.ts',
    ]);
    expect(runtime.memory.getTargetObservedPaths(task.target_id)).toEqual([
      'apps/web/src/lib/admin-guests-import.ts',
      'apps/web/src/lib/guest-csv-import.ts',
      'apps/web/src/lib/guest-schema.ts',
    ]);
  });
});
