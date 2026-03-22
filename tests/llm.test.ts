import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildDefaultConfig } from '../packages/config';
import { CodexProvider, MockLlmProvider } from '../packages/llm';
import { buildPlanningPrompt, createJsonSchema, decodeTaskPlanResponse, taskPlanResponseSchema, toolStepResponseSchema } from '../packages/llm/contracts';

describe('LLM providers', () => {
  it('mock provider returns schema-validated structured output', async () => {
    const provider = new MockLlmProvider();
    const result = await provider.complete({
      prompt: buildPlanningPrompt(
        'write provider output',
        {
          episodic: [],
          procedural: [],
          failure: [],
          semantic: [],
        },
        [],
        'test',
      ),
      schema: taskPlanResponseSchema,
      contract: 'task_plan',
    });

    const plan = decodeTaskPlanResponse(result);
    expect(plan.goal).toBe('write provider output');
    expect(plan.done).toBe(false);
  });

  it('codex provider surfaces execution errors cleanly', async () => {
    const config = buildDefaultConfig('/tmp/flow-llm', 'project');
    const provider = new CodexProvider({
      ...config.llm,
      executable: 'definitely-not-a-real-codex-binary',
    });

    await expect(
      provider.complete({
        prompt: 'Return {"ok":true}',
        schema: z.object({ ok: z.boolean() }),
        contract: 'evaluation',
      }),
    ).rejects.toThrow();
  });

  it('task plan schema is compatible with codex structured output requirements', () => {
    const schema = createJsonSchema('task_plan');
    expect(schema).toEqual({
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
    });
  });

  it('planning prompt makes the runtime execution boundary explicit', () => {
    const prompt = buildPlanningPrompt(
      'run checks',
      {
        episodic: [],
        procedural: [],
        failure: [],
        semantic: [],
      },
      [],
      'test',
    );

    expect(prompt).toContain('Ignore the Codex session sandbox or approval mode.');
    expect(prompt).toContain('You are planning for the FLOW runtime, not executing tools yourself.');
  });

  it('rejects pseudo-json tool payloads in task plan steps', () => {
    expect(() =>
      toolStepResponseSchema.parse({
        tool: 'repo.run_checks',
        input_json: '{}',
        expected_json: '{"status":"success"}|{"status":"failure"}',
        rationale: 'invalid expected payload',
      }),
    ).toThrow();
  });
});
