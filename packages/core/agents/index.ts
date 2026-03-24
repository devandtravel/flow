import path from 'node:path';
import { z } from 'zod';
import type { CriticReview, ExecutionProfile, FileSnapshotMemory, MemorySummary, TaskPlan, ToolStep } from '../../domain';
import { evaluationSchema, supervisorDecisionSchema } from '../../domain';
import { CancelledError } from '../../errors';
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
import { getContextualStepSemanticValidationError } from './contextual-step-validation';
import type { StepValidationContext } from './contextual-step-validation';
import { getStepSemanticValidationError } from './step-validation';

function describeFailures(failures: string[]): string {
  if (failures.length === 0) {
    return 'unknown failure';
  }

  return failures.join('; ');
}

function createFallbackSupervisorDecision(input: {
  iteration: number;
  maxIterations: number;
  failures: string[];
}): z.infer<typeof supervisorDecisionSchema> {
  if (input.iteration >= input.maxIterations) {
    return supervisorDecisionSchema.parse({
      decision: 'escalate',
      reason: `Maximum iterations reached with failures: ${describeFailures(input.failures)}.`,
    });
  }

  return supervisorDecisionSchema.parse({
    decision: 'replan',
    reason: `Structured supervisor response was unavailable. Replanning after failure: ${describeFailures(input.failures)}.`,
  });
}

function isAggressiveDeterministicPlan(
  plan: TaskPlan,
  context: StepValidationContext,
): boolean {
  const snapshotPaths = new Set(context.exactFileSnapshots.map((snapshot) => snapshot.path));

  return plan.steps.every((step) => {
    if (step.tool === 'repo.apply_patch') {
      return false;
    }

    if (step.tool !== 'fs.write_file') {
      return true;
    }

    const targetPath = step.input['path'];
    return typeof targetPath === 'string' && snapshotPaths.has(targetPath);
  });
}

function hasExpectedBoolean(step: ToolStep, key: string): boolean | undefined {
  const value = step.expected[key];
  return typeof value === 'boolean' ? value : undefined;
}

function hasExpectedString(step: ToolStep, key: string): string | undefined {
  const value = step.expected[key];
  return typeof value === 'string' ? value : undefined;
}

function matchesExpectedPath(actualPath: string, expectedPath: string): boolean {
  const normalizedActualPath = path.normalize(actualPath);
  const normalizedExpectedPath = path.normalize(expectedPath);
  return (
    normalizedActualPath === normalizedExpectedPath ||
    normalizedActualPath.endsWith(`${path.sep}${normalizedExpectedPath}`)
  );
}

function getRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null);
}

function verifyDiscoveryExpectation(step: ToolStep, result: ToolResult): string | undefined {
  if (step.tool === 'fs.read_file') {
    const expectedPath = hasExpectedString(step, 'path');
    if (expectedPath !== undefined) {
      const actualPath = result.output['path'];
      if (typeof actualPath !== 'string' || !matchesExpectedPath(actualPath, expectedPath)) {
        return `Expected fs.read_file to read ${expectedPath}.`;
      }
    }

    const expectedContent = hasExpectedString(step, 'content_includes');
    if (expectedContent !== undefined) {
      const actualContent = result.output['content'];
      if (typeof actualContent !== 'string' || !actualContent.includes(expectedContent)) {
        return `Expected fs.read_file content to include "${expectedContent}".`;
      }
    }
  }

  if (step.tool === 'fs.list_dir') {
    const expectedEntry = hasExpectedString(step, 'entries_include');
    if (expectedEntry !== undefined) {
      const entries = getRecordArray(result.output['entries']);
      const hasEntry = entries.some((entry) => entry['name'] === expectedEntry);
      if (!hasEntry) {
        return `Expected fs.list_dir entries to include "${expectedEntry}".`;
      }
    }
  }

  if (step.tool === 'repo.search_text' || step.tool === 'repo.symbol_search') {
    const expectedMatchesFound = hasExpectedBoolean(step, 'matches_found');
    const matchCount = result.output['match_count'];
    if (expectedMatchesFound === true && (typeof matchCount !== 'number' || matchCount <= 0)) {
      return `Expected ${step.tool} to return at least one match.`;
    }

    const expectedFirstPath = hasExpectedString(step, 'first_path');
    if (expectedFirstPath !== undefined) {
      const matches = getRecordArray(result.output['matches']);
      const firstPath = matches[0]?.['path'];
      if (typeof firstPath !== 'string' || !matchesExpectedPath(firstPath, expectedFirstPath)) {
        return `Expected ${step.tool} first path to match ${expectedFirstPath}.`;
      }
    }
  }

  if (step.tool === 'repo.search_files') {
    const expectedFilesFound = hasExpectedBoolean(step, 'matches_found');
    const fileCount = result.output['file_count'];
    if (expectedFilesFound === true && (typeof fileCount !== 'number' || fileCount <= 0)) {
      return 'Expected repo.search_files to return at least one file path.';
    }
  }

  if (step.tool === 'git.status') {
    const expectedHasModified = hasExpectedBoolean(step, 'has_modified');
    if (expectedHasModified !== undefined) {
      const stdout = result.output['stdout'];
      const hasModified = typeof stdout === 'string' && stdout.trim().length > 0;
      if (expectedHasModified !== hasModified) {
        return `Expected git.status has_modified to be ${String(expectedHasModified)}.`;
      }
    }
  }

  return undefined;
}

export class PlannerAgent {
  constructor(private readonly provider: LlmProvider) {}

  async generate(input: {
    goal: string;
    memory: MemorySummary;
    tools: ToolDefinition[];
    extraContext: string;
    exactFileSnapshots: FileSnapshotMemory[];
    executionProfile: ExecutionProfile;
    signal?: AbortSignal;
  }): Promise<TaskPlan> {
    const response = await this.provider.complete({
      prompt: buildPlanningPrompt(
        input.goal,
        input.memory,
        input.tools,
        input.extraContext,
        input.exactFileSnapshots,
        input.executionProfile,
      ),
      schema: taskPlanResponseSchema,
      contract: 'task_plan',
      signal: input.signal,
    });
    return decodeTaskPlanResponse(response);
  }
}

export class CriticAgent {
  constructor(private readonly provider: LlmProvider) {}

  async validate(
    plan: TaskPlan,
    availableTools: ToolDefinition[],
    context: StepValidationContext,
    executionProfile: ExecutionProfile,
    signal?: AbortSignal,
  ): Promise<CriticReview> {
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

    const invalidContextualSemanticStep = plan.steps.find(
      (step) => getContextualStepSemanticValidationError(step, context) !== undefined,
    );
    if (invalidContextualSemanticStep) {
      return decodeCriticReviewResponse(
        encodeCriticReviewResponse({
          valid: false,
          feedback: [
            `Invalid contextual content for tool ${invalidContextualSemanticStep.tool}: ${
              getContextualStepSemanticValidationError(invalidContextualSemanticStep, context) ?? 'Invalid content.'
            }`,
          ],
          plan,
        }),
      );
    }

    if (executionProfile === 'aggressive' && isAggressiveDeterministicPlan(plan, context)) {
      return decodeCriticReviewResponse(
        encodeCriticReviewResponse({
          valid: true,
          feedback: [],
          plan,
        }),
      );
    }

    const response = await this.provider.complete({
      prompt: buildCriticPrompt(plan, availableTools, context.exactFileSnapshots, executionProfile),
      schema: criticReviewResponseSchema,
      contract: 'critic_review',
      signal,
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

    const semanticValidationError = getStepSemanticValidationError(step);
    if (semanticValidationError !== undefined) {
      return {
        verified: false,
        evidence: `Invalid semantic content for tool ${step.tool}: ${semanticValidationError}`,
      };
    }

    const discoveryExpectationError = verifyDiscoveryExpectation(step, result);
    if (discoveryExpectationError !== undefined) {
      return {
        verified: false,
        evidence: discoveryExpectationError,
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

  async decide(
    input: {
      hadFailure: boolean;
      iteration: number;
      maxIterations: number;
      failures: string[];
    },
    signal?: AbortSignal,
  ): Promise<z.infer<typeof supervisorDecisionSchema>> {
    if (!input.hadFailure) {
      return supervisorDecisionSchema.parse({
        decision: 'stop',
        reason: 'Execution succeeded.',
      });
    }

    if (input.iteration >= input.maxIterations) {
      return createFallbackSupervisorDecision(input);
    }

    try {
      return await this.provider.complete({
        prompt: buildSupervisorPrompt({
          hadFailure: input.hadFailure,
          iteration: input.iteration,
          maxIterations: input.maxIterations,
          failures: input.failures,
        }),
        schema: supervisorDecisionSchema,
        contract: 'supervisor_decision',
        signal,
      });
    } catch (error) {
      if (error instanceof CancelledError) {
        throw error;
      }
      return createFallbackSupervisorDecision(input);
    }
  }
}

export class EvaluatorAgent {
  constructor(private readonly provider: LlmProvider) {}

  async evaluate(
    input: { totalSteps: number; verifiedSteps: number; failures: string[] },
    signal?: AbortSignal,
  ): Promise<z.infer<typeof evaluationSchema>> {
    return this.provider.complete({
      prompt: buildEvaluatorPrompt({
        totalSteps: input.totalSteps,
        verifiedSteps: input.verifiedSteps,
        failures: input.failures,
      }),
      schema: evaluationSchema,
      contract: 'evaluation',
      signal,
    });
  }
}
