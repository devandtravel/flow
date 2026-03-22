import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeDefaultConfig } from '../packages/config';
import { AgentRuntime } from '../packages/core/loop/runtime';

describe('AgentRuntime', () => {
  it('creates a task, executes the loop, and stores artifacts', async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-runtime-'));
    writeDefaultConfig(workspaceRoot);
    const runtime = new AgentRuntime({ workspaceRoot });
    const task = runtime.createTask('test task');

    const summary = await runtime.runTask(task.id);

    expect(summary.state).toBe('completed');
    expect(summary.artifacts.length).toBeGreaterThanOrEqual(3);
    expect(existsSync(path.join(workspaceRoot, '.agent', 'flow.db'))).toBe(true);
    expect(runtime.listTasks()).toHaveLength(1);
    expect(readFileSync(summary.artifacts[0].path, 'utf8')).toContain('step');
  });
});
