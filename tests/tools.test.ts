import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createToolRegistry, executeTool } from '../packages/tools';

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-tools-'));
});

describe('tool registry', () => {
  it('writes and reads files within the workspace', async () => {
    const tools = createToolRegistry({ workspaceRoot, httpAllowlist: ['example.com'] });
    const writeResult = await executeTool(tools, 'fs.write_file', { path: 'notes.txt', content: 'hello' });
    const readResult = await executeTool(tools, 'fs.read_file', { path: 'notes.txt' });

    expect(writeResult.success).toBe(true);
    expect(readFileSync(path.join(workspaceRoot, 'notes.txt'), 'utf8')).toBe('hello');
    expect(readResult).toMatchObject({ success: true, data: { content: 'hello' } });
  });

  it('rejects file access outside the workspace root', async () => {
    const tools = createToolRegistry({ workspaceRoot, httpAllowlist: ['example.com'] });
    const result = await executeTool(tools, 'fs.read_file', { path: '../outside.txt' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside the workspace');
  });
});
