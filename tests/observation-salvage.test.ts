import { describe, expect, it } from 'vitest';
import { buildObservationSalvagePlan } from '../packages/core/agents/observation-salvage';
import { createToolRegistry, listToolDefinitions } from '../packages/tools';

describe('buildObservationSalvagePlan', () => {
  it('collects validated read-only observation steps across the whole plan, not only the first prefix', () => {
    const toolCatalog = listToolDefinitions(createToolRegistry());
    const salvagePlan = buildObservationSalvagePlan(
      {
        steps: [
          {
            tool: 'repo.search_text',
            input: {
              query: 'LocalizedOptionalField',
              path: '.',
              max_results: 20,
            },
            expected: {
              matches: true,
            },
            rationale: 'Find the code location.',
          },
          {
            tool: 'fs.read_file',
            input: {
              path: 'packages/i18n/src/types.ts',
            },
            expected: {
              content_includes: 'LocalizedOptionalField',
            },
            rationale: 'Read the source file.',
          },
          {
            tool: 'fs.write_file',
            input: {
              path: 'packages/i18n/src/types.ts',
              content: 'placeholder',
            },
            expected: {
              changed: true,
            },
            rationale: 'Write a placeholder change.',
          },
          {
            tool: 'fs.read_file',
            input: {
              path: 'README.md',
            },
            expected: {
              content_includes: 'Twilx',
            },
            rationale: 'Read the Russian README.',
          },
          {
            tool: 'fs.read_file',
            input: {
              path: 'README.en.md',
            },
            expected: {
              content_includes: 'Twilx',
            },
            rationale: 'Read the English README.',
          },
        ],
      },
      toolCatalog,
    );

    expect(salvagePlan?.steps.map((step) => `${step.tool}:${String(step.input['path'] ?? step.input['query'])}`)).toEqual([
      'repo.search_text:.',
      'fs.read_file:packages/i18n/src/types.ts',
      'fs.read_file:README.md',
      'fs.read_file:README.en.md',
    ]);
  });
});
