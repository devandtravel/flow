import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fetch } from 'undici';
import { z } from 'zod';
import { capabilityNameSchema } from '../domain';
import { ValidationError } from '../errors';
import type { PolicyEngine } from '../policy';

export const directoryEntrySchema = z.object({
  name: z.string().min(1),
  type: z.enum(['dir', 'file']),
});

export const toolEvidenceSchema = z.object({
  summary: z.string().min(1),
  details: z.record(z.string(), z.unknown()).default({}),
});

export const toolSuccessSchema = z.object({
  success: z.literal(true),
  output: z.record(z.string(), z.unknown()),
  evidence: toolEvidenceSchema,
  changedFiles: z.array(z.string()).default([]),
});

export const toolFailureSchema = z.object({
  success: z.literal(false),
  error: z.string().min(1),
  evidence: toolEvidenceSchema,
  changedFiles: z.array(z.string()).default([]),
});

export const toolResultSchema = z.discriminatedUnion('success', [toolSuccessSchema, toolFailureSchema]);
export type ToolResult = z.infer<typeof toolResultSchema>;

export interface ToolExecutionContext {
  workspaceRoot: string;
  policy: PolicyEngine;
  httpAllowlist: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  capability: z.infer<typeof capabilityNameSchema>;
  sideEffectClass: 'read' | 'write' | 'execute' | 'network';
  reversibility: 'reversible' | 'irreversible';
  approvalClass: 'never' | 'sensitive' | 'destructive';
  inputSchema: z.ZodType<unknown>;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult>;
}

function successResult(
  output: Record<string, unknown>,
  summary: string,
  changedFiles: string[] = [],
): ToolResult {
  return {
    success: true,
    output,
    evidence: {
      summary,
      details: output,
    },
    changedFiles,
  };
}

function failureResult(error: string, details: Record<string, unknown> = {}): ToolResult {
  return {
    success: false,
    error,
    evidence: {
      summary: error,
      details,
    },
    changedFiles: [],
  };
}

function resolvePath(workspaceRoot: string, requestedPath: string): string {
  return path.resolve(workspaceRoot, requestedPath);
}

function ensureReadable(targetPath: string, policy: PolicyEngine): void {
  if (!policy.canRead(targetPath)) {
    throw new ValidationError(`Read access to ${targetPath} is outside the configured workspace boundary.`, {
      targetPath,
      operation: 'read',
    });
  }
}

function ensureWritable(targetPath: string, policy: PolicyEngine): void {
  if (!policy.canWrite(targetPath)) {
    throw new ValidationError(`Write access to ${targetPath} is outside the configured workspace boundary.`, {
      targetPath,
      operation: 'write',
    });
  }
}

function runCommand(workspaceRoot: string, command: string, args: string[], stdin?: string): ToolResult {
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    input: stdin,
  });

  if (result.status !== 0) {
    return failureResult(result.stderr || result.stdout || `${command} command failed`, {
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.status,
    });
  }

  return successResult(
    {
      command,
      args,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      status: result.status ?? 0,
    },
    `${command} ${args.join(' ')} completed successfully.`,
  );
}

function extractChangedFilesFromPatch(patch: string): string[] {
  const changedFiles = new Set<string>();
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ b/')) {
      changedFiles.add(line.replace('+++ b/', '').trim());
    }
  }

  return [...changedFiles];
}

const readFileInputSchema = z.object({
  path: z.string().min(1),
});

const writeFileInputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const listDirectoryInputSchema = z.object({
  path: z.string().default('.'),
});

const gitBranchInputSchema = z.object({
  branch: z.string().regex(/^[A-Za-z0-9._/-]+$/),
});

const gitCommitInputSchema = z.object({
  message: z.string().min(1),
});

const patchInputSchema = z.object({
  patch: z.string().min(1),
});

const httpInputSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'HEAD']).default('GET'),
});

const shellInputSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
});

export function createToolRegistry(): Map<string, ToolDefinition> {
  const tools: ToolDefinition[] = [
    {
      name: 'fs.read_file',
      description: 'Read a UTF-8 text file inside the configured workspace boundary.',
      capability: 'fs.read',
      sideEffectClass: 'read',
      reversibility: 'reversible',
      approvalClass: 'never',
      inputSchema: readFileInputSchema,
      async execute(input, context) {
        try {
          const parsed = readFileInputSchema.parse(input);
          const filePath = resolvePath(context.workspaceRoot, parsed.path);
          ensureReadable(filePath, context.policy);
          return successResult(
            {
              path: filePath,
              content: readFileSync(filePath, 'utf8'),
            },
            `Read file ${parsed.path}.`,
          );
        } catch (error) {
          return failureResult(error instanceof Error ? error.message : 'Unknown file read error.');
        }
      },
    },
    {
      name: 'fs.write_file',
      description: 'Write a UTF-8 text file inside the configured workspace boundary.',
      capability: 'fs.write',
      sideEffectClass: 'write',
      reversibility: 'reversible',
      approvalClass: 'sensitive',
      inputSchema: writeFileInputSchema,
      async execute(input, context) {
        try {
          const parsed = writeFileInputSchema.parse(input);
          const filePath = resolvePath(context.workspaceRoot, parsed.path);
          ensureWritable(filePath, context.policy);
          mkdirSync(path.dirname(filePath), { recursive: true });
          writeFileSync(filePath, parsed.content, 'utf8');
          return successResult(
            {
              path: filePath,
              bytes: Buffer.byteLength(parsed.content),
            },
            `Wrote file ${parsed.path}.`,
            [filePath],
          );
        } catch (error) {
          return failureResult(error instanceof Error ? error.message : 'Unknown file write error.');
        }
      },
    },
    {
      name: 'fs.list_dir',
      description: 'List entries inside a directory within the workspace boundary.',
      capability: 'fs.read',
      sideEffectClass: 'read',
      reversibility: 'reversible',
      approvalClass: 'never',
      inputSchema: listDirectoryInputSchema,
      async execute(input, context) {
        try {
          const parsed = listDirectoryInputSchema.parse(input);
          const directoryPath = resolvePath(context.workspaceRoot, parsed.path);
          ensureReadable(directoryPath, context.policy);
          const entries = readdirSync(directoryPath, { withFileTypes: true }).map((entry) =>
            directoryEntrySchema.parse({
              name: entry.name,
              type: entry.isDirectory() ? 'dir' : 'file',
            }),
          );
          return successResult(
            {
              path: directoryPath,
              entries,
            },
            `Listed directory ${parsed.path}.`,
          );
        } catch (error) {
          return failureResult(error instanceof Error ? error.message : 'Unknown directory listing error.');
        }
      },
    },
    {
      name: 'git.status',
      description: 'Get git working tree status.',
      capability: 'git.status',
      sideEffectClass: 'read',
      reversibility: 'reversible',
      approvalClass: 'never',
      inputSchema: z.object({}),
      async execute(_input, context) {
        return runCommand(context.workspaceRoot, 'git', ['status', '--short']);
      },
    },
    {
      name: 'git.create_branch',
      description: 'Create and checkout a branch.',
      capability: 'git.branch',
      sideEffectClass: 'write',
      reversibility: 'reversible',
      approvalClass: 'sensitive',
      inputSchema: gitBranchInputSchema,
      async execute(input, context) {
        const parsed = gitBranchInputSchema.parse(input);
        return runCommand(context.workspaceRoot, 'git', ['checkout', '-b', parsed.branch]);
      },
    },
    {
      name: 'git.commit',
      description: 'Stage all changes and create a commit.',
      capability: 'git.commit',
      sideEffectClass: 'write',
      reversibility: 'irreversible',
      approvalClass: 'destructive',
      inputSchema: gitCommitInputSchema,
      async execute(input, context) {
        const parsed = gitCommitInputSchema.parse(input);
        const addResult = runCommand(context.workspaceRoot, 'git', ['add', '.']);
        if (!addResult.success) {
          return addResult;
        }

        const commitResult = runCommand(context.workspaceRoot, 'git', ['commit', '--allow-empty', '-m', parsed.message]);
        if (!commitResult.success) {
          return commitResult;
        }

        return successResult(
          {
            ...commitResult.output,
            commit_message: parsed.message,
          },
          `Created git commit "${parsed.message}".`,
        );
      },
    },
    {
      name: 'repo.run_tests',
      description: 'Run the repository test suite.',
      capability: 'repo.test',
      sideEffectClass: 'execute',
      reversibility: 'reversible',
      approvalClass: 'never',
      inputSchema: z.object({}),
      async execute(_input, context) {
        const usePnpm = existsSync(path.join(context.workspaceRoot, 'pnpm-lock.yaml'));
        return runCommand(context.workspaceRoot, usePnpm ? 'corepack' : 'npm', usePnpm ? ['pnpm', 'test'] : ['run', 'test']);
      },
    },
    {
      name: 'repo.build',
      description: 'Build the repository artifacts.',
      capability: 'repo.build',
      sideEffectClass: 'execute',
      reversibility: 'reversible',
      approvalClass: 'never',
      inputSchema: z.object({}),
      async execute(_input, context) {
        const usePnpm = existsSync(path.join(context.workspaceRoot, 'pnpm-lock.yaml'));
        return runCommand(context.workspaceRoot, usePnpm ? 'corepack' : 'npm', usePnpm ? ['pnpm', 'build'] : ['run', 'build']);
      },
    },
    {
      name: 'repo.run_checks',
      description: 'Run the repository quality checks.',
      capability: 'repo.check',
      sideEffectClass: 'execute',
      reversibility: 'reversible',
      approvalClass: 'never',
      inputSchema: z.object({}),
      async execute(_input, context) {
        const usePnpm = existsSync(path.join(context.workspaceRoot, 'pnpm-lock.yaml'));
        if (usePnpm && existsSync(path.join(context.workspaceRoot, 'package.json'))) {
          const packageJson = JSON.parse(readFileSync(path.join(context.workspaceRoot, 'package.json'), 'utf8'));
          const scripts = packageJson && typeof packageJson === 'object' && 'scripts' in packageJson ? packageJson.scripts : undefined;
          if (scripts && typeof scripts === 'object' && 'qa' in scripts && typeof scripts.qa === 'string') {
            return runCommand(context.workspaceRoot, 'corepack', ['pnpm', 'qa']);
          }
        }

        return runCommand(context.workspaceRoot, usePnpm ? 'corepack' : 'npm', usePnpm ? ['pnpm', 'lint'] : ['run', 'lint']);
      },
    },
    {
      name: 'repo.apply_patch',
      description: 'Apply a unified diff patch to the repository.',
      capability: 'repo.patch',
      sideEffectClass: 'write',
      reversibility: 'reversible',
      approvalClass: 'sensitive',
      inputSchema: patchInputSchema,
      async execute(input, context) {
        const parsed = patchInputSchema.parse(input);
        const patchResult = runCommand(context.workspaceRoot, 'git', ['apply', '--whitespace=nowarn', '-'], parsed.patch);
        if (!patchResult.success) {
          return patchResult;
        }

        const changedFiles = extractChangedFilesFromPatch(parsed.patch);
        return successResult(
          {
            ...patchResult.output,
            changed_file_count: changedFiles.length,
          },
          'Applied repository patch.',
          changedFiles,
        );
      },
    },
    {
      name: 'http.fetch',
      description: 'Fetch a URL from the configured allowlist.',
      capability: 'http.fetch',
      sideEffectClass: 'network',
      reversibility: 'reversible',
      approvalClass: 'never',
      inputSchema: httpInputSchema,
      async execute(input, context) {
        try {
          const parsed = httpInputSchema.parse(input);
          const targetUrl = new URL(parsed.url);
          if (!context.httpAllowlist.includes(targetUrl.hostname)) {
            return failureResult(`Hostname ${targetUrl.hostname} is not in the allowlist.`);
          }

          const response = await fetch(parsed.url, { method: parsed.method });
          const body = await response.text();
          return response.ok
            ? successResult(
                {
                  status: response.status,
                  body: body.slice(0, 4096),
                },
                `Fetched ${parsed.url}.`,
              )
            : failureResult(`HTTP ${response.status}`, {
                status: response.status,
                body: body.slice(0, 4096),
              });
        } catch (error) {
          return failureResult(error instanceof Error ? error.message : 'Unknown HTTP fetch error.');
        }
      },
    },
    {
      name: 'shell.exec',
      description: 'Run a bounded shell command when explicitly enabled by capability and policy.',
      capability: 'shell.exec',
      sideEffectClass: 'execute',
      reversibility: 'irreversible',
      approvalClass: 'destructive',
      inputSchema: shellInputSchema,
      async execute(input, context) {
        const parsed = shellInputSchema.parse(input);
        if (!statSync(context.workspaceRoot).isDirectory()) {
          return failureResult(`Workspace root ${context.workspaceRoot} is not a directory.`);
        }
        return runCommand(context.workspaceRoot, parsed.command, parsed.args);
      },
    },
  ];

  return new Map(tools.map((tool) => [tool.name, tool]));
}

export function listToolDefinitions(registry: Map<string, ToolDefinition>): ToolDefinition[] {
  return [...registry.values()];
}

export async function executeTool(
  registry: Map<string, ToolDefinition>,
  toolName: string,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const tool = registry.get(toolName);
  if (!tool) {
    return failureResult(`Unknown tool ${toolName}.`);
  }

  return tool.execute(input, context);
}
