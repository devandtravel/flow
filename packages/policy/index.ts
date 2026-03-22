import path from 'node:path';
import { z } from 'zod';
import { capabilityNameSchema } from '../domain';

export const policyConfigSchema = z.object({
  allow_tools: z.array(z.string()).min(1),
  deny_patterns: z.array(z.string()).default([]),
  require_approval: z.object({
    tools: z.array(z.string()).default([]),
    capabilities: z.array(capabilityNameSchema).default([]),
  }),
  limits: z.object({
    max_steps: z.number().int().positive(),
    max_runtime_sec: z.number().int().positive(),
    max_files_changed: z.number().int().positive(),
    max_iterations: z.number().int().positive(),
  }),
  autonomy: z.object({
    mode: z.enum(['supervised', 'autonomous']),
  }),
  workspace: z.object({
    root: z.string().min(1),
    read_paths: z.array(z.string().min(1)).min(1),
    write_paths: z.array(z.string().min(1)).min(1),
  }),
});

export type PolicyConfig = z.infer<typeof policyConfigSchema>;

export interface PolicyContext {
  startedAt: number;
  completedSteps: number;
  changedFiles: number;
  iteration: number;
}

export interface StepPolicyInput {
  tool: string;
  capability: z.infer<typeof capabilityNameSchema>;
  input: Record<string, unknown>;
}

export interface PolicyDecision {
  kind: 'allow' | 'require_approval' | 'deny';
  reason: string;
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function normalizePattern(pattern: string): string {
  if (pattern === '.' || pattern === './') {
    return '';
  }

  return pattern.replace(/^\.\//, '').replace(/\/\*\*$/, '').replace(/\/$/, '');
}

function withinAllowedPath(root: string, allowedPatterns: string[], candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return false;
  }

  return allowedPatterns.some((pattern) => {
    const normalized = normalizePattern(pattern);
    return normalized === '' || relative === normalized || relative.startsWith(`${normalized}${path.sep}`);
  });
}

export class PolicyEngine {
  readonly config: PolicyConfig;

  constructor(config: PolicyConfig) {
    this.config = policyConfigSchema.parse(config);
  }

  evaluateStep(step: StepPolicyInput, context: PolicyContext): PolicyDecision {
    const serializedInput = JSON.stringify(step.input);
    const isAllowedTool = this.config.allow_tools.some((pattern) => wildcardToRegExp(pattern).test(step.tool));
    if (!isAllowedTool) {
      return { kind: 'deny', reason: `Tool ${step.tool} is not allowlisted.` };
    }

    for (const deniedPattern of this.config.deny_patterns) {
      if (new RegExp(deniedPattern, 'i').test(serializedInput)) {
        return { kind: 'deny', reason: `Input matched denied pattern ${deniedPattern}.` };
      }
    }

    if (context.completedSteps >= this.config.limits.max_steps) {
      return { kind: 'deny', reason: 'Maximum step limit exceeded.' };
    }

    if ((Date.now() - context.startedAt) / 1000 > this.config.limits.max_runtime_sec) {
      return { kind: 'deny', reason: 'Maximum runtime exceeded.' };
    }

    if (context.changedFiles > this.config.limits.max_files_changed) {
      return { kind: 'deny', reason: 'Maximum changed files exceeded.' };
    }

    if (context.iteration > this.config.limits.max_iterations) {
      return { kind: 'deny', reason: 'Maximum iterations exceeded.' };
    }

    const approvalRequiredByTool = this.config.require_approval.tools.some((pattern) => wildcardToRegExp(pattern).test(step.tool));
    const approvalRequiredByCapability = this.config.require_approval.capabilities.includes(step.capability);
    if (approvalRequiredByTool || approvalRequiredByCapability) {
      return { kind: 'require_approval', reason: `Step ${step.tool} requires approval.` };
    }

    if (this.config.autonomy.mode === 'supervised' && step.capability === 'git.commit') {
      return { kind: 'require_approval', reason: `Capability ${step.capability} requires approval in supervised mode.` };
    }

    return { kind: 'allow', reason: 'Policy check passed.' };
  }

  canRead(candidate: string): boolean {
    return withinAllowedPath(this.config.workspace.root, this.config.workspace.read_paths, candidate);
  }

  canWrite(candidate: string): boolean {
    return withinAllowedPath(this.config.workspace.root, this.config.workspace.write_paths, candidate);
  }
}
