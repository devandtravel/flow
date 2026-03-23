import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildDefaultConfig } from '../packages/config';
import { CriticAgent, SupervisorAgent } from '../packages/core/agents';
import { CodexProvider, MockLlmProvider, extractJsonObjectFromStdout } from '../packages/llm';
import { buildPlanningPrompt, createJsonSchema, decodeTaskPlanResponse, taskPlanResponseSchema, toolStepResponseSchema } from '../packages/llm/contracts';
import { createToolRegistry } from '../packages/tools';

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
    expect(prompt).toContain('never use guessed context, placeholder lines, ellipses, or synthetic markers');
    expect(prompt).toContain('for fs.write_file, content must be the complete final file text');
    expect(prompt).toContain('expected_json must describe concrete observable results');
  });

  it('critic rejects placeholder fs.write_file content before execution', async () => {
    const registry = createToolRegistry();
    const writeTool = registry.get('fs.write_file');
    if (!writeTool) {
      throw new Error('Expected fs.write_file tool to be registered.');
    }

    const critic = new CriticAgent(new MockLlmProvider());
    const review = await critic.validate(
      {
        goal: 'rewrite file',
        assumptions: [],
        risks: [],
        steps: [
          {
            tool: 'fs.write_file',
            input: {
              path: 'README.md',
              content: 'string',
            },
            expected: {},
            rationale: 'placeholder content',
          },
        ],
        done: false,
        confidence: 0.2,
      },
      [writeTool],
    );

    expect(review.valid).toBe(false);
    expect(review.feedback[0]).toContain('full file text');
  });

  it('critic rejects placeholder expected values before execution', async () => {
    const registry = createToolRegistry();
    const readTool = registry.get('fs.read_file');
    if (!readTool) {
      throw new Error('Expected fs.read_file tool to be registered.');
    }

    const critic = new CriticAgent(new MockLlmProvider());
    const review = await critic.validate(
      {
        goal: 'inspect file',
        assumptions: [],
        risks: [],
        steps: [
          {
            tool: 'fs.read_file',
            input: {
              path: 'README.md',
            },
            expected: {
              content: 'string',
            },
            rationale: 'placeholder expectation',
          },
        ],
        done: false,
        confidence: 0.2,
      },
      [readTool],
    );

    expect(review.valid).toBe(false);
    expect(review.feedback[0]).toContain('concrete verification values');
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

  it('supervisor escalates cleanly when max iterations are reached', async () => {
    const supervisor = new SupervisorAgent(new MockLlmProvider());
    const decision = await supervisor.decide({
      hadFailure: true,
      iteration: 2,
      maxIterations: 2,
      failures: ['first failure', 'second failure'],
    });

    expect(decision.decision).toBe('escalate');
    expect(decision.reason).toContain('first failure; second failure');
  });

  it('extracts the last JSON object from codex stdout when output file is missing', () => {
    const extracted = extractJsonObjectFromStdout([
      'OpenAI Codex v0.116.0',
      'codex',
      '{"ok":true}',
      'tokens used',
      '23031',
    ].join('\n'));

    expect(extracted).toBe('{"ok":true}');
  });

  it('extracts a multiline JSON object from codex stdout', () => {
    const extracted = extractJsonObjectFromStdout([
      'OpenAI Codex v0.116.0',
      'assistant',
      '{',
      '  "ok": true,',
      '  "items": [',
      '    "one",',
      '    "two"',
      '  ]',
      '}',
      'tokens used',
    ].join('\n'));

    expect(extracted).toBe('{\n  "ok": true,\n  "items": [\n    "one",\n    "two"\n  ]\n}');
  });
});
