import { z } from 'zod';

export const policyConfigSchema = z.object({
  allow: z.array(z.string()).default(['git.*', 'fs.*', 'repo.*', 'http.fetch']),
  deny: z.array(z.object({ pattern: z.string() })).default([]),
  require_approval: z.array(z.object({ tool: z.string() })).default([]),
  limits: z.object({
    max_steps: z.number().int().positive().default(20),
    max_runtime_sec: z.number().int().positive().default(120),
    max_files_changed: z.number().int().positive().default(50),
    max_iterations: z.number().int().positive().default(3),
  }).default({}),
});

export type PolicyConfig = z.infer<typeof policyConfigSchema>;

export interface PolicyContext {
  startedAt: number;
  completedSteps: number;
  changedFiles: number;
  iteration: number;
}

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export class PolicyEngine {
  readonly config: PolicyConfig;

  constructor(config: Partial<PolicyConfig> = {}) {
    this.config = policyConfigSchema.parse(config);
  }

  evaluateStep(step: { tool: string; input: unknown }, context: PolicyContext): PolicyDecision {
    const serializedInput = JSON.stringify(step.input ?? null);
    const isAllowed = this.config.allow.some((pattern) => wildcardToRegExp(pattern).test(step.tool));
    if (!isAllowed) {
      return { allowed: false, requiresApproval: false, reason: `Tool ${step.tool} is not allowlisted.` };
    }

    for (const denied of this.config.deny) {
      if (new RegExp(denied.pattern, 'i').test(serializedInput)) {
        return { allowed: false, requiresApproval: false, reason: `Input matched denied pattern ${denied.pattern}.` };
      }
    }

    if (this.config.require_approval.some((rule) => wildcardToRegExp(rule.tool).test(step.tool))) {
      return { allowed: false, requiresApproval: true, reason: `Tool ${step.tool} requires approval.` };
    }

    if (context.completedSteps >= this.config.limits.max_steps) {
      return { allowed: false, requiresApproval: false, reason: 'Maximum step limit exceeded.' };
    }

    if ((Date.now() - context.startedAt) / 1000 > this.config.limits.max_runtime_sec) {
      return { allowed: false, requiresApproval: false, reason: 'Maximum runtime exceeded.' };
    }

    if (context.changedFiles > this.config.limits.max_files_changed) {
      return { allowed: false, requiresApproval: false, reason: 'Maximum changed files exceeded.' };
    }

    if (context.iteration > this.config.limits.max_iterations) {
      return { allowed: false, requiresApproval: false, reason: 'Maximum iterations exceeded.' };
    }

    return { allowed: true, requiresApproval: false };
  }
}
