import type { FileSnapshotMemory, ToolStep } from '../../domain';

export interface StepValidationContext {
  readonly exactFileSnapshots: readonly FileSnapshotMemory[];
}

function extractPatchPaths(patch: string): string[] {
  const paths = new Set<string>();

  for (const line of patch.replaceAll('\r\n', '\n').split('\n')) {
    if (line.startsWith('*** Update File: ') || line.startsWith('*** Add File: ') || line.startsWith('*** Delete File: ')) {
      paths.add(line.slice(line.indexOf(':') + 1).trim());
      continue;
    }

    if (line.startsWith('+++ b/')) {
      paths.add(line.slice('+++ b/'.length).trim());
    }
  }

  return [...paths];
}

export function getContextualStepSemanticValidationError(
  step: ToolStep,
  context: StepValidationContext,
): string | undefined {
  if (step.tool !== 'repo.apply_patch') {
    return undefined;
  }

  const patch = step.input['patch'];
  if (typeof patch !== 'string') {
    return undefined;
  }

  const patchPaths = extractPatchPaths(patch);
  const snapshotPaths = new Set(context.exactFileSnapshots.map((snapshot) => snapshot.path));
  const overlapsSnapshot = patchPaths.some((patchPath) => snapshotPaths.has(patchPath));

  if (!overlapsSnapshot) {
    return undefined;
  }

  return 'For files with exact file_snapshot memory, use fs.write_file with the complete final file text instead of repo.apply_patch.';
}
