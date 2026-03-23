import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PolicyEngine } from '../policy';

type FlowPatchOperation = FlowPatchUpdateOperation | FlowPatchAddOperation | FlowPatchDeleteOperation;

interface FlowPatchUpdateOperation {
  kind: 'update';
  path: string;
  hunks: FlowPatchHunk[];
}

interface FlowPatchAddOperation {
  kind: 'add';
  path: string;
  lines: string[];
}

interface FlowPatchDeleteOperation {
  kind: 'delete';
  path: string;
  lines: string[];
}

interface FlowPatchHunkLine {
  kind: 'context' | 'add' | 'remove';
  value: string;
}

interface FlowPatchHunk {
  lines: FlowPatchHunkLine[];
}

interface TextBuffer {
  lines: string[];
  trailingNewline: boolean;
}

const updateFilePrefix = '*** Update File: ';
const addFilePrefix = '*** Add File: ';
const deleteFilePrefix = '*** Delete File: ';
const moveToPrefix = '*** Move to: ';

function splitTextBuffer(content: string): TextBuffer {
  const trailingNewline = content.endsWith('\n');
  if (content.length === 0) {
    return {
      lines: [],
      trailingNewline: false,
    };
  }

  const normalizedContent = trailingNewline ? content.slice(0, -1) : content;
  return {
    lines: normalizedContent.length === 0 ? [] : normalizedContent.split('\n'),
    trailingNewline,
  };
}

function joinTextBuffer(buffer: TextBuffer): string {
  const body = buffer.lines.join('\n');
  if (buffer.trailingNewline) {
    return body.length === 0 ? '\n' : `${body}\n`;
  }

  return body;
}

function isHeaderLine(line: string): boolean {
  return (
    line.startsWith(updateFilePrefix) ||
    line.startsWith(addFilePrefix) ||
    line.startsWith(deleteFilePrefix) ||
    line.startsWith(moveToPrefix)
  );
}

function getOperationPath(header: string, prefix: string): string {
  return header.slice(prefix.length).trim();
}

function parseHunkLine(line: string): FlowPatchHunkLine {
  const prefix = line[0];
  const value = line.slice(1);
  if (prefix === ' ') {
    return { kind: 'context', value };
  }

  if (prefix === '+') {
    return { kind: 'add', value };
  }

  if (prefix === '-') {
    return { kind: 'remove', value };
  }

  throw new Error(`Unsupported hunk line: ${line}`);
}

function parseUpdateOperation(lines: string[], startIndex: number): { operation: FlowPatchUpdateOperation; nextIndex: number } {
  const header = lines[startIndex] ?? '';
  const filePath = getOperationPath(header, updateFilePrefix);
  const hunks: FlowPatchHunk[] = [];
  let index = startIndex + 1;

  while (index < lines.length && !isHeaderLine(lines[index] ?? '')) {
    const marker = lines[index] ?? '';
    if (!marker.startsWith('@@')) {
      throw new Error(`Expected hunk marker after "${header}", received "${marker}".`);
    }

    index += 1;
    const hunkLines: FlowPatchHunkLine[] = [];
    while (index < lines.length && !isHeaderLine(lines[index] ?? '') && !(lines[index] ?? '').startsWith('@@')) {
      const currentLine = lines[index] ?? '';
      if (currentLine === '\\ No newline at end of file') {
        index += 1;
        continue;
      }

      hunkLines.push(parseHunkLine(currentLine));
      index += 1;
    }

    if (hunkLines.length === 0) {
      throw new Error(`Empty hunk for "${filePath}" is not allowed.`);
    }

    hunks.push({ lines: hunkLines });
  }

  if (hunks.length === 0) {
    throw new Error(`Update patch for "${filePath}" must contain at least one hunk.`);
  }

  return {
    operation: {
      kind: 'update',
      path: filePath,
      hunks,
    },
    nextIndex: index,
  };
}

function parseFlatLineBlock(lines: string[], startIndex: number, expectedPrefixes: ReadonlySet<string>): { lines: string[]; nextIndex: number } {
  const content: string[] = [];
  let index = startIndex + 1;

  while (index < lines.length && !isHeaderLine(lines[index] ?? '')) {
    const currentLine = lines[index] ?? '';
    if (currentLine === '\\ No newline at end of file') {
      index += 1;
      continue;
    }

    const prefix = currentLine[0] ?? '';
    if (!expectedPrefixes.has(prefix)) {
      throw new Error(`Unsupported line "${currentLine}" in FLOW patch block.`);
    }

    content.push(currentLine.slice(1));
    index += 1;
  }

  return {
    lines: content,
    nextIndex: index,
  };
}

function parseFlowPatch(patch: string): FlowPatchOperation[] {
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  const operations: FlowPatchOperation[] = [];
  let index = 0;

  while (index < lines.length) {
    const currentLine = lines[index] ?? '';
    if (currentLine.length === 0) {
      index += 1;
      continue;
    }

    if (currentLine.startsWith(moveToPrefix)) {
      throw new Error('FLOW patch move operations are not supported.');
    }

    if (currentLine.startsWith(updateFilePrefix)) {
      const parsed = parseUpdateOperation(lines, index);
      operations.push(parsed.operation);
      index = parsed.nextIndex;
      continue;
    }

    if (currentLine.startsWith(addFilePrefix)) {
      const filePath = getOperationPath(currentLine, addFilePrefix);
      const parsed = parseFlatLineBlock(lines, index, new Set(['+']));
      operations.push({
        kind: 'add',
        path: filePath,
        lines: parsed.lines,
      });
      index = parsed.nextIndex;
      continue;
    }

    if (currentLine.startsWith(deleteFilePrefix)) {
      const filePath = getOperationPath(currentLine, deleteFilePrefix);
      const parsed = parseFlatLineBlock(lines, index, new Set(['-', ' ']));
      operations.push({
        kind: 'delete',
        path: filePath,
        lines: parsed.lines,
      });
      index = parsed.nextIndex;
      continue;
    }

    throw new Error(`Unsupported FLOW patch header "${currentLine}".`);
  }

  if (operations.length === 0) {
    throw new Error('FLOW patch does not contain any operations.');
  }

  return operations;
}

function findAllMatches(haystack: string[], needle: string[]): number[] {
  if (needle.length === 0) {
    return [];
  }

  const matches: number[] = [];
  const maxStart = haystack.length - needle.length;
  for (let start = 0; start <= maxStart; start += 1) {
    let isMatch = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if ((haystack[start + offset] ?? '') !== (needle[offset] ?? '')) {
        isMatch = false;
        break;
      }
    }

    if (isMatch) {
      matches.push(start);
    }
  }

  return matches;
}

function applyUpdateOperation(operation: FlowPatchUpdateOperation, absolutePath: string): string {
  const originalBuffer = splitTextBuffer(readFileSync(absolutePath, 'utf8'));
  const updatedLines = [...originalBuffer.lines];

  for (const hunk of operation.hunks) {
    const beforeLines = hunk.lines
      .filter((line) => line.kind === 'context' || line.kind === 'remove')
      .map((line) => line.value);
    const afterLines = hunk.lines
      .filter((line) => line.kind === 'context' || line.kind === 'add')
      .map((line) => line.value);

    if (beforeLines.length === 0) {
      throw new Error(`FLOW patch for "${operation.path}" contains a hunk without searchable context.`);
    }

    const matches = findAllMatches(updatedLines, beforeLines);
    if (matches.length === 0) {
      throw new Error(`FLOW patch hunk for "${operation.path}" does not match the current file content.`);
    }

    if (matches.length > 1) {
      throw new Error(`FLOW patch hunk for "${operation.path}" is ambiguous and matches multiple locations.`);
    }

    const start = matches[0] ?? 0;
    updatedLines.splice(start, beforeLines.length, ...afterLines);
  }

  return joinTextBuffer({
    lines: updatedLines,
    trailingNewline: originalBuffer.trailingNewline,
  });
}

function validateDeleteOperation(operation: FlowPatchDeleteOperation, absolutePath: string): void {
  if (operation.lines.length === 0) {
    return;
  }

  const currentBuffer = splitTextBuffer(readFileSync(absolutePath, 'utf8'));
  if (currentBuffer.lines.length !== operation.lines.length) {
    throw new Error(`FLOW patch delete for "${operation.path}" does not match the current file length.`);
  }

  for (let index = 0; index < operation.lines.length; index += 1) {
    if ((currentBuffer.lines[index] ?? '') !== (operation.lines[index] ?? '')) {
      throw new Error(`FLOW patch delete for "${operation.path}" does not match the current file content.`);
    }
  }
}

export function isFlowPatchFormat(patch: string): boolean {
  const trimmed = patch.trimStart();
  return trimmed.startsWith(updateFilePrefix) || trimmed.startsWith(addFilePrefix) || trimmed.startsWith(deleteFilePrefix);
}

export function getFlowPatchChangedFiles(patch: string): string[] {
  return parseFlowPatch(patch).map((operation) => operation.path);
}

export function applyFlowPatch(patch: string, workspaceRoot: string, policy: PolicyEngine): string[] {
  const operations = parseFlowPatch(patch);
  const changedFiles: string[] = [];

  for (const operation of operations) {
    const absolutePath = path.resolve(workspaceRoot, operation.path);
    if (!policy.canWrite(absolutePath)) {
      throw new Error(`Write access to ${absolutePath} is outside the configured workspace boundary.`);
    }

    if (operation.kind === 'update') {
      if (!existsSync(absolutePath)) {
        throw new Error(`Cannot update missing file "${operation.path}".`);
      }

      const nextContent = applyUpdateOperation(operation, absolutePath);
      writeFileSync(absolutePath, nextContent, 'utf8');
      changedFiles.push(operation.path);
      continue;
    }

    if (operation.kind === 'add') {
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      const content = joinTextBuffer({
        lines: operation.lines,
        trailingNewline: operation.lines.length > 0,
      });
      writeFileSync(absolutePath, content, 'utf8');
      changedFiles.push(operation.path);
      continue;
    }

    validateDeleteOperation(operation, absolutePath);
    rmSync(absolutePath);
    changedFiles.push(operation.path);
  }

  return changedFiles;
}
