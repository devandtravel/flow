import { describe, expect, it } from 'vitest';
import { buildDefaultConfig } from '../packages/config';
import { PolicyEngine } from '../packages/policy';

describe('PolicyEngine', () => {
  it('allows bounded tools, blocks denied patterns, and requests approval for sensitive capability', () => {
    const config = buildDefaultConfig('/tmp/flow-policy', 'project');
    config.policies.allow_tools.push('shell.exec');
    config.capabilities.enabled.push('shell.exec');
    const policy = new PolicyEngine({
      ...config.policies,
      limits: config.limits,
      autonomy: config.autonomy,
      workspace: config.workspace,
    });

    expect(
      policy.evaluateStep(
        { tool: 'fs.read_file', capability: 'fs.read', input: { path: 'README.md' } },
        { startedAt: Date.now(), completedSteps: 0, changedFiles: 0, iteration: 1 },
      ).kind,
    ).toBe('allow');

    expect(
      policy.evaluateStep(
        { tool: 'fs.write_file', capability: 'fs.write', input: { content: 'rm -rf /' } },
        { startedAt: Date.now(), completedSteps: 0, changedFiles: 0, iteration: 1 },
      ).kind,
    ).toBe('deny');

    expect(
      policy.evaluateStep(
        { tool: 'shell.exec', capability: 'shell.exec', input: { command: 'pwd' } },
        { startedAt: Date.now(), completedSteps: 0, changedFiles: 0, iteration: 1 },
      ).kind,
    ).toBe('require_approval');
  });
});
