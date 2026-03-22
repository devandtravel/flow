import { AgentRuntime } from '../../packages/core/loop/runtime';
import { loadConfig } from '../../packages/config';

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const runtime = new AgentRuntime({ workspaceRoot, config: loadConfig(workspaceRoot) });
  const controller = new AbortController();

  process.on('SIGINT', () => controller.abort());
  process.on('SIGTERM', () => controller.abort());

  await runtime.startWorkerLoop(controller.signal);
}

void main();
