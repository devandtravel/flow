import type { MemorySummary, TaskPlan } from '../domain';
import type { ToolDefinition } from '../tools';
import type { LlmContract } from './index';

export const promptContractVersion = 'v1';

function sanitizeToolCatalog(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    capability: tool.capability,
    sideEffectClass: tool.sideEffectClass,
    reversibility: tool.reversibility,
    approvalClass: tool.approvalClass,
  }));
}

export function createJsonSchema(contract: LlmContract): Record<string, unknown> {
  if (contract === 'task_plan') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['goal', 'assumptions', 'risks', 'steps', 'done', 'confidence'],
      properties: {
        goal: { type: 'string' },
        assumptions: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
        steps: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['tool', 'input', 'expected', 'rationale'],
            properties: {
              tool: { type: 'string' },
              input: { type: 'object', additionalProperties: true },
              expected: { type: 'object', additionalProperties: true },
              rationale: { type: 'string' },
            },
          },
        },
        done: { type: 'boolean' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    };
  }

  if (contract === 'critic_review') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['valid', 'feedback', 'plan'],
      properties: {
        valid: { type: 'boolean' },
        feedback: { type: 'array', items: { type: 'string' } },
        plan: createJsonSchema('task_plan'),
      },
    };
  }

  if (contract === 'supervisor_decision') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['decision', 'reason'],
      properties: {
        decision: {
          type: 'string',
          enum: ['continue', 'retry_same_step', 'replan', 'escalate', 'stop'],
        },
        reason: { type: 'string' },
      },
    };
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['score', 'issues', 'suggestions'],
    properties: {
      score: { type: 'number', minimum: 0, maximum: 1 },
      issues: { type: 'array', items: { type: 'string' } },
      suggestions: { type: 'array', items: { type: 'string' } },
    },
  };
}

export function buildPlanningPrompt(goal: string, memory: MemorySummary, tools: ToolDefinition[], extraContext: string): string {
  return [
    `FLOW Contract Version: ${promptContractVersion}`,
    'You are FLOW planner.',
    'Return JSON only.',
    '',
    `Goal: ${goal}`,
    `ExtraContext: ${extraContext}`,
    `Memory: ${JSON.stringify(memory)}`,
    `Tools: ${JSON.stringify(sanitizeToolCatalog(tools))}`,
    '',
    'Requirements:',
    '- choose bounded tools only',
    '- keep steps small and verifiable',
    '- prefer reversible actions',
    '- provide rationale for every step',
  ].join('\n');
}

export function buildCriticPrompt(plan: TaskPlan, tools: ToolDefinition[]): string {
  return [
    `FLOW Contract Version: ${promptContractVersion}`,
    'You are FLOW critic.',
    'Return JSON only.',
    `Plan: ${JSON.stringify(plan)}`,
    `AvailableTools: ${JSON.stringify(sanitizeToolCatalog(tools))}`,
    'If the plan is invalid, preserve it and explain the problem in feedback.',
  ].join('\n');
}

export function buildSupervisorPrompt(input: {
  hadFailure: boolean;
  iteration: number;
  maxIterations: number;
  failures: string[];
}): string {
  return [
    `FLOW Contract Version: ${promptContractVersion}`,
    'You are FLOW supervisor.',
    'Return JSON only.',
    `HadFailure: ${String(input.hadFailure)}`,
    `Iteration: ${String(input.iteration)}`,
    `MaxIterations: ${String(input.maxIterations)}`,
    `Failures: ${input.failures.length === 0 ? 'none' : input.failures.join('; ')}`,
    'Prefer retry_same_step only when the failure looks transient.',
  ].join('\n');
}

export function buildEvaluatorPrompt(input: {
  totalSteps: number;
  verifiedSteps: number;
  failures: string[];
}): string {
  const suggestedScore = input.totalSteps === 0 ? 0 : input.verifiedSteps / input.totalSteps;
  return [
    `FLOW Contract Version: ${promptContractVersion}`,
    'You are FLOW evaluator.',
    'Return JSON only.',
    `TotalSteps: ${String(input.totalSteps)}`,
    `VerifiedSteps: ${String(input.verifiedSteps)}`,
    `Failures: ${input.failures.length === 0 ? 'none' : input.failures.join('; ')}`,
    `SuggestedScore: ${String(suggestedScore)}`,
  ].join('\n');
}
