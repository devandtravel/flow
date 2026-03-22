import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import YAML from 'yaml';
import { z } from 'zod';

const limitsSchema = z.object({
  max_steps: z.number().int().positive().default(20),
  max_runtime_sec: z.number().int().positive().default(120),
  max_files_changed: z.number().int().positive().default(50),
  max_iterations: z.number().int().positive().default(3),
});

export const runtimeConfigSchema = z.object({
  mode: z.enum(['project', 'system']).default('project'),
  workspace: z.object({
    root: z.string().default('.'),
  }),
  llm: z.object({
    provider: z.string().default('codex'),
  }),
  http: z.object({
    allowlist: z.array(z.string()).default(['example.com']),
  }).default({}),
  server: z.object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().positive().default(4310),
  }).default({}),
  worker: z.object({
    poll_interval_ms: z.number().int().positive().default(2000),
  }).default({}),
  limits: limitsSchema.default({}),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export const defaultConfig: RuntimeConfig = runtimeConfigSchema.parse({
  mode: 'project',
  workspace: { root: '.' },
  llm: { provider: 'codex' },
  http: { allowlist: ['example.com'] },
  limits: { max_steps: 20, max_runtime_sec: 120, max_files_changed: 50, max_iterations: 3 },
  server: { host: '127.0.0.1', port: 4310 },
  worker: { poll_interval_ms: 2000 },
});

export function getAgentDirectory(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.agent');
}

export function getConfigPath(workspaceRoot: string): string {
  return path.join(getAgentDirectory(workspaceRoot), 'config.yaml');
}

export function ensureAgentDirectories(workspaceRoot: string): { agentDir: string; artifactsDir: string; logsDir: string } {
  const agentDir = getAgentDirectory(workspaceRoot);
  const artifactsDir = path.join(agentDir, 'artifacts');
  const logsDir = path.join(agentDir, 'logs');
  mkdirSync(artifactsDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  return { agentDir, artifactsDir, logsDir };
}

export function writeDefaultConfig(workspaceRoot: string, mode: 'project' | 'system' = 'project'): string {
  ensureAgentDirectories(workspaceRoot);
  const configPath = getConfigPath(workspaceRoot);
  const config = {
    ...defaultConfig,
    mode,
  };

  writeFileSync(configPath, YAML.stringify(config), 'utf8');
  return configPath;
}

export function loadConfig(workspaceRoot: string, configPath = getConfigPath(workspaceRoot)): RuntimeConfig {
  dotenv.config({ path: path.join(workspaceRoot, '.env') });
  ensureAgentDirectories(workspaceRoot);

  if (!existsSync(configPath)) {
    writeDefaultConfig(workspaceRoot);
  }

  const rawConfig = readFileSync(configPath, 'utf8');
  const parsed = YAML.parse(rawConfig) ?? {};
  const merged = {
    ...defaultConfig,
    ...parsed,
    workspace: {
      ...defaultConfig.workspace,
      ...(parsed.workspace ?? {}),
      root: workspaceRoot,
    },
    llm: {
      ...defaultConfig.llm,
      ...(parsed.llm ?? {}),
    },
    http: {
      ...defaultConfig.http,
      ...(parsed.http ?? {}),
    },
    server: {
      ...defaultConfig.server,
      ...(parsed.server ?? {}),
    },
    worker: {
      ...defaultConfig.worker,
      ...(parsed.worker ?? {}),
    },
    limits: {
      ...defaultConfig.limits,
      ...(parsed.limits ?? {}),
    },
  };

  return runtimeConfigSchema.parse(merged);
}
