import { describe, expect, it } from 'vitest';
import { buildRunViewModel } from '../packages/api/view-models';
import { buildReplanGuidance } from '../packages/core/agents/replan-guidance';
import type { RunEventRecord, RunRecord, TaskRecord } from '../packages/domain';

describe('replan guidance', () => {
  it('normalizes failure hints into stable do-not-repeat rules', () => {
    const guidance = buildReplanGuidance([
      'plan_invalid: expected must contain concrete verification values, not schema placeholders.',
      'repo.apply_patch: No valid patches in input.',
      'plan_generation_failed: invalid structured output',
    ]);

    expect(guidance.failureClasses).toEqual([
      'placeholder_values',
      'invalid_patch_format',
      'invalid_structured_output',
    ]);
    expect(guidance.doNotRepeatRules).toEqual([
      'Не используй schema placeholders в input_json и expected_json; подставляй только конкретные наблюдаемые значения.',
      'Для repo.apply_patch используй только валидный FLOW patch или unified diff с точным контекстом после чтения файла.',
      'Возвращай только валидный JSON по контракту без дополнительного текста.',
    ]);
  });

  it('exposes attempt, plan preview, and critic feedback in run view models', () => {
    const task: TaskRecord = {
      id: '11111111-1111-4111-8111-111111111111',
      goal: 'Проверить replanning',
      state: 'failed',
      priority: 0,
      target_id: 'local',
      created_at: '2026-03-23T10:00:00.000Z',
      updated_at: '2026-03-23T10:05:00.000Z',
    };
    const run: RunRecord = {
      id: '22222222-2222-4222-8222-222222222222',
      task_id: task.id,
      status: 'failed',
      iteration: 2,
      started_at: '2026-03-23T10:01:00.000Z',
      finished_at: '2026-03-23T10:02:00.000Z',
    };
    const events: RunEventRecord[] = [
      {
        id: '33333333-3333-4333-8333-333333333333',
        run_id: run.id,
        level: 'info',
        message: 'planning_completed',
        payload_json: JSON.stringify({
          stepCount: 2,
          confidence: 0.7,
          preview: {
            assumptions: ['Файлы доступны для чтения.'],
            risks: ['Патч может потребовать дополнительного контекста.'],
            confidence: 0.7,
            steps: [
              { tool: 'fs.read_file', rationale: 'Получить точное содержимое файла.' },
              { tool: 'repo.apply_patch', rationale: 'Применить подтверждённый diff.' },
            ],
          },
        }),
        created_at: '2026-03-23T10:01:10.000Z',
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        run_id: run.id,
        level: 'error',
        message: 'plan_invalid',
        payload_json: JSON.stringify({
          feedback: ['expected must contain concrete verification values, not schema placeholders.'],
          failureClasses: ['placeholder_values'],
          doNotRepeatRules: ['Не используй schema placeholders в input_json и expected_json; подставляй только конкретные наблюдаемые значения.'],
        }),
        created_at: '2026-03-23T10:01:20.000Z',
      },
    ];

    const runView = buildRunViewModel(task, run, [], events, events, [], { total: 2, limit: 20, offset: 0 }, 3, []);

    expect(runView.summary.attempt).toEqual({
      current: 2,
      total: 3,
      label: 'Попытка 2/3',
    });
    expect(runView.summary.planPreview).toEqual(
      expect.objectContaining({
        confidence: 0.7,
        steps: expect.arrayContaining([
          expect.objectContaining({
            tool: 'fs.read_file',
          }),
        ]),
      }),
    );
    expect(runView.summary.criticFeedback).toEqual({
      feedback: ['expected must contain concrete verification values, not schema placeholders.'],
      failureClasses: ['placeholder_values'],
      doNotRepeatRules: ['Не используй schema placeholders в input_json и expected_json; подставляй только конкретные наблюдаемые значения.'],
    });
  });
});
