import { describe, expect, it } from 'vitest';
import { VerifierAgent } from '../packages/core/agents';
import type { ToolResult } from '../packages/tools';

describe('VerifierAgent', () => {
  it('rejects repo.search_text when the plan expected matches but the search result is empty', () => {
    const verifier = new VerifierAgent();
    const result: ToolResult = {
      success: true,
      output: {
        query: 'guests import',
        path: '/workspace',
        matches: [],
        match_count: 0,
      },
      evidence: {
        summary: 'No text matches found.',
        details: {},
      },
      changedFiles: [],
    };

    const verification = verifier.check(
      {
        tool: 'repo.search_text',
        input: {
          query: 'guests import',
          path: '.',
          max_results: 20,
        },
        expected: {
          matches_found: true,
        },
        rationale: 'Find the import UI.',
      },
      result,
    );

    expect(verification.verified).toBe(false);
    expect(verification.evidence).toContain('at least one match');
  });

  it('rejects fs.list_dir when the expected entry is missing', () => {
    const verifier = new VerifierAgent();
    const result: ToolResult = {
      success: true,
      output: {
        path: '/workspace/apps/web/src/features',
        entries: [
          {
            name: 'auth',
            type: 'dir',
          },
          {
            name: 'event',
            type: 'dir',
          },
        ],
      },
      evidence: {
        summary: 'Listed features directory.',
        details: {},
      },
      changedFiles: [],
    };

    const verification = verifier.check(
      {
        tool: 'fs.list_dir',
        input: {
          path: 'apps/web/src/features',
        },
        expected: {
          entries_include: 'guests-import',
        },
        rationale: 'Check the expected child directory.',
      },
      result,
    );

    expect(verification.verified).toBe(false);
    expect(verification.evidence).toContain('guests-import');
  });

  it('rejects fs.write_file when the plan content is still a template placeholder', () => {
    const verifier = new VerifierAgent();
    const result: ToolResult = {
      success: true,
      output: {
        path: '/workspace/apps/web/src/components/admin-events/guest-import-dialog.tsx',
      },
      evidence: {
        summary: 'Wrote file guest-import-dialog.tsx.',
        details: {},
      },
      changedFiles: ['/workspace/apps/web/src/components/admin-events/guest-import-dialog.tsx'],
    };

    const verification = verifier.check(
      {
        tool: 'fs.write_file',
        input: {
          path: 'apps/web/src/components/admin-events/guest-import-dialog.tsx',
          content: 'UPDATED_CONTENT_AFTER_ANALYSIS',
        },
        expected: {
          path: 'apps/web/src/components/admin-events/guest-import-dialog.tsx',
        },
        rationale: 'Rewrite the dialog after analysis.',
      },
      result,
    );

    expect(verification.verified).toBe(false);
    expect(verification.evidence).toContain('exact final file body');
  });
});
