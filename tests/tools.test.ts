import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildDefaultConfig } from '../packages/config';
import { PolicyEngine } from '../packages/policy';
import { createToolRegistry, executeTool, type ToolExecutionContext } from '../packages/tools';

let workspaceRoot = '';
let context: ToolExecutionContext;
const hasRipgrep = spawnSync('rg', ['--version'], { encoding: 'utf8' }).status === 0;

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

  it.runIf(hasRipgrep)('searches repository text through repo.search_text', async () => {
    const tools = createToolRegistry();
    mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    writeFileSync(path.join(workspaceRoot, 'src', 'feature.ts'), 'export const landingTitle = "Landing CTA";\n', {
      encoding: 'utf8',
      flag: 'w',
      mode: 0o644,
    });

    const result = await executeTool(tools, 'repo.search_text', { query: 'landingTitle', path: '.', max_results: 5 }, context);

    expect(result.success).toBe(true);
    if (result.success) {
      const matchCount = result.output['match_count'];
      const matches = result.output['matches'];
      expect(typeof matchCount === 'number' && matchCount > 0).toBe(true);
      expect(Array.isArray(matches)).toBe(true);
      const firstMatch = Array.isArray(matches) ? matches[0] : undefined;
      if (!firstMatch || typeof firstMatch !== 'object' || !('path' in firstMatch) || typeof firstMatch.path !== 'string') {
        throw new Error('Expected the first text search match to include a path.');
      }
      expect(firstMatch.path).toContain('feature.ts');
    }
  });

  it.runIf(hasRipgrep)('searches repository file paths through repo.search_files', async () => {
    const tools = createToolRegistry();
    mkdirSync(path.join(workspaceRoot, 'components'), { recursive: true });
    writeFileSync(path.join(workspaceRoot, 'components', 'LandingCard.tsx'), 'export const LandingCard = null;\n', {
      encoding: 'utf8',
      flag: 'w',
      mode: 0o644,
    });

    const result = await executeTool(tools, 'repo.search_files', { pattern: '*Landing*', path: '.', max_results: 10 }, context);

    expect(result.success).toBe(true);
    if (result.success) {
      const fileCount = result.output['file_count'];
      const files = result.output['files'];
      expect(typeof fileCount === 'number' && fileCount > 0).toBe(true);
      if (!Array.isArray(files)) {
        throw new Error('Expected repo.search_files to return a files array.');
      }
      const stringFiles = files.filter((file): file is string => typeof file === 'string');
      expect(stringFiles.some((file) => file.includes('LandingCard.tsx'))).toBe(true);
    }
  });

  it.runIf(hasRipgrep)('searches repository symbol definitions through repo.symbol_search', async () => {
    const tools = createToolRegistry();
    mkdirSync(path.join(workspaceRoot, 'packages', 'i18n', 'src'), { recursive: true });
    writeFileSync(
      path.join(workspaceRoot, 'packages', 'i18n', 'src', 'types.ts'),
      'export type LocalizedOptionalField = { value?: string };\n',
      {
        encoding: 'utf8',
        flag: 'w',
        mode: 0o644,
      },
    );

    const result = await executeTool(
      tools,
      'repo.symbol_search',
      { symbol: 'LocalizedOptionalField', path: '.', mode: 'definition', max_results: 5 },
      context,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      const matchCount = result.output['match_count'];
      const matches = result.output['matches'];
      expect(typeof matchCount === 'number' && matchCount > 0).toBe(true);
      expect(Array.isArray(matches)).toBe(true);
      const firstMatch = Array.isArray(matches) ? matches[0] : undefined;
      if (!firstMatch || typeof firstMatch !== 'object' || !('path' in firstMatch) || typeof firstMatch.path !== 'string') {
        throw new Error('Expected the first symbol search match to include a path.');
      }
      expect(firstMatch.path).toContain('types.ts');
    }
  });

  it('allows shell.exec for read-only discovery commands', async () => {
    const tools = createToolRegistry();
    await executeTool(tools, 'fs.write_file', { path: 'README.md', content: '# Example\n' }, context);

    const result = await executeTool(tools, 'shell.exec', { command: 'ls', args: ['.'] }, context);

    expect(result.success).toBe(true);
    if (result.success) {
      const stdout = result.output['stdout'];
      expect(typeof stdout === 'string' && stdout.includes('README.md')).toBe(true);
    }
  });

  it('rejects shell.exec commands outside the allowed discovery toolset', async () => {
    const tools = createToolRegistry();

    const result = await executeTool(tools, 'shell.exec', { command: 'rm', args: ['-rf', '.'] }, context);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('allowed discovery toolset');
    }
  });
});
