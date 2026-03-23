import { z } from 'zod';
import {
  criticReviewSchema,
  type CriticReview,
  type FileSnapshotMemory,
  type MemorySummary,
  type TaskPlan,
  taskPlanSchema,
} from '../domain';
import type { ToolDefinition } from '../tools';
import type { LlmContract } from './index';

export const promptContractVersion = 'v1';

function isValidJsonObjectString(value: string): boolean {
  try {
    parseJsonObjectString(value);
    return true;
  } catch {
    return false;
  }
}

const jsonObjectStringSchema = z.string().min(2).refine(isValidJsonObjectString, {
  message: 'Expected a valid JSON object string.',
});

export const toolStepResponseSchema = z.object({
  tool: z.string().min(1),
  input_json: jsonObjectStringSchema,
  expected_json: jsonObjectStringSchema,
  rationale: z.string().min(1),
});
export type ToolStepResponse = z.infer<typeof toolStepResponseSchema>;

export const taskPlanResponseSchema = z.object({
  goal: z.string().min(1),
  assumptions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  steps: z.array(toolStepResponseSchema).min(1),
  done: z.boolean(),
  confidence: z.number().min(0).max(1),
});
export type TaskPlanResponse = z.infer<typeof taskPlanResponseSchema>;

export const criticReviewResponseSchema = z.object({
  valid: z.boolean(),
  feedback: z.array(z.string()).default([]),
  plan: taskPlanResponseSchema,
});
export type CriticReviewResponse = z.infer<typeof criticReviewResponseSchema>;

function sanitizeToolCatalog(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    sideEffectClass: tool.sideEffectClass,
    approvalClass: tool.approvalClass,
    inputKeys: Object.keys(tool.inputContract),
  }));
}

function parseJsonObjectString(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  return z.record(z.string(), z.unknown()).parse(parsed);
}

function stringifyJsonObject(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

export function encodeTaskPlanResponse(plan: TaskPlan): TaskPlanResponse {
  return taskPlanResponseSchema.parse({
    goal: plan.goal,
    assumptions: plan.assumptions,
    risks: plan.risks,
    steps: plan.steps.map((step) => ({
      tool: step.tool,
      input_json: stringifyJsonObject(step.input),
      expected_json: stringifyJsonObject(step.expected),
      rationale: step.rationale,
    })),
    done: plan.done,
    confidence: plan.confidence,
  });
}

export function decodeTaskPlanResponse(response: TaskPlanResponse): TaskPlan {
  return taskPlanSchema.parse({
    goal: response.goal,
    assumptions: response.assumptions,
    risks: response.risks,
    steps: response.steps.map((step) => ({
      tool: step.tool,
      input: parseJsonObjectString(step.input_json),
      expected: parseJsonObjectString(step.expected_json),
      rationale: step.rationale,
    })),
    done: response.done,
    confidence: response.confidence,
  });
}

export function encodeCriticReviewResponse(review: CriticReview): CriticReviewResponse {
  return criticReviewResponseSchema.parse({
    valid: review.valid,
    feedback: review.feedback,
    plan: encodeTaskPlanResponse(review.plan),
  });
}

export function decodeCriticReviewResponse(response: CriticReviewResponse): CriticReview {
  return criticReviewSchema.parse({
    valid: response.valid,
    feedback: response.feedback,
    plan: decodeTaskPlanResponse(response.plan),
  });
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
            required: ['tool', 'input_json', 'expected_json', 'rationale'],
            properties: {
              tool: { type: 'string' },
              input_json: { type: 'string' },
              expected_json: { type: 'string' },
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

function formatExactFileSnapshots(exactFileSnapshots: FileSnapshotMemory[]): string {
  return JSON.stringify(
    exactFileSnapshots.map((snapshot) => ({
      path: snapshot.path,
      content: snapshot.content,
      recorded_at: snapshot.recorded_at,
    })),
  );
}

export function buildPlanningPrompt(
  goal: string,
  memory: MemorySummary,
  tools: ToolDefinition[],
  extraContext: string,
  exactFileSnapshots: FileSnapshotMemory[],
): string {
  return [
    `FLOW Contract Version: ${promptContractVersion}`,
    'You are FLOW planner.',
    'Return JSON only.',
    'You are planning for the FLOW runtime, not executing tools yourself.',
    'Ignore the Codex session sandbox or approval mode. They do not limit FLOW tool execution.',
    'Do not reject write-capable FLOW tools solely because your own session is read-only.',
    'If ExtraContext contains recentFailureHints, use them to avoid repeating the same invalid plan pattern.',
    'If ExtraContext contains recentFailureClasses, interpret them as normalized failure categories and correct the plan accordingly.',
    'If ExtraContext contains doNotRepeatRules, follow them strictly and avoid generating any step that violates those rules.',
    'If Memory.semantic contains file_snapshot entries, treat their content as the exact latest file text for planning edits.',
    '',
    `Goal: ${goal}`,
    `ExtraContext: ${extraContext}`,
    `ExactFileSnapshots: ${formatExactFileSnapshots(exactFileSnapshots)}`,
    `Memory: ${JSON.stringify(memory)}`,
    `Tools: ${JSON.stringify(sanitizeToolCatalog(tools))}`,
    '',
    'Response contract:',
    '- return exactly one JSON object with top-level keys goal, assumptions, risks, steps, done, confidence',
    '- start the reply with { and end the reply with }',
    '- do not include prose before or after the JSON object',
    '',
    'Requirements:',
    '- choose bounded tools only',
    '- use only tool names exactly as listed in Tools; never invent other tool namespaces or command wrappers',
    '- keep steps small and verifiable',
    '- prefer reversible actions',
    '- provide rationale for every step',
    '- use inputKeys to determine the exact keys allowed in each step input_json',
    '- encode each step input and expected value as a compact valid JSON object string in input_json and expected_json',
    '- use only concrete JSON values with double-quoted keys and string literals',
    '- never output pseudo-types, placeholders, unions, comments, angle brackets, or schema notation inside input_json or expected_json',
    '- match each step input_json exactly to the tool inputContract keys; do not invent field names',
    '- expected_json must describe concrete observable results; use exact literals, booleans, or numbers, and do not use placeholder values such as "string"',
    '- for fs.write_file, content must be the complete final file text, not a placeholder such as "string" or a short summary of the intended edit',
    '- for repo.apply_patch, never use guessed context, placeholder lines, ellipses, or synthetic markers',
    '- repo.apply_patch accepts either a valid unified diff or a FLOW patch that begins with "*** Update File:", "*** Add File:", or "*** Delete File:"',
    '- only emit repo.apply_patch after reading the exact target file content needed for a valid patch',
    '- if ExactFileSnapshots already contain a file that you need to edit, do not use repo.apply_patch for that file; use fs.write_file with the complete final file text',
    '- if file_snapshot memory is available for a target file, use that exact content when composing the edit step',
    '- when file_snapshot memory is available and you need to rewrite a section, prefer fs.write_file with the complete final file text over a patch template',
    '- if exact patch context is not yet known, add a read step first instead of guessing the patch',
    '- when a safe append or replacement can be expressed more reliably through fs.read_file plus fs.write_file, prefer that sequence over a speculative patch',
    '- for fs.read_file, expected_json should check a small observable property such as path or content_includes, not the entire file body',
  ].join('\n');
}

export function buildCriticPrompt(
  plan: TaskPlan,
  tools: ToolDefinition[],
  exactFileSnapshots: FileSnapshotMemory[],
): string {
  return [
    `FLOW Contract Version: ${promptContractVersion}`,
    'You are FLOW critic.',
    'Return JSON only.',
    'You are validating a FLOW runtime plan, not executing tools yourself.',
    'Ignore the Codex session sandbox or approval mode. They do not limit FLOW tool execution.',
    'A write-capable step is valid when it uses an allowed FLOW tool and follows the task constraints.',
    'If ExactFileSnapshots contains the current exact file text for a target file, a full fs.write_file rewrite derived from that snapshot is valid and preferred over a speculative patch.',
    'Do not reject fs.write_file solely because it writes the whole file when that file is already present in ExactFileSnapshots for this task.',
    `Plan: ${JSON.stringify(plan)}`,
    `AvailableTools: ${JSON.stringify(sanitizeToolCatalog(tools))}`,
    `ExactFileSnapshots: ${formatExactFileSnapshots(exactFileSnapshots)}`,
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
