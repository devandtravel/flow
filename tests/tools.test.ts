import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildDefaultConfig } from '../packages/config';
import { PolicyEngine } from '../packages/policy';
import { createToolRegistry, executeTool, type ToolExecutionContext } from '../packages/tools';

let workspaceRoot = '';
let context: ToolExecutionContext;

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-tools-'));
  const config = buildDefaultConfig(workspaceRoot, 'project');
  context = {
    workspaceRoot,
    httpAllowlist: config.http.allowlist,
    policy: new PolicyEngine({
      ...config.policies,
      limits: config.limits,
      autonomy: config.autonomy,
      workspace: config.workspace,
    }),
  };
});

describe('tool registry', () => {
  it('writes and reads files within the workspace boundary', async () => {
    const tools = createToolRegistry();
    const writeResult = await executeTool(tools, 'fs.write_file', { path: 'notes.txt', content: 'hello' }, context);
    const readResult = await executeTool(tools, 'fs.read_file', { path: 'notes.txt' }, context);

    expect(writeResult.success).toBe(true);
    expect(readFileSync(path.join(workspaceRoot, 'notes.txt'), 'utf8')).toBe('hello');
    expect(readResult).toMatchObject({
      success: true,
      output: {
        content: 'hello',
      },
    });
  });

  it('rejects file access outside the configured workspace root', async () => {
    const tools = createToolRegistry();
    const result = await executeTool(tools, 'fs.read_file', { path: '../outside.txt' }, context);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('workspace boundary');
    }
  });

  it('applies FLOW patch format updates through repo.apply_patch', async () => {
    const tools = createToolRegistry();
    await executeTool(tools, 'fs.write_file', { path: 'README.md', content: '# Example\n\n## Production\n' }, context);

    const result = await executeTool(
      tools,
      'repo.apply_patch',
      {
        patch: [
          '*** Update File: README.md',
          '@@',
          ' ## Production',
          '+',
          '+## Проверка FLOW',
          '+Эта ветка используется для проверки runtime FLOW.',
        ].join('\n'),
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(readFileSync(path.join(workspaceRoot, 'README.md'), 'utf8')).toContain('## Проверка FLOW');
  });
});
