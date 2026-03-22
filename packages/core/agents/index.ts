import { z } from 'zod';

export const planSchema = z.object({
  goal: z.string(),
  steps: z.array(
    z.object({
      tool: z.string(),
      input: z.record(z.any()),
      expected: z.record(z.any()),
    }),
  ),
  done: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export type Plan = z.infer<typeof planSchema>;

export class PlannerAgent {
  generate(input: { goal: string; state: string; memory: { episodic: unknown[]; procedural: unknown[]; failure: unknown[] } }): Plan {
    const steps: Plan['steps'] = [{ tool: 'fs.list_dir', input: { path: '.' }, expected: { success: true } }];

    const urlMatch = input.goal.match(/https?:\/\/\S+/i);
    if (urlMatch) {
      steps.push({ tool: 'http.fetch', input: { url: urlMatch[0] }, expected: { success: true } });
    } else if (/\bgit status\b/i.test(input.goal)) {
      steps.push({ tool: 'git.status', input: {}, expected: { success: true } });
    } else if (/\b(run|execute) tests?\b/i.test(input.goal)) {
      steps.push({ tool: 'repo.run_tests', input: {}, expected: { success: true } });
    }

    return planSchema.parse({
      goal: input.goal,
      steps,
      done: false,
      confidence: input.memory.failure.length > 0 ? 0.65 : 0.8,
    });
  }
}

export class CriticAgent {
  validate(plan: unknown, availableTools: string[]): { valid: boolean; reason?: string; plan?: Plan } {
    const parsed = planSchema.safeParse(plan);
    if (!parsed.success) {
      return { valid: false, reason: parsed.error.message };
    }

    if (parsed.data.steps.length === 0) {
      return { valid: false, reason: 'Plan must include at least one step.' };
    }

    const unknownTool = parsed.data.steps.find((step) => !availableTools.includes(step.tool));
    if (unknownTool) {
      return { valid: false, reason: `Unknown tool in plan: ${unknownTool.tool}` };
    }

    return { valid: true, plan: parsed.data };
  }
}

export class ExecutorAgent {
  async run(step: Plan['steps'][number], execute: (tool: string, input: unknown) => Promise<unknown>): Promise<unknown> {
    return execute(step.tool, step.input);
  }
}

export class VerifierAgent {
  check(step: Plan['steps'][number], result: { success: boolean; data?: Record<string, unknown>; error?: string }): { verified: boolean; evidence: string } {
    if (!result.success) {
      return { verified: false, evidence: result.error ?? 'Tool execution failed.' };
    }

    if ('success' in step.expected && step.expected.success !== result.success) {
      return { verified: false, evidence: 'Success flag did not match expectation.' };
    }

    return { verified: true, evidence: `Tool ${step.tool} produced a successful result.` };
  }
}

export class SupervisorAgent {
  decide(input: { hadFailure: boolean; iteration: number; maxIterations: number }): 'continue' | 'retry' | 'escalate' | 'stop' {
    if (!input.hadFailure) {
      return 'stop';
    }

    return input.iteration < input.maxIterations ? 'retry' : 'escalate';
  }
}

export class EvaluatorAgent {
  evaluate(input: { totalSteps: number; verifiedSteps: number; failures: string[] }): { score: number; issues: string[]; suggestions: string[] } {
    const score = input.totalSteps === 0 ? 0 : input.verifiedSteps / input.totalSteps;
    return {
      score,
      issues: input.failures,
      suggestions: input.failures.length > 0 ? ['Review failed steps and tighten policy or planner expectations.'] : ['Reuse the successful procedural memory for similar tasks.'],
    };
  }
}
