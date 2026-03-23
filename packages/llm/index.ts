import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import type { RuntimeConfig } from '../config';
import type { TaskPlan, ToolStep } from '../domain';
import { InvalidOperationError } from '../errors';
import {
  createJsonSchema,
  encodeTaskPlanResponse,
} from './contracts';

export const llmContractSchema = z.enum(['task_plan', 'critic_review', 'supervisor_decision', 'evaluation']);
export type LlmContract = z.infer<typeof llmContractSchema>;

export interface LlmRequest<TOutput> {
  prompt: string;
  schema: z.ZodType<TOutput>;
  contract: LlmContract;
}

export interface LlmProvider {
  complete<TOutput>(request: LlmRequest<TOutput>): Promise<TOutput>;
}

export function extractJsonObjectFromStdout(stdout: string): string | undefined {
  const lineCandidates = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = lineCandidates.length - 1; index >= 0; index -= 1) {
    const candidate = lineCandidates[index];
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  const blockCandidate = extractLastJsonObjectCandidate(stdout);
  if (!blockCandidate) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(blockCandidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return blockCandidate;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function extractLastJsonObjectCandidate(text: string): string | undefined {
  for (let start = text.lastIndexOf('{'); start >= 0; start = text.lastIndexOf('{', start - 1)) {
    const candidate = findJsonObjectAt(text, start);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function findJsonObjectAt(text: string, startIndex: number): string | undefined {
  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === '\\') {
        isEscaped = true;
        continue;
      }

      if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{') {
      depth += 1;
      continue;
    }

    if (character !== '}') {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return text.slice(startIndex, index + 1).trim();
    }
  }

  return undefined;
}

function getStructuredOutputCandidate(
  outputPath: string,
  execution: { stdout: string; stderr: string },
): string {
  if (existsSync(outputPath)) {
    return readFileSync(outputPath, 'utf8');
  }

  return extractJsonObjectFromStdout(execution.stdout) ?? extractJsonObjectFromStdout(execution.stderr) ?? '';
}

function createHeuristicPlan(goal: string): TaskPlan {
  const normalizedGoal = goal.toLowerCase();
  const steps: ToolStep[] = [];

  if (normalizedGoal.includes('write') || normalizedGoal.includes('create file')) {
    steps.push({
      tool: 'fs.write_file',
      input: {
        path: 'agent-output.txt',
        content: `generated for: ${goal}`,
      },
      expected: { changed: true },
      rationale: 'Persist the requested output inside the workspace.',
    });
  } else if (normalizedGoal.includes('commit')) {
    steps.push({
      tool: 'git.commit',
      input: {
        message: `flow: ${goal}`,
      },
      expected: { success: true },
      rationale: 'Record the requested repository change.',
    });
  } else if (normalizedGoal.includes('shell')) {
    steps.push({
      tool: 'shell.exec',
      input: {
        command: 'pwd',
        args: [],
      },
      expected: { success: true },
      rationale: 'Run the explicitly requested shell command.',
    });
  } else if (normalizedGoal.includes('test')) {
    steps.push({
      tool: 'repo.run_tests',
      input: {},
      expected: { success: true },
      rationale: 'Verify repository correctness with tests.',
    });
  } else if (normalizedGoal.includes('build')) {
    steps.push({
      tool: 'repo.build',
      input: {},
      expected: { success: true },
      rationale: 'Produce build artifacts for the repository.',
    });
  } else if (normalizedGoal.includes('fetch') || normalizedGoal.includes('http')) {
    steps.push({
      tool: 'http.fetch',
      input: {
        url: 'https://example.com',
        method: 'GET',
      },
      expected: { success: true },
      rationale: 'Retrieve the requested network resource through the allowlist.',
    });
  } else {
    steps.push({
      tool: 'fs.list_dir',
      input: { path: '.' },
      expected: { success: true },
      rationale: 'Start by observing the workspace before taking further action.',
    });
  }

  return {
    goal,
    assumptions: [],
    risks: [],
    steps,
    done: false,
    confidence: 0.8,
  };
}

export class MockLlmProvider implements LlmProvider {
  async complete<TOutput>(request: LlmRequest<TOutput>): Promise<TOutput> {
    if (request.prompt.includes('You are FLOW critic.')) {
      const planMatch = request.prompt.match(/Plan:\s*(.+)\nAvailableTools:/s);
      const parsedPlan = planMatch ? JSON.parse(planMatch[1]) : createHeuristicPlan('unknown goal');
      return request.schema.parse({
        valid: true,
        feedback: [],
        plan: encodeTaskPlanResponse(parsedPlan),
      });
    }

    if (request.prompt.includes('You are FLOW supervisor.')) {
      return request.schema.parse({
        decision: 'replan',
        reason: 'Retry with a refreshed plan.',
      });
    }

    if (request.prompt.includes('You are FLOW evaluator.')) {
      const totalStepsMatch = request.prompt.match(/TotalSteps:\s*(\d+)/);
      const verifiedStepsMatch = request.prompt.match(/VerifiedSteps:\s*(\d+)/);
      const totalSteps = totalStepsMatch ? Number(totalStepsMatch[1]) : 0;
      const verifiedSteps = verifiedStepsMatch ? Number(verifiedStepsMatch[1]) : 0;
      const score = totalSteps === 0 ? 0 : verifiedSteps / totalSteps;
      return request.schema.parse({
        score,
        issues: [],
        suggestions: verifiedSteps === totalSteps ? ['Reuse the successful procedural pattern.'] : ['Inspect the failed step and tighten the plan.'],
      });
    }

    const goalMatch = request.prompt.match(/Goal:\s*(.+)/i);
    const goal = goalMatch ? goalMatch[1].trim() : 'unknown goal';
    return request.schema.parse(encodeTaskPlanResponse(createHeuristicPlan(goal)));
  }
}

export class CodexProvider implements LlmProvider {
  constructor(private readonly config: RuntimeConfig['llm']) {}

  async complete<TOutput>(request: LlmRequest<TOutput>): Promise<TOutput> {
    const maxAttempts = Math.max(this.config.retry_count + 1, 1);
    let lastError: InvalidOperationError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const outputDirectory = mkdtempSync(path.join(os.tmpdir(), 'flow-codex-'));
      const outputPath = path.join(outputDirectory, 'response.json');
      const schemaPath = path.join(outputDirectory, 'schema.json');
      writeFileSync(schemaPath, JSON.stringify(createJsonSchema(request.contract), null, 2));
      const args = [
        'exec',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--output-schema',
        schemaPath,
        '--output-last-message',
        outputPath,
        '--model',
        this.config.model,
        request.prompt,
      ];

      const execution = spawnSync(this.config.executable, args, {
        encoding: 'utf8',
        timeout: this.config.timeout_ms,
      });

      if (execution.status !== 0) {
        lastError = new InvalidOperationError(execution.stderr || execution.stdout || 'Codex execution failed.', {
          executable: this.config.executable,
          model: this.config.model,
          status: execution.status,
          stdout: execution.stdout,
          stderr: execution.stderr,
          attempt,
          maxAttempts,
        });
        if (attempt < maxAttempts) {
          continue;
        }
        throw lastError;
      }

      const raw = getStructuredOutputCandidate(outputPath, execution);
      if (raw.length === 0) {
        lastError = new InvalidOperationError('Codex completed without producing structured output.', {
          executable: this.config.executable,
          model: this.config.model,
          stdout: execution.stdout,
          stderr: execution.stderr,
          outputPath,
          attempt,
          maxAttempts,
        });
        if (attempt < maxAttempts) {
          continue;
        }
        throw lastError;
      }

      try {
        const parsed = JSON.parse(raw);
        return request.schema.parse(parsed);
      } catch (error) {
        lastError = new InvalidOperationError(
          error instanceof Error ? error.message : 'Codex returned invalid structured output.',
          {
            executable: this.config.executable,
            model: this.config.model,
            stdout: execution.stdout,
            stderr: execution.stderr,
            outputPath,
            raw,
            attempt,
            maxAttempts,
          },
        );
        if (attempt < maxAttempts) {
          continue;
        }
        throw lastError;
      }
    }

    throw lastError ?? new InvalidOperationError('Codex provider failed without an explicit error.');
  }
}

export function createLlmProvider(config: RuntimeConfig['llm']): LlmProvider {
  if (config.provider === 'mock') {
    return new MockLlmProvider();
  }

  return new CodexProvider(config);
}
