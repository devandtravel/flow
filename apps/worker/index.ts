import { AgentRuntime } from '../../packages/core/loop/runtime';
import { loadConfig } from '../../packages/config';

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const runtime = new AgentRuntime({ workspaceRoot, config: loadConfig(workspaceRoot) });
  const queuedTask = runtime.listTasks().find((task) => task.state === 'queued' || task.state === 'retryable');
  if (queuedTask) {
    await runtime.runTask(queuedTask.id);
  }
}

void main();
