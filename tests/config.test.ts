import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDefaultConfig, ensureAgentDirectories, loadConfig, writeDefaultConfig } from '../packages/config';

describe('runtime config', () => {
  it('writes and reloads the project scaffold with first-class contour fields', () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-config-'));
    ensureAgentDirectories(workspaceRoot);
    const configPath = writeDefaultConfig(workspaceRoot, 'project');
    const loaded = loadConfig(workspaceRoot, configPath);

    expect(loaded.mode).toBe('project');
    expect(loaded.autonomy.mode).toBe('supervised');
    expect(loaded.maintenance.retention.keep_latest_artifacts).toBe(100);
    expect(loaded.maintenance.retention.max_artifact_age_days).toBe(null);
    expect(loaded.maintenance.cleanup.dry_run_default).toBe(false);
    expect(loaded.maintenance.cleanup.interval_seconds).toBe(null);
    expect(loaded.targets[0]?.id).toBe('local');
    expect(loaded.policies.allow_tools).toContain('git.*');
    expect(existsSync(path.join(workspaceRoot, '.agent', 'README.md'))).toBe(true);
  });

  it('builds a system contour config with explicit targets', () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-config-system-'));
    const config = buildDefaultConfig(workspaceRoot, 'system');

    expect(config.mode).toBe('system');
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0]?.id).toBe('example-project');
  });
});
