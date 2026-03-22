import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildDefaultConfig } from '../packages/config';
import { CodexProvider, MockLlmProvider } from '../packages/llm';
import { buildPlanningPrompt } from '../packages/llm/contracts';

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
      schema: z.object({
        goal: z.string(),
        done: z.boolean(),
      }),
      contract: 'task_plan',
    });

    expect(result.goal).toBe('write provider output');
    expect(result.done).toBe(false);
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
});
