import { z } from 'zod';

export const replanFailureClassSchema = z.enum([
  'placeholder_values',
  'full_file_text_required',
  'invalid_patch_format',
  'unknown_tool',
  'disabled_capability',
  'workspace_boundary',
  'invalid_structured_output',
]);
export type ReplanFailureClass = z.infer<typeof replanFailureClassSchema>;

interface ReplanRuleDefinition {
  readonly pattern: RegExp;
  readonly failureClass: ReplanFailureClass;
  readonly rule: string;
}

const ruleDefinitions: ReplanRuleDefinition[] = [
  {
    pattern: /placeholder/i,
    failureClass: 'placeholder_values',
    rule: 'Не используй schema placeholders в input_json и expected_json; подставляй только конкретные наблюдаемые значения.',
  },
  {
    pattern: /full file text/i,
    failureClass: 'full_file_text_required',
    rule: 'Для fs.write_file всегда передавай полный итоговый текст файла, а не описание изменения.',
  },
  {
    pattern: /No valid patches in input|hunk|patch/i,
    failureClass: 'invalid_patch_format',
    rule: 'Для repo.apply_patch используй только валидный FLOW patch или unified diff с точным контекстом после чтения файла.',
  },
  {
    pattern: /Unknown tool/i,
    failureClass: 'unknown_tool',
    rule: 'Используй только инструменты из переданного каталога tools и не изобретай новые имена.',
  },
  {
    pattern: /Capability .* is not enabled/i,
    failureClass: 'disabled_capability',
    rule: 'Не планируй шаги с capability, которой нет в target capabilities.',
  },
  {
    pattern: /workspace boundary|outside the configured workspace boundary/i,
    failureClass: 'workspace_boundary',
    rule: 'Не выходи за read/write границы workspace и target.',
  },
  {
    pattern: /structured output|invalid structured output|without producing structured output|invalid_type|"message": "Required"/i,
    failureClass: 'invalid_structured_output',
    rule: 'Возвращай только валидный JSON по контракту без дополнительного текста.',
  },
];

export interface ReplanGuidance {
  readonly failureClasses: ReplanFailureClass[];
  readonly doNotRepeatRules: string[];
}

export function buildReplanGuidance(hints: string[]): ReplanGuidance {
  const failureClasses = new Set<ReplanFailureClass>();
  const doNotRepeatRules = new Set<string>();

  for (const hint of hints) {
    for (const definition of ruleDefinitions) {
      if (!definition.pattern.test(hint)) {
        continue;
      }

      failureClasses.add(definition.failureClass);
      doNotRepeatRules.add(definition.rule);
    }
  }

  return {
    failureClasses: [...failureClasses],
    doNotRepeatRules: [...doNotRepeatRules],
  };
}
