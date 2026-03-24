import type { ToolStep } from '../../domain';
import { getShellDiscoveryValidationError } from '../../policy/shell-discovery';

const reservedPlaceholderValues = new Set([
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'null',
  'undefined',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlaceholderString(value: string): boolean {
  return reservedPlaceholderValues.has(value.trim().toLowerCase());
}

function isTemplatePlaceholderString(value: string): boolean {
  const normalized = value.trim();
  return /^<[^>]*\s+[^>]*>$/.test(normalized) || (normalized.startsWith('<') && normalized.endsWith('>'));
}

function isPlaceholderIdentifierString(value: string): boolean {
  const normalized = value.trim();
  if (!/^[A-Z0-9_]+$/.test(normalized)) {
    return false;
  }

  return (
    normalized.includes('PLACEHOLDER') ||
    normalized.includes('UPDATED_CONTENT') ||
    normalized.includes('AFTER_ANALYSIS') ||
    normalized.includes('TODO')
  );
}

function containsPlaceholderValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return isPlaceholderString(value) || isTemplatePlaceholderString(value) || isPlaceholderIdentifierString(value);
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsPlaceholderValue(item));
  }

  if (isRecord(value)) {
    return Object.values(value).some((item) => containsPlaceholderValue(item));
  }

  return false;
}

function getWriteFileContentValidationError(step: ToolStep): string | undefined {
  if (step.tool !== 'fs.write_file') {
    return undefined;
  }

  const content = step.input['content'];
  if (typeof content !== 'string') {
    return 'content must be a string.';
  }

  const normalizedContent = content.trim().toLowerCase();
  if (reservedPlaceholderValues.has(normalizedContent)) {
    return 'content must contain the full file text, not a schema placeholder.';
  }

  if (/^updated .+ content\b/.test(normalizedContent)) {
    return 'content must contain the final file body, not a summary of the intended change.';
  }

  if (isTemplatePlaceholderString(content)) {
    return 'content must contain the exact final file body, not a template placeholder.';
  }

  if (isPlaceholderIdentifierString(content)) {
    return 'content must contain the exact final file body, not a placeholder token.';
  }

  return undefined;
}

function getExpectedValidationError(step: ToolStep): string | undefined {
  if (containsPlaceholderValue(step.expected)) {
    return 'expected must contain concrete verification values, not schema placeholders.';
  }

  return undefined;
}

function getPatchValidationError(step: ToolStep): string | undefined {
  if (step.tool !== 'repo.apply_patch') {
    return undefined;
  }

  const patch = step.input['patch'];
  if (typeof patch !== 'string' || patch.trim().length === 0) {
    return 'patch must contain a non-empty diff or FLOW patch.';
  }

  const lines = patch.replaceAll('\r\n', '\n').split('\n');
  if (lines.some((line) => line.trim() === '...')) {
    return 'patch must not contain ellipses or omitted context markers.';
  }

  const hasTemplatePlaceholderLine = lines.some((line) => {
    const normalizedLine = line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')
      ? line.slice(1).trim()
      : line.trim();
    return isTemplatePlaceholderString(normalizedLine);
  });
  if (hasTemplatePlaceholderLine) {
    return 'patch must contain exact file content, not template placeholders wrapped in angle brackets.';
  }

  const firstLine = lines[0]?.trim() ?? '';
  if (firstLine.startsWith('*** Update File:')) {
    const nextMeaningfulLine = lines
      .slice(1)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    if (!nextMeaningfulLine || !nextMeaningfulLine.startsWith('@@')) {
      return 'FLOW update patch must contain an explicit @@ hunk after the update header.';
    }
  }

  return undefined;
}

function getShellExecValidationError(step: ToolStep): string | undefined {
  if (step.tool !== 'shell.exec') {
    return undefined;
  }

  const command = step.input['command'];
  const args = step.input['args'];
  if (typeof command !== 'string') {
    return 'command must be a string.';
  }

  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) {
    return 'args must be an array of strings.';
  }

  return getShellDiscoveryValidationError(command, args);
}

export function getStepSemanticValidationError(step: ToolStep): string | undefined {
  return (
    getWriteFileContentValidationError(step) ??
    getExpectedValidationError(step) ??
    getPatchValidationError(step) ??
    getShellExecValidationError(step)
  );
}
