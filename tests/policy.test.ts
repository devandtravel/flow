import { describe, expect, it } from 'vitest';
import { PolicyEngine } from '../packages/policy';

describe('PolicyEngine', () => {
  it('allows allowlisted tools and blocks denied patterns', () => {
    const policy = new PolicyEngine({
      allow: ['fs.*'],
      deny: [{ pattern: 'secret' }],
      limits: { max_steps: 5, max_runtime_sec: 30, max_files_changed: 5, max_iterations: 2 },
    });

    expect(
      policy.evaluateStep(
        { tool: 'fs.read_file', input: { path: 'README.md' } },
        { startedAt: Date.now(), completedSteps: 0, changedFiles: 0, iteration: 1 },
      ).allowed,
    ).toBe(true);

    expect(
      policy.evaluateStep(
        { tool: 'fs.write_file', input: { content: 'secret' } },
        { startedAt: Date.now(), completedSteps: 0, changedFiles: 0, iteration: 1 },
      ).allowed,
    ).toBe(false);
  });
});
