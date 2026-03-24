import path from 'node:path';

const shellDiscoveryCommands = new Set(['rg', 'fd', 'find', 'ls', 'cat', 'sed', 'head', 'tail', 'grep', 'git']);
const shellDiscoveryGitSubcommands = new Set(['status', 'diff', 'grep', 'ls-files', 'show', 'log', 'rev-parse', 'blame']);
const shellDiscoveryDeniedArgs = new Set(['-exec']);

function isRepositoryLocalShellArg(argument: string): boolean {
  if (argument.startsWith('/')) {
    return false;
  }

  if (argument.split(path.sep).includes('..')) {
    return false;
  }

  return true;
}

export function getShellDiscoveryValidationError(command: string, args: readonly string[]): string | undefined {
  if (command.includes('/') || command.includes(path.sep)) {
    return 'shell.exec requires a command name without path segments.';
  }

  if (!shellDiscoveryCommands.has(command)) {
    return `shell.exec command ${command} is outside the allowed discovery toolset.`;
  }

  if (args.some((argument) => shellDiscoveryDeniedArgs.has(argument))) {
    return 'shell.exec does not allow delegated command execution flags such as -exec.';
  }

  if (args.some((argument) => !isRepositoryLocalShellArg(argument))) {
    return 'shell.exec discovery commands must stay within repository-local paths.';
  }

  if (command !== 'git') {
    return undefined;
  }

  const gitSubcommand = args[0];
  if (!gitSubcommand || !shellDiscoveryGitSubcommands.has(gitSubcommand)) {
    return 'shell.exec only allows read-only git discovery commands.';
  }

  return undefined;
}
