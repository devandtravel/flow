import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function extractJsonObjectCandidates(text: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (let start = text.lastIndexOf('{'); start >= 0; start = text.lastIndexOf('{', start - 1)) {
    const candidate = findJsonObjectAt(text, start);
    if (!candidate || seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    candidates.push(candidate);
  }

  return candidates;
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

function getStructuredOutputCandidates(
  outputPath: string,
  execution: { stdout: string; stderr: string },
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  if (existsSync(outputPath)) {
    const outputFileContent = readFileSync(outputPath, 'utf8');
    if (outputFileContent.length > 0) {
      candidates.push(outputFileContent);
      seen.add(outputFileContent);
    }
  }

  for (const candidate of extractJsonObjectCandidates(execution.stdout)) {
    if (seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    candidates.push(candidate);
  }

  for (const candidate of extractJsonObjectCandidates(execution.stderr)) {
    if (seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    candidates.push(candidate);
  }

  return candidates;
}

function matchesContractSignature(contract: LlmContract, value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  if (contract === 'task_plan') {
    return 'goal' in value && 'steps' in value && 'done' in value && 'confidence' in value;
  }

  if (contract === 'critic_review') {
    return 'valid' in value && 'feedback' in value && 'plan' in value;
  }

  if (contract === 'supervisor_decision') {
    return 'decision' in value && 'reason' in value;
  }

  return 'score' in value && 'issues' in value && 'suggestions' in value;
}

function buildStructuredOutputRetryPrompt(basePrompt: string): string {
  return [
    basePrompt,
    '',
    'The previous attempt did not satisfy the structured output contract.',
    'Return exactly one JSON object that matches the schema and do not add prose, commentary, or markdown.',
  ].join('\n');
}

function createIsolatedCodexHome(rootDirectory: string): string {
  const codexHome = path.join(rootDirectory, 'codex-home');
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(
    path.join(codexHome, 'config.toml'),
    [
      'approval_policy = "never"',
      'sandbox_mode = "read-only"',
      '[features]',
      'apps = false',
      'tui_app_server = false',
      'multi_agent = false',
    ].join('\n'),
    'utf8',
  );
  return codexHome;
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
      const codexHome = createIsolatedCodexHome(outputDirectory);
      const outputPath = path.join(outputDirectory, 'response.json');
      const schemaPath = path.join(outputDirectory, 'schema.json');
      writeFileSync(schemaPath, JSON.stringify(createJsonSchema(request.contract), null, 2));
      const prompt = attempt === 1 ? request.prompt : buildStructuredOutputRetryPrompt(request.prompt);
      const args = [
        'exec',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--ephemeral',
        '-c',
        'mcp_servers={}',
        '-c',
        'features.apps=false',
        '-c',
        'features.tui_app_server=false',
        '-c',
        'model_reasoning_effort="medium"',
        '--output-schema',
        schemaPath,
        '--output-last-message',
        outputPath,
        '--model',
        this.config.model,
        prompt,
      ];

      const execution = spawnSync(this.config.executable, args, {
        encoding: 'utf8',
        timeout: this.config.timeout_ms,
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
        },
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

      const rawCandidates = getStructuredOutputCandidates(outputPath, execution);
      if (rawCandidates.length === 0) {
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

      for (const raw of rawCandidates) {
        try {
          const parsed = JSON.parse(raw);
          if (!matchesContractSignature(request.contract, parsed)) {
            continue;
          }
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
        }
      }

      lastError = new InvalidOperationError('Codex completed without a contract-matching structured response.', {
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

    throw lastError ?? new InvalidOperationError('Codex provider failed without an explicit error.');
  }
}

export function createLlmProvider(config: RuntimeConfig['llm']): LlmProvider {
  if (config.provider === 'mock') {
    return new MockLlmProvider();
  }

  return new CodexProvider(config);
}
