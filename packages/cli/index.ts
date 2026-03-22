#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { createApiServer } from '../api/server';
import { ensureAgentDirectories, loadConfig, writeDefaultConfig } from '../config';
import { AgentRuntime } from '../core/loop/runtime';

const program = new Command();
const workspaceRoot = process.cwd();

function createRuntime(): AgentRuntime {
  const config = loadConfig(workspaceRoot);
  return new AgentRuntime({ workspaceRoot, config });
}

program.name('agent').description('FLOW multi-agent runtime platform');

program
  .command('init')
  .description('Create the default runtime config and local data directories')
  .action(() => {
    const configPath = writeDefaultConfig(workspaceRoot);
    ensureAgentDirectories(workspaceRoot);
    console.log(JSON.stringify({ configPath }, null, 2));
  });

program
  .command('run')
  .argument('<goal>', 'Goal to execute')
  .description('Create and execute a task using the deterministic agent loop')
  .action(async (goal: string) => {
    const runtime = createRuntime();
    const task = runtime.createTask(goal);
    const summary = await runtime.runTask(task.id);
    console.log(JSON.stringify(summary, null, 2));
  });

program
  .command('daemon')
  .description('Start the REST API daemon')
  .action(async () => {
    const api = createApiServer(workspaceRoot);
    await api.start();
    console.log(JSON.stringify({ status: 'listening', host: loadConfig(workspaceRoot).server.host, port: loadConfig(workspaceRoot).server.port }, null, 2));
  });

program
  .command('status')
  .description('Print task and metric status')
  .action(() => {
    const runtime = createRuntime();
    console.log(JSON.stringify({ tasks: runtime.listTasks(), metrics: runtime.metrics.snapshot() }, null, 2));
  });

program
  .command('logs')
  .description('Print the runtime log file contents')
  .action(() => {
    const logsPath = path.join(workspaceRoot, '.agent', 'logs', 'runtime.log');
    const output = existsSync(logsPath) ? readFileSync(logsPath, 'utf8') : '';
    console.log(output);
  });

program
  .command('tasks')
  .description('List tasks from the runtime database')
  .action(() => {
    const runtime = createRuntime();
    console.log(JSON.stringify(runtime.listTasks(), null, 2));
  });

program
  .command('inspect')
  .argument('<task_id>', 'Task identifier')
  .description('Inspect a task, its runs, and steps')
  .action((taskId: string) => {
    const runtime = createRuntime();
    console.log(JSON.stringify(runtime.inspectTask(taskId), null, 2));
  });

program.parseAsync(process.argv);
