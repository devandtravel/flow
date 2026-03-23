import { z } from 'zod';
import type { CriticReview, MemorySummary, TaskPlan, ToolStep } from '../../domain';
import { evaluationSchema, supervisorDecisionSchema } from '../../domain';
import type { LlmProvider } from '../../llm';
import {
  buildCriticPrompt,
  buildEvaluatorPrompt,
  buildPlanningPrompt,
  buildSupervisorPrompt,
  criticReviewResponseSchema,
  encodeCriticReviewResponse,
  decodeCriticReviewResponse,
  decodeTaskPlanResponse,
  taskPlanResponseSchema,
} from '../../llm/contracts';
import type { ToolDefinition, ToolResult } from '../../tools';
import { getStepSemanticValidationError } from './step-validation';

function describeFailures(failures: string[]): string {
  if (failures.length === 0) {
    return 'unknown failure';
  }

  return failures.join('; ');
}

export class PlannerAgent {
  constructor(private readonly provider: LlmProvider) {}

  async generate(input: { goal: string; memory: MemorySummary; tools: ToolDefinition[]; extraContext: string }): Promise<TaskPlan> {
    const response = await this.provider.complete({
      prompt: buildPlanningPrompt(input.goal, input.memory, input.tools, input.extraContext),
      schema: taskPlanResponseSchema,
      contract: 'task_plan',
    });
    return decodeTaskPlanResponse(response);
  }
}

export class CriticAgent {
  constructor(private readonly provider: LlmProvider) {}

  async validate(plan: TaskPlan, availableTools: ToolDefinition[]): Promise<CriticReview> {
    const unknownTool = plan.steps.find((step) => availableTools.every((tool) => tool.name !== step.tool));
    if (unknownTool) {
      return decodeCriticReviewResponse(
        encodeCriticReviewResponse({
        valid: false,
        feedback: [`Unknown tool in plan: ${unknownTool.tool}`],
          plan,
        }),
      );
    }

    const invalidInputStep = plan.steps.find((step) => {
      const tool = availableTools.find((availableTool) => availableTool.name === step.tool);
      if (!tool) {
        return false;
      }

      return !tool.inputSchema.safeParse(step.input).success;
    });
    if (invalidInputStep) {
      const tool = availableTools.find((availableTool) => availableTool.name === invalidInputStep.tool);
      const validation = tool ? tool.inputSchema.safeParse(invalidInputStep.input) : null;
      const validationMessage =
        validation && !validation.success
          ? validation.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ')
          : 'Invalid tool input.';
      return decodeCriticReviewResponse(
        encodeCriticReviewResponse({
          valid: false,
          feedback: [`Invalid input for tool ${invalidInputStep.tool}: ${validationMessage}`],
          plan,
        }),
      );
    }

    const invalidSemanticStep = plan.steps.find((step) => getStepSemanticValidationError(step) !== undefined);
    if (invalidSemanticStep) {
      return decodeCriticReviewResponse(
        encodeCriticReviewResponse({
          valid: false,
          feedback: [
            `Invalid semantic content for tool ${invalidSemanticStep.tool}: ${getStepSemanticValidationError(invalidSemanticStep) ?? 'Invalid content.'}`,
          ],
          plan,
        }),
      );
    }

    const response = await this.provider.complete({
      prompt: buildCriticPrompt(plan, availableTools),
      schema: criticReviewResponseSchema,
      contract: 'critic_review',
    });
    return decodeCriticReviewResponse(response);
  }
}

export class ExecutorAgent {
  async run(
    step: ToolStep,
    execute: (toolName: string, input: Record<string, unknown>) => Promise<ToolResult>,
  ): Promise<ToolResult> {
    return execute(step.tool, step.input);
  }
}

export class VerifierAgent {
  check(step: ToolStep, result: ToolResult): { verified: boolean; evidence: string } {
    if (!result.success) {
      return {
        verified: false,
        evidence: result.error,
      };
    }

    if ('changed' in step.expected && step.expected.changed === true && result.changedFiles.length === 0) {
      return {
        verified: false,
        evidence: `Step ${step.tool} expected changed files, but no file changes were reported.`,
      };
    }

    if (step.tool === 'fs.write_file' && result.changedFiles.length === 0) {
      return {
        verified: false,
        evidence: `Step ${step.tool} did not report a file write.`,
      };
    }

    if (step.tool === 'http.fetch') {
      const status = result.output.status;
      if (typeof status !== 'number' || status >= 400) {
        return {
          verified: false,
          evidence: `HTTP fetch for ${step.tool} did not return a successful status.`,
        };
      }
    }

    if (step.tool === 'repo.apply_patch' && result.changedFiles.length === 0) {
      return {
        verified: false,
        evidence: 'Patch application reported success but no changed files were detected.',
      };
    }

    if (step.tool === 'repo.run_tests' || step.tool === 'repo.build' || step.tool === 'repo.run_checks') {
      const status = result.output.status;
      if (typeof status !== 'number' || status !== 0) {
        return {
          verified: false,
          evidence: `${step.tool} finished without a zero exit status.`,
        };
      }
    }

    if (step.tool === 'git.commit') {
      const commitMessage = result.output.commit_message;
      if (typeof commitMessage !== 'string' || commitMessage.length === 0) {
        return {
          verified: false,
          evidence: 'git.commit did not report the persisted commit message.',
        };
      }
    }

    return {
      verified: true,
      evidence: result.evidence.summary,
    };
  }
}

export class SupervisorAgent {
  constructor(private readonly provider: LlmProvider) {}

  async decide(input: {
    hadFailure: boolean;
    iteration: number;
    maxIterations: number;
    failures: string[];
  }): Promise<z.infer<typeof supervisorDecisionSchema>> {
    if (!input.hadFailure) {
      return supervisorDecisionSchema.parse({
        decision: 'stop',
        reason: 'Execution succeeded.',
      });
    }

    if (input.iteration >= input.maxIterations) {
      return supervisorDecisionSchema.parse({
        decision: 'escalate',
        reason: `Maximum iterations reached with failures: ${describeFailures(input.failures)}.`,
      });
    }

    return this.provider.complete({
      prompt: buildSupervisorPrompt({
        hadFailure: input.hadFailure,
        iteration: input.iteration,
        maxIterations: input.maxIterations,
        failures: input.failures,
      }),
      schema: supervisorDecisionSchema,
      contract: 'supervisor_decision',
    });
  }
}

export class EvaluatorAgent {
  constructor(private readonly provider: LlmProvider) {}

  async evaluate(input: { totalSteps: number; verifiedSteps: number; failures: string[] }): Promise<z.infer<typeof evaluationSchema>> {
    return this.provider.complete({
      prompt: buildEvaluatorPrompt({
        totalSteps: input.totalSteps,
        verifiedSteps: input.verifiedSteps,
        failures: input.failures,
      }),
      schema: evaluationSchema,
      contract: 'evaluation',
    });
  }
}
