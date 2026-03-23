import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildDefaultConfig } from '../packages/config';
import { CriticAgent, SupervisorAgent } from '../packages/core/agents';
import type { FileSnapshotMemory } from '../packages/domain';
import { CodexProvider, MockLlmProvider, extractJsonObjectFromStdout, type LlmProvider, type LlmRequest } from '../packages/llm';
import { buildPlanningPrompt, createJsonSchema, decodeTaskPlanResponse, taskPlanResponseSchema, toolStepResponseSchema } from '../packages/llm/contracts';
import { createToolRegistry } from '../packages/tools';

class ThrowingProvider implements LlmProvider {
  async complete<TOutput>(request: LlmRequest<TOutput>): Promise<TOutput> {
    void request;
    throw new Error('provider unavailable');
  }
}

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
        [],
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

  it('codex provider ignores unrelated json blocks and parses the contract-matching response', async () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), 'flow-llm-test-'));
    const executablePath = path.join(tempDirectory, 'mock-codex.js');
    writeFileSync(
      executablePath,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "const outputIndex = process.argv.indexOf('--output-last-message');",
        'if (outputIndex >= 0) {',
        "  fs.writeFileSync(process.argv[outputIndex + 1], '');",
        '}',
        "console.log('{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"error\",\"message\":\"ignored\"}}');",
        "console.log('{\"type\":\"item.completed\",\"item\":{\"id\":\"item_1\",\"type\":\"agent_message\",\"text\":\"{\\\\\"goal\\\\\":\\\\\"demo\\\\\",\\\\\"assumptions\\\\\":[],\\\\\"risks\\\\\":[],\\\\\"steps\\\\\":[{\\\\\"tool\\\\\":\\\\\"fs.list_dir\\\\\",\\\\\"input_json\\\\\":\\\\\"{\\\\\\\\\\\\\"path\\\\\\\\\\\\\":\\\\\\\\\\\\\".\\\\\\\\\\\\\"}\\\\\",\\\\\"expected_json\\\\\":\\\\\"{\\\\\\\\\\\\\"success\\\\\\\\\\\\\":true}\\\\\",\\\\\"rationale\\\\\":\\\\\"observe\\\\\"}],\\\\\"done\\\\\":false,\\\\\"confidence\\\\\":0.5}\"}}');",
      ].join('\n'),
      'utf8',
    );
    chmodSync(executablePath, 0o755);

    const config = buildDefaultConfig('/tmp/flow-llm', 'project');
    const provider = new CodexProvider({
      ...config.llm,
      executable: executablePath,
    });

    const result = await provider.complete({
      prompt: 'Return a task plan.',
      schema: taskPlanResponseSchema,
      contract: 'task_plan',
    });

    expect(result.goal).toBe('demo');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.tool).toBe('fs.list_dir');
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
      [],
    );

    expect(prompt).toContain('Ignore the Codex session sandbox or approval mode.');
    expect(prompt).toContain('You are planning for the FLOW runtime, not executing tools yourself.');
    expect(prompt).toContain('never use guessed context, placeholder lines, ellipses, or synthetic markers');
    expect(prompt).toContain('for fs.write_file, content must be the complete final file text');
    expect(prompt).toContain('expected_json must describe concrete observable results');
    expect(prompt).toContain('If ExtraContext contains recentFailureHints');
    expect(prompt).toContain('If ExtraContext contains recentFailureClasses');
    expect(prompt).toContain('If ExtraContext contains doNotRepeatRules');
    expect(prompt).toContain('If Memory.semantic contains file_snapshot entries');
    expect(prompt).toContain('prefer fs.write_file with the complete final file text');
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
      { exactFileSnapshots: [] },
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
      { exactFileSnapshots: [] },
    );

    expect(review.valid).toBe(false);
    expect(review.feedback[0]).toContain('concrete verification values');
  });

  it('critic rejects template placeholder expected values before execution', async () => {
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
              content: '<полный текст README.md>',
            },
            rationale: 'template expectation',
          },
        ],
        done: false,
        confidence: 0.2,
      },
      [readTool],
      { exactFileSnapshots: [] },
    );

    expect(review.valid).toBe(false);
    expect(review.feedback[0]).toContain('concrete verification values');
  });

  it('critic rejects speculative FLOW patch bodies before execution', async () => {
    const registry = createToolRegistry();
    const patchTool = registry.get('repo.apply_patch');
    if (!patchTool) {
      throw new Error('Expected repo.apply_patch tool to be registered.');
    }

    const critic = new CriticAgent(new MockLlmProvider());
    const review = await critic.validate(
      {
        goal: 'patch readme',
        assumptions: [],
        risks: [],
        steps: [
          {
            tool: 'repo.apply_patch',
            input: {
              patch: '*** Update File: README.md\n...',
            },
            expected: {
              changed: true,
            },
            rationale: 'placeholder patch',
          },
        ],
        done: false,
        confidence: 0.2,
      },
      [patchTool],
      { exactFileSnapshots: [] },
    );

    expect(review.valid).toBe(false);
    expect(review.feedback[0]).toContain('must not contain ellipses');
  });

  it('critic rejects template placeholder FLOW patch bodies before execution', async () => {
    const registry = createToolRegistry();
    const patchTool = registry.get('repo.apply_patch');
    if (!patchTool) {
      throw new Error('Expected repo.apply_patch tool to be registered.');
    }

    const critic = new CriticAgent(new MockLlmProvider());
    const review = await critic.validate(
      {
        goal: 'patch readme',
        assumptions: [],
        risks: [],
        steps: [
          {
            tool: 'repo.apply_patch',
            input: {
              patch: '*** Update File: README.md\n@@\n-<точный блок из README.md до вставки>\n+<тот же блок с новой секцией>\n',
            },
            expected: {
              changed: true,
            },
            rationale: 'template patch',
          },
        ],
        done: false,
        confidence: 0.2,
      },
      [patchTool],
      { exactFileSnapshots: [] },
    );

    expect(review.valid).toBe(false);
    expect(review.feedback[0]).toContain('angle brackets');
  });

  it('critic rejects repo.apply_patch for files that already have exact snapshots', async () => {
    const registry = createToolRegistry();
    const patchTool = registry.get('repo.apply_patch');
    if (!patchTool) {
      throw new Error('Expected repo.apply_patch tool to be registered.');
    }

    const critic = new CriticAgent(new MockLlmProvider());
    const snapshots: FileSnapshotMemory[] = [
      {
        type: 'file_snapshot',
        task_id: '00000000-0000-4000-8000-000000000001',
        target_id: 'local',
        path: 'README.md',
        content: '# Title\n',
        run_id: '00000000-0000-4000-8000-000000000002',
        step_id: '00000000-0000-4000-8000-000000000003',
        recorded_at: new Date().toISOString(),
      },
    ];

    const review = await critic.validate(
      {
        goal: 'patch readme from snapshot',
        assumptions: [],
        risks: [],
        steps: [
          {
            tool: 'repo.apply_patch',
            input: {
              patch: '*** Update File: README.md\n@@\n # Title\n+# Added\n',
            },
            expected: {
              changed: true,
            },
            rationale: 'Patch an already observed file.',
          },
        ],
        done: false,
        confidence: 0.2,
      },
      [patchTool],
      { exactFileSnapshots: snapshots },
    );

    expect(review.valid).toBe(false);
    expect(review.feedback[0]).toContain('fs.write_file');
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

  it('supervisor falls back to deterministic replan when provider output is unavailable', async () => {
    const supervisor = new SupervisorAgent(new ThrowingProvider());
    const decision = await supervisor.decide({
      hadFailure: true,
      iteration: 1,
      maxIterations: 3,
      failures: ['planner failed'],
    });

    expect(decision.decision).toBe('replan');
    expect(decision.reason).toContain('Structured supervisor response was unavailable');
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
