import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { ensureAgentDirectories, loadConfig, type RuntimeConfig } from '../../config';
import { RuntimeDatabase, type ArtifactRecord, type StepRecord, type TaskRecord } from '../../db/database';
import { MemoryService } from '../../memory';
import { PolicyEngine } from '../../policy';
import { createLogger, MetricsCollector } from '../../telemetry';
import { createToolRegistry, executeTool, type ToolResult } from '../../tools';
import { assertValidTransition, type TaskState } from '../state';
import { CriticAgent, EvaluatorAgent, ExecutorAgent, PlannerAgent, SupervisorAgent, VerifierAgent, type Plan } from '../agents';

export interface RuntimeOptions {
  workspaceRoot: string;
  config?: RuntimeConfig;
}

export interface RunSummary {
  task: TaskRecord;
  runId: string;
  state: string;
  plan: Plan;
  artifacts: ArtifactRecord[];
  metrics: ReturnType<MetricsCollector['snapshot']>;
}

export class AgentRuntime {
  readonly workspaceRoot: string;
  readonly config: RuntimeConfig;
  readonly database: RuntimeDatabase;
  readonly policy: PolicyEngine;
  readonly tools: Map<string, ReturnType<typeof createToolRegistry> extends Map<string, infer T> ? T : never>;
  readonly memory: MemoryService;
  readonly logger: Logger;
  readonly metrics = new MetricsCollector();
  private readonly planner = new PlannerAgent();
  private readonly critic = new CriticAgent();
  private readonly executor = new ExecutorAgent();
  private readonly verifier = new VerifierAgent();
  private readonly supervisor = new SupervisorAgent();
  private readonly evaluator = new EvaluatorAgent();
  private readonly artifactsDir: string;
  private readonly changedFiles = new Set<string>();

  constructor(options: RuntimeOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.config = options.config ?? loadConfig(this.workspaceRoot);
    const directories = ensureAgentDirectories(this.workspaceRoot);
    this.artifactsDir = directories.artifactsDir;
    this.database = new RuntimeDatabase(path.join(directories.agentDir, 'flow.db'));
    this.policy = new PolicyEngine({
      limits: this.config.limits,
      allow: ['git.*', 'fs.*', 'repo.*', 'http.fetch'],
      deny: [{ pattern: 'rm -rf' }],
      require_approval: [{ tool: 'git.push' }],
    });
    this.tools = createToolRegistry({
      workspaceRoot: this.workspaceRoot,
      httpAllowlist: this.config.http.allowlist,
    });
    this.memory = new MemoryService(this.database);
    this.logger = createLogger(directories.logsDir);
  }

  createTask(goal: string, priority = 0): TaskRecord {
    return this.database.createTask(goal, priority);
  }

  listTasks(): TaskRecord[] {
    return this.database.listTasks();
  }

  inspectTask(taskId: string) {
    return this.database.inspectTask(taskId);
  }

  getRun(runId: string) {
    return {
      run: this.database.getRun(runId),
      steps: this.database.listStepsByRun(runId),
      evaluations: this.database.listEvaluationsByRun(runId),
    };
  }

  getArtifact(artifactId: string) {
    return this.database.getArtifact(artifactId);
  }

  private transitionTask(task: TaskRecord, nextState: TaskState): TaskRecord {
    assertValidTransition(task.state as TaskState, nextState);
    return this.database.updateTaskState(task.id, nextState);
  }

  private createArtifacts(stepRecord: StepRecord, verification: { verified: boolean; evidence: string }, result: ToolResult): ArtifactRecord[] {
    const stepDir = path.join(this.artifactsDir, stepRecord.run_id, `${stepRecord.index}-${stepRecord.tool.replace(/[^a-z0-9._-]/gi, '_')}`);
    mkdirSync(stepDir, { recursive: true });

    const logPath = path.join(stepDir, 'log.json');
    const diffPath = path.join(stepDir, 'diff.json');
    const reportPath = path.join(stepDir, 'report.json');

    writeFileSync(logPath, JSON.stringify({ step: stepRecord, result }, null, 2));
    writeFileSync(diffPath, JSON.stringify({ diff: result.data && 'stdout' in result.data ? result.data.stdout : null }, null, 2));
    writeFileSync(reportPath, JSON.stringify({ verified: verification.verified, evidence: verification.evidence }, null, 2));

    return [
      this.database.createArtifact(stepRecord.id, 'log', logPath, { verified: verification.verified }),
      this.database.createArtifact(stepRecord.id, 'diff', diffPath, { tool: stepRecord.tool }),
      this.database.createArtifact(stepRecord.id, 'report', reportPath, { evidence: verification.evidence }),
    ];
  }

  async runTask(taskId: string): Promise<RunSummary> {
    let task = this.database.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found.`);
    }

    const startedAt = Date.now();
    let iteration = 0;
    let lastPlan: Plan | null = null;
    let lastRunId = '';
    const createdArtifacts: ArtifactRecord[] = [];

    while (iteration < this.config.limits.max_iterations) {
      iteration += 1;
      if (task.state === 'retryable') {
        task = this.transitionTask(task, 'planning');
      } else if (task.state === 'queued') {
        task = this.transitionTask(task, 'planning');
      }

      const run = this.database.createRun(task.id, iteration);
      lastRunId = run.id;
      this.logger.info({ taskId: task.id, runId: run.id, iteration }, 'run_started');

      const plan = this.planner.generate({ goal: task.goal, state: task.state, memory: this.memory.getContext() });
      lastPlan = plan;
      task = this.transitionTask(task, 'validating');
      const validation = this.critic.validate(plan, [...this.tools.keys()]);

      if (!validation.valid || !validation.plan) {
        this.metrics.recordFailure('plan_validation');
        this.memory.recordFailure(`plan:${run.id}`, { reason: validation.reason });
        this.database.finishRun(run.id, 'failed');
        task = this.database.updateTaskState(task.id, 'failed');
        const decision = this.supervisor.decide({ hadFailure: true, iteration, maxIterations: this.config.limits.max_iterations });
        if (decision === 'retry') {
          this.metrics.recordRetry();
          task = this.transitionTask(task, 'retryable');
          continue;
        }

        task = this.transitionTask(task, 'escalated');
        break;
      }

      task = this.transitionTask(task, 'executing');
      let hadFailure = false;
      let verifiedSteps = 0;
      const failures: string[] = [];

      for (const [index, step] of validation.plan.steps.entries()) {
        const gate = this.policy.evaluateStep(step, {
          startedAt,
          completedSteps: index,
          changedFiles: this.changedFiles.size,
          iteration,
        });

        const stepRecord = this.database.createStep(run.id, index, step.tool, step.input, gate.allowed ? 'started' : 'blocked');

        if (!gate.allowed) {
          hadFailure = true;
          failures.push(gate.reason ?? 'Policy blocked execution.');
          this.database.completeStep(stepRecord.id, { gate }, 'failed');
          createdArtifacts.push(...this.createArtifacts(stepRecord, { verified: false, evidence: gate.reason ?? 'Policy blocked execution.' }, { success: false, error: gate.reason }));
          break;
        }

        const result = (await this.executor.run(step, (tool, input) => executeTool(this.tools, tool, input))) as ToolResult;
        const verification = this.verifier.check(step, result);
        this.database.completeStep(stepRecord.id, { result, verification }, verification.verified ? 'completed' : 'failed');
        createdArtifacts.push(...this.createArtifacts(stepRecord, verification, result));

        if (result.changedFiles) {
          for (const changedFile of result.changedFiles) {
            this.changedFiles.add(changedFile);
          }
        }

        if (verification.verified) {
          verifiedSteps += 1;
          this.memory.recordSuccessfulPattern(step.tool, { input: step.input, timestamp: new Date().toISOString() });
        } else {
          hadFailure = true;
          failures.push(verification.evidence);
          this.memory.recordFailure(`step:${stepRecord.id}`, { tool: step.tool, error: verification.evidence });
          break;
        }
      }

      task = this.transitionTask(task, 'verifying');
      const evaluation = this.evaluator.evaluate({ totalSteps: validation.plan.steps.length, verifiedSteps, failures });
      this.database.createEvaluation(run.id, evaluation.score, evaluation.issues, evaluation.suggestions);
      this.memory.recordRun(run.id, { score: evaluation.score, failures });

      if (hadFailure) {
        this.metrics.recordFailure(failures[0] ?? 'execution_failure');
        this.database.finishRun(run.id, 'failed');
        task = this.database.updateTaskState(task.id, 'failed');
        const decision = this.supervisor.decide({ hadFailure: true, iteration, maxIterations: this.config.limits.max_iterations });
        if (decision === 'retry') {
          this.metrics.recordRetry();
          task = this.transitionTask(task, 'retryable');
          continue;
        }

        task = this.transitionTask(task, 'escalated');
        this.metrics.recordRun(false, validation.plan.steps.length);
        break;
      }

      this.database.finishRun(run.id, 'completed');
      task = this.transitionTask(task, 'completed');
      this.metrics.recordRun(true, validation.plan.steps.length);
      break;
    }

    if (!lastPlan) {
      throw new Error('Planner did not produce a plan.');
    }

    const refreshedTask = this.database.getTask(task.id)!;
    return {
      task: refreshedTask,
      runId: lastRunId,
      state: refreshedTask.state,
      plan: lastPlan,
      artifacts: createdArtifacts,
      metrics: this.metrics.snapshot(),
    };
  }
}
