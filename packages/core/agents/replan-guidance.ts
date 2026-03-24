import { z } from 'zod';

export const replanFailureClassSchema = z.enum([
  'placeholder_values',
  'full_file_text_required',
  'invalid_patch_format',
  'snapshot_backed_write_required',
  'empty_discovery_result',
  'directory_read_mismatch',
  'speculative_path',
  'nonexistent_path',
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
    pattern: /file_snapshot memory|instead of repo\.apply_patch/i,
    failureClass: 'snapshot_backed_write_required',
    rule: 'Если exact file snapshot уже есть, не используй repo.apply_patch для этого файла; используй fs.write_file с полным итоговым текстом.',
  },
  {
    pattern: /Expected repo\.search_(text|files)|Expected repo\.symbol_search|return at least one match|return at least one file path/i,
    failureClass: 'empty_discovery_result',
    rule: 'Если discovery-поиск вернул 0 совпадений, не продолжай план от пустого результата; сузь запрос до конкретных идентификаторов полей из цели или переключись между repo.search_text, repo.search_files и repo.symbol_search.',
  },
  {
    pattern: /fs\.read_file.*directory|EISDIR: illegal operation on a directory, read|использует `fs\.read_file` для каталога/i,
    failureClass: 'directory_read_mismatch',
    rule: 'Не используй fs.read_file для каталогов; сначала применяй fs.list_dir и переходи к чтению только после подтверждения точного файла.',
  },
  {
    pattern: /фиктивным пут[её]м|требуется уточнить реальный модуль|как получить конкретное значение|неподтвержд[её]нн|guess(ed)? path|placeholder path/i,
    failureClass: 'speculative_path',
    rule: 'Не строй дочерние пути и имена файлов по догадке; каждый новый сегмент пути должен быть подтверждён предыдущим observation-шагом или exact snapshot.',
  },
  {
    pattern: /ENOENT: no such file or directory|scandir .* no such file or directory|такого файла или каталога не существует/i,
    failureClass: 'nonexistent_path',
    rule: 'Если путь не существует, перепланируйся от последнего подтверждённого каталога и не перебирай соседние пути вслепую.',
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
