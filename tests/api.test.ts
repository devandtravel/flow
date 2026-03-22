import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeDefaultConfig } from '../packages/config';
import { createApiServer } from '../packages/api/server';

let workspaceRoot: string;
let api: ReturnType<typeof createApiServer>;

beforeEach(async () => {
  workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-api-'));
  writeDefaultConfig(workspaceRoot);
  api = createApiServer(workspaceRoot);
  await api.start();
});

afterEach(async () => {
  await api.stop();
});

describe('API server', () => {
  it('creates and runs a task through the REST API', async () => {
    const response = await fetch('http://127.0.0.1:4310/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'test task', autorun: true }),
    });

    expect(response.status).toBe(201);
    const summary = (await response.json()) as { state: string; artifacts: Array<{ id: string }> };
    expect(summary.state).toBe('completed');

    const tasksResponse = await fetch('http://127.0.0.1:4310/tasks');
    const tasks = (await tasksResponse.json()) as Array<{ goal: string }>;
    expect(tasks[0]?.goal).toBe('test task');
  });
});
