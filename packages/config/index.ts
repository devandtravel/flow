import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import YAML from 'yaml';
import { z } from 'zod';
import {
  autonomyModeSchema,
  capabilityNameSchema,
  executionProfileSchema,
  llmProviderNameSchema,
  runtimeModeSchema,
  scheduleConfigSchema,
  targetConfigSchema,
} from '../domain';

const limitsSchema = z.object({
  max_steps: z.number().int().positive().default(20),
  max_runtime_sec: z.number().int().positive().default(120),
  max_files_changed: z.number().int().positive().default(50),
  max_iterations: z.number().int().positive().default(3),
});

const capabilityConfigSchema = z.object({
  enabled: z.array(capabilityNameSchema).min(1),
});

const policyRuleSchema = z.object({
  tools: z.array(z.string()).default([]),
  capabilities: z.array(capabilityNameSchema).default([]),
});

const policyConfigSchema = z.object({
  allow_tools: z.array(z.string()).min(1),
  deny_patterns: z.array(z.string()).default([]),
  require_approval: policyRuleSchema.default({}),
});

const approvalConfigSchema = z.object({
  required_for: policyRuleSchema.default({}),
});

const workspaceConfigSchema = z.object({
  root: z.string().min(1),
  read_paths: z.array(z.string().min(1)).min(1),
  write_paths: z.array(z.string().min(1)).min(1),
});

const executionConfigSchema = z.object({
  profile: executionProfileSchema.default('aggressive'),
});

const llmConfigSchema = z.object({
  provider: llmProviderNameSchema.default('codex'),
  model: z.string().min(1).default('gpt-5-codex'),
  timeout_ms: z.number().int().positive().default(30_000),
  retry_count: z.number().int().nonnegative().default(1),
  temperature: z.number().min(0).max(1).default(0),
  executable: z.string().min(1).default('codex'),
});

const retentionConfigSchema = z.object({
  keep_latest_artifacts: z.number().int().nonnegative().default(100),
  keep_latest_run_events: z.number().int().nonnegative().default(200),
  keep_latest_memory_entries: z.number().int().nonnegative().default(200),
  max_artifact_age_days: z.number().nonnegative().nullable().default(null),
  max_run_event_age_days: z.number().nonnegative().nullable().default(null),
  max_memory_entry_age_days: z.number().nonnegative().nullable().default(null),
});

const maintenanceConfigSchema = z.object({
  retention: retentionConfigSchema,
  cleanup: z.object({
    dry_run_default: z.boolean().default(false),
    interval_seconds: z.number().int().positive().nullable().default(null),
  }),
});

export const runtimeConfigSchema = z.object({
  mode: runtimeModeSchema.default('project'),
  scope: z.object({
    root: z.string().min(1),
  }),
  workspace: workspaceConfigSchema,
  execution: executionConfigSchema,
  targets: z.array(targetConfigSchema).default([]),
  capabilities: capabilityConfigSchema,
  policies: policyConfigSchema,
  autonomy: z.object({
    mode: autonomyModeSchema.default('supervised'),
  }),
  approvals: approvalConfigSchema,
  schedules: z.array(scheduleConfigSchema).default([]),
  llm: llmConfigSchema,
  http: z.object({
    allowlist: z.array(z.string().min(1)).default(['example.com']),
  }),
  server: z.object({
    host: z.string().min(1).default('127.0.0.1'),
    port: z.number().int().positive().default(4310),
  }),
  worker: z.object({
    poll_interval_ms: z.number().int().positive().default(2000),
  }),
  maintenance: maintenanceConfigSchema,
  limits: limitsSchema,
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

function createDefaultTargets(workspaceRoot: string, mode: z.infer<typeof runtimeModeSchema>) {
  if (mode === 'project') {
    return [
      {
        id: 'local',
        root: workspaceRoot,
        read_paths: ['.'],
        write_paths: ['.'],
        capabilities: [
          'fs.read',
          'fs.write',
          'git.status',
          'git.branch',
          'git.commit',
          'repo.search',
          'repo.test',
          'repo.build',
          'repo.check',
          'repo.patch',
          'http.fetch',
        ],
      },
    ];
  }

  return [
    {
      id: 'example-project',
      root: path.join(workspaceRoot, 'targets', 'example-project'),
      read_paths: ['.'],
      write_paths: ['.'],
      capabilities: [
        'fs.read',
        'fs.write',
        'git.status',
        'git.branch',
        'git.commit',
        'repo.search',
        'repo.test',
        'repo.build',
        'repo.check',
        'repo.patch',
        'http.fetch',
      ],
    },
  ];
}

function mergeUniqueCapabilities(values: readonly z.infer<typeof capabilityNameSchema>[][]): z.infer<typeof capabilityNameSchema>[] {
  const merged = new Set<z.infer<typeof capabilityNameSchema>>();
  for (const group of values) {
    for (const capability of group) {
      merged.add(capability);
    }
  }
  return [...merged];
}

export function buildDefaultConfig(workspaceRoot: string, mode: z.infer<typeof runtimeModeSchema>): RuntimeConfig {
  const defaultTargets = createDefaultTargets(workspaceRoot, mode);
  return runtimeConfigSchema.parse({
    mode,
    scope: { root: workspaceRoot },
    workspace: {
      root: workspaceRoot,
      read_paths: ['.'],
      write_paths: ['.'],
    },
    execution: {
      profile: 'aggressive',
    },
    targets: defaultTargets,
    capabilities: {
      enabled: [
        'fs.read',
        'fs.write',
        'git.status',
        'git.branch',
        'git.commit',
        'repo.search',
        'repo.test',
        'repo.build',
        'repo.check',
        'repo.patch',
        'http.fetch',
      ],
    },
    policies: {
      allow_tools: ['fs.*', 'git.*', 'repo.*', 'http.fetch'],
      deny_patterns: ['rm -rf', 'sudo ', ':/etc/', '\\.ssh'],
      require_approval: {
        tools: ['git.commit', 'shell.exec'],
        capabilities: ['shell.exec'],
      },
    },
    autonomy: { mode: 'supervised' },
    approvals: {
      required_for: {
        tools: ['git.commit', 'shell.exec'],
        capabilities: ['shell.exec'],
      },
    },
    schedules: [],
    llm: {
      provider: 'codex',
      model: 'gpt-5-codex',
      timeout_ms: 30_000,
      retry_count: 1,
      temperature: 0,
      executable: 'codex',
    },
    http: { allowlist: ['example.com'] },
    server: { host: mode === 'system' ? '0.0.0.0' : '127.0.0.1', port: 4310 },
    worker: { poll_interval_ms: 2000 },
    maintenance: {
      retention: {
        keep_latest_artifacts: 100,
        keep_latest_run_events: 200,
        keep_latest_memory_entries: 200,
        max_artifact_age_days: null,
        max_run_event_age_days: null,
        max_memory_entry_age_days: null,
      },
      cleanup: {
        dry_run_default: false,
        interval_seconds: null,
      },
    },
    limits: {
      max_steps: 20,
      max_runtime_sec: 120,
      max_files_changed: 50,
      max_iterations: 3,
    },
  });
}

export function getAgentDirectory(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.agent');
}

export function getConfigPath(workspaceRoot: string): string {
  return path.join(getAgentDirectory(workspaceRoot), 'config.yaml');
}

export function getPoliciesPath(workspaceRoot: string): string {
  return path.join(getAgentDirectory(workspaceRoot), 'POLICIES.md');
}

export function getTargetsDirectory(workspaceRoot: string): string {
  return path.join(getAgentDirectory(workspaceRoot), 'targets');
}

export function ensureAgentDirectories(workspaceRoot: string): {
  agentDir: string;
  artifactsDir: string;
  logsDir: string;
  targetsDir: string;
} {
  const agentDir = getAgentDirectory(workspaceRoot);
  const artifactsDir = path.join(agentDir, 'artifacts');
  const logsDir = path.join(agentDir, 'logs');
  const targetsDir = getTargetsDirectory(workspaceRoot);
  mkdirSync(artifactsDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(targetsDir, { recursive: true });
  return { agentDir, artifactsDir, logsDir, targetsDir };
}

function writeTemplateFiles(workspaceRoot: string, mode: z.infer<typeof runtimeModeSchema>): void {
  const templateRoots = [
    path.resolve(__dirname, '..', '..', 'templates', mode),
    path.resolve(__dirname, '..', '..', '..', 'templates', mode),
  ];
  const templateReadme = templateRoots
    .map((templateRoot) => path.join(templateRoot, 'README.md'))
    .find((candidate) => existsSync(candidate));
  const targetReadme = path.join(getAgentDirectory(workspaceRoot), 'README.md');

  if (templateReadme && !existsSync(targetReadme)) {
    copyFileSync(templateReadme, targetReadme);
  }
}

export function writeDefaultConfig(workspaceRoot: string, mode: z.infer<typeof runtimeModeSchema> = 'project'): string {
  ensureAgentDirectories(workspaceRoot);
  const configPath = getConfigPath(workspaceRoot);
  const config = buildDefaultConfig(workspaceRoot, mode);
  writeFileSync(configPath, YAML.stringify(config), 'utf8');
  writeFileSync(
    getPoliciesPath(workspaceRoot),
    [
      '# FLOW Policies',
      '',
      '- bounded tools first',
      '- shell disabled unless explicitly enabled and approved',
      '- supervised mode is the default',
      '',
    ].join('\n'),
    'utf8',
  );
  writeTemplateFiles(workspaceRoot, mode);
  return configPath;
}

function mergeTargets(
  workspaceRoot: string,
  parsedTargets: unknown,
  mode: z.infer<typeof runtimeModeSchema>,
) {
  const defaultTargets = createDefaultTargets(workspaceRoot, mode);
  if (!Array.isArray(parsedTargets) || parsedTargets.length === 0) {
    return defaultTargets;
  }

  const parsedTargetList = z.array(targetConfigSchema).parse(parsedTargets);
  const defaultTargetsById = new Map(defaultTargets.map((target) => [target.id, target]));

  return parsedTargetList.map((target) => {
    const defaultTarget = defaultTargetsById.get(target.id);
    if (!defaultTarget) {
      return target;
    }

    return {
      ...target,
      capabilities: mergeUniqueCapabilities([defaultTarget.capabilities, target.capabilities]),
    };
  });
}

export function loadConfig(workspaceRoot: string, configPath = getConfigPath(workspaceRoot)): RuntimeConfig {
  dotenv.config({ path: path.join(workspaceRoot, '.env') });
  ensureAgentDirectories(workspaceRoot);

  if (!existsSync(configPath)) {
    writeDefaultConfig(workspaceRoot);
  }

  const rawConfig = readFileSync(configPath, 'utf8');
  const parsedDocument = YAML.parse(rawConfig);
  const parsed = parsedDocument && typeof parsedDocument === 'object' ? parsedDocument : {};
  const rawMode = typeof parsed.mode === 'string' ? parsed.mode : 'project';
  const mode = runtimeModeSchema.parse(rawMode);
  const defaults = buildDefaultConfig(workspaceRoot, mode);

  const merged = {
    ...defaults,
    ...parsed,
    scope: {
      ...defaults.scope,
      ...(parsed && typeof parsed === 'object' && 'scope' in parsed ? parsed.scope : {}),
      root: workspaceRoot,
    },
    workspace: {
      ...defaults.workspace,
      ...(parsed && typeof parsed === 'object' && 'workspace' in parsed ? parsed.workspace : {}),
      root: workspaceRoot,
    },
    execution: {
      ...defaults.execution,
      ...(parsed && typeof parsed === 'object' && 'execution' in parsed ? parsed.execution : {}),
    },
    targets: mergeTargets(workspaceRoot, parsed && typeof parsed === 'object' && 'targets' in parsed ? parsed.targets : [], mode),
    capabilities: {
      ...defaults.capabilities,
      ...(parsed && typeof parsed === 'object' && 'capabilities' in parsed ? parsed.capabilities : {}),
      enabled: mergeUniqueCapabilities([
        defaults.capabilities.enabled,
        z.array(capabilityNameSchema).parse(
          parsed && typeof parsed === 'object' && 'capabilities' in parsed && parsed.capabilities && typeof parsed.capabilities === 'object' && 'enabled' in parsed.capabilities
            ? parsed.capabilities.enabled
            : [],
        ),
      ]),
    },
    policies: {
      ...defaults.policies,
      ...(parsed && typeof parsed === 'object' && 'policies' in parsed ? parsed.policies : {}),
      require_approval: {
        ...defaults.policies.require_approval,
        ...(parsed && typeof parsed === 'object' && 'policies' in parsed && parsed.policies && typeof parsed.policies === 'object' && 'require_approval' in parsed.policies
          ? parsed.policies.require_approval
          : {}),
      },
    },
    autonomy: {
      ...defaults.autonomy,
      ...(parsed && typeof parsed === 'object' && 'autonomy' in parsed ? parsed.autonomy : {}),
    },
    approvals: {
      ...defaults.approvals,
      ...(parsed && typeof parsed === 'object' && 'approvals' in parsed ? parsed.approvals : {}),
      required_for: {
        ...defaults.approvals.required_for,
        ...(parsed && typeof parsed === 'object' && 'approvals' in parsed && parsed.approvals && typeof parsed.approvals === 'object' && 'required_for' in parsed.approvals
          ? parsed.approvals.required_for
          : {}),
      },
    },
    schedules: Array.isArray(parsed && typeof parsed === 'object' && 'schedules' in parsed ? parsed.schedules : undefined)
      ? parsed.schedules
      : defaults.schedules,
    llm: {
      ...defaults.llm,
      ...(parsed && typeof parsed === 'object' && 'llm' in parsed ? parsed.llm : {}),
    },
    http: {
      ...defaults.http,
      ...(parsed && typeof parsed === 'object' && 'http' in parsed ? parsed.http : {}),
    },
    server: {
      ...defaults.server,
      ...(parsed && typeof parsed === 'object' && 'server' in parsed ? parsed.server : {}),
    },
    worker: {
      ...defaults.worker,
      ...(parsed && typeof parsed === 'object' && 'worker' in parsed ? parsed.worker : {}),
    },
    maintenance: {
      ...defaults.maintenance,
      ...(parsed && typeof parsed === 'object' && 'maintenance' in parsed ? parsed.maintenance : {}),
      retention: {
        ...defaults.maintenance.retention,
        ...(parsed &&
        typeof parsed === 'object' &&
        'maintenance' in parsed &&
        parsed.maintenance &&
        typeof parsed.maintenance === 'object' &&
        'retention' in parsed.maintenance
          ? parsed.maintenance.retention
          : {}),
      },
      cleanup: {
        ...defaults.maintenance.cleanup,
        ...(parsed &&
        typeof parsed === 'object' &&
        'maintenance' in parsed &&
        parsed.maintenance &&
        typeof parsed.maintenance === 'object' &&
        'cleanup' in parsed.maintenance
          ? parsed.maintenance.cleanup
          : {}),
      },
    },
    limits: {
      ...defaults.limits,
      ...(parsed && typeof parsed === 'object' && 'limits' in parsed ? parsed.limits : {}),
    },
  };

  return runtimeConfigSchema.parse(merged);
}
