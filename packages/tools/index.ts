import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fetch } from 'undici';
import { z, type ZodSchema } from 'zod';

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  artifacts?: string[];
  changedFiles?: string[];
}

export interface Tool<TInput = unknown> {
  name: string;
  schema: ZodSchema<TInput>;
  execute(input: TInput): Promise<ToolResult>;
}

export interface ToolRegistryContext {
  workspaceRoot: string;
  httpAllowlist: string[];
}

function resolveSafePath(workspaceRoot: string, inputPath: string): string {
  const resolvedRoot = path.resolve(workspaceRoot);
  const candidate = path.resolve(workspaceRoot, inputPath);
  const relativePath = path.relative(resolvedRoot, candidate);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Path ${inputPath} resolves outside the workspace.`);
  }

  return candidate;
}

function executeGit(workspaceRoot: string, args: string[], stdin?: string): ToolResult {
  const result = spawnSync('git', args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    input: stdin,
  });

  if (result.status !== 0) {
    return { success: false, error: result.stderr || result.stdout || 'git command failed' };
  }

  return { success: true, data: { stdout: result.stdout.trim() } };
}

export function createToolRegistry(context: ToolRegistryContext): Map<string, Tool<any>> {
  const readFileTool: Tool<{ path: string }> = {
    name: 'fs.read_file',
    schema: z.object({ path: z.string().min(1) }),
    async execute(input) {
      try {
        const filePath = resolveSafePath(context.workspaceRoot, input.path);
        return { success: true, data: { path: filePath, content: readFileSync(filePath, 'utf8') } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };

  const writeFileTool: Tool<{ path: string; content: string }> = {
    name: 'fs.write_file',
    schema: z.object({ path: z.string().min(1), content: z.string() }),
    async execute(input) {
      try {
        const filePath = resolveSafePath(context.workspaceRoot, input.path);
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, input.content, 'utf8');
        return {
          success: true,
          data: { path: filePath, bytes: Buffer.byteLength(input.content) },
          changedFiles: [filePath],
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };

  const listDirTool: Tool<{ path?: string }> = {
    name: 'fs.list_dir',
    schema: z.object({ path: z.string().default('.') }).default({ path: '.' }),
    async execute(input) {
      try {
        const targetPath = resolveSafePath(context.workspaceRoot, input.path ?? '.');
        const entries = readdirSync(targetPath, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'dir' : 'file',
        }));
        return { success: true, data: { path: targetPath, entries } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };

  const gitStatusTool: Tool<Record<string, never>> = {
    name: 'git.status',
    schema: z.object({}).default({}),
    async execute() {
      return executeGit(context.workspaceRoot, ['status', '--short']);
    },
  };

  const gitCreateBranchTool: Tool<{ branch: string }> = {
    name: 'git.create_branch',
    schema: z.object({ branch: z.string().regex(/^[A-Za-z0-9._/-]+$/) }),
    async execute(input) {
      return executeGit(context.workspaceRoot, ['checkout', '-b', input.branch]);
    },
  };

  const gitCommitTool: Tool<{ message: string }> = {
    name: 'git.commit',
    schema: z.object({ message: z.string().min(1) }),
    async execute(input) {
      const addResult = executeGit(context.workspaceRoot, ['add', '.']);
      if (!addResult.success) {
        return addResult;
      }
      return executeGit(context.workspaceRoot, ['commit', '--allow-empty', '-m', input.message]);
    },
  };

  const repoRunTestsTool: Tool<Record<string, never>> = {
    name: 'repo.run_tests',
    schema: z.object({}).default({}),
    async execute() {
      const usePnpm = existsSync(path.join(context.workspaceRoot, 'pnpm-lock.yaml'));
      const command = usePnpm ? 'corepack' : 'npm';
      const args = usePnpm ? ['pnpm', 'test'] : ['run', 'test'];
      const result = spawnSync(command, args, {
        cwd: context.workspaceRoot,
        encoding: 'utf8',
      });

      if (result.status !== 0) {
        return { success: false, error: result.stderr || result.stdout || 'test command failed' };
      }

      return { success: true, data: { stdout: result.stdout.trim() } };
    },
  };

  const repoApplyPatchTool: Tool<{ patch: string }> = {
    name: 'repo.apply_patch',
    schema: z.object({ patch: z.string().min(1) }),
    async execute(input) {
      return executeGit(context.workspaceRoot, ['apply', '--whitespace=nowarn', '-'], input.patch);
    },
  };

  const httpFetchTool: Tool<{ url: string; method?: string }> = {
    name: 'http.fetch',
    schema: z.object({ url: z.string().url(), method: z.string().default('GET') }),
    async execute(input) {
      try {
        const targetUrl = new URL(input.url);
        if (!context.httpAllowlist.includes(targetUrl.hostname)) {
          return { success: false, error: `Hostname ${targetUrl.hostname} is not in the allowlist.` };
        }

        const response = await fetch(input.url, { method: input.method ?? 'GET' });
        const body = await response.text();
        return {
          success: response.ok,
          data: {
            status: response.status,
            body: body.slice(0, 4096),
          },
          error: response.ok ? undefined : `HTTP ${response.status}`,
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };

  return new Map<string, Tool<any>>([
    [readFileTool.name, readFileTool],
    [writeFileTool.name, writeFileTool],
    [listDirTool.name, listDirTool],
    [gitStatusTool.name, gitStatusTool],
    [gitCreateBranchTool.name, gitCreateBranchTool],
    [gitCommitTool.name, gitCommitTool],
    [repoRunTestsTool.name, repoRunTestsTool],
    [repoApplyPatchTool.name, repoApplyPatchTool],
    [httpFetchTool.name, httpFetchTool],
  ]);
}

export async function executeTool(registry: Map<string, Tool<any>>, toolName: string, input: unknown): Promise<ToolResult> {
  const tool = registry.get(toolName);
  if (!tool) {
    return { success: false, error: `Unknown tool ${toolName}` };
  }

  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  return tool.execute(parsed.data);
}
