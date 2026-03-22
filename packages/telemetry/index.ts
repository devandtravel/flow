import { mkdirSync } from 'node:fs';
import path from 'node:path';
import pino, { type Logger } from 'pino';

export interface MetricSnapshot {
  success_rate: number;
  avg_steps: number;
  retry_count: number;
  failure_types: Record<string, number>;
}

export class MetricsCollector {
  private completedRuns = 0;
  private successfulRuns = 0;
  private totalSteps = 0;
  private retries = 0;
  private readonly failureTypes = new Map<string, number>();

  recordRun(success: boolean, steps: number): void {
    this.completedRuns += 1;
    this.totalSteps += steps;
    if (success) {
      this.successfulRuns += 1;
    }
  }

  recordRetry(): void {
    this.retries += 1;
  }

  recordFailure(type: string): void {
    this.failureTypes.set(type, (this.failureTypes.get(type) ?? 0) + 1);
  }

  snapshot(): MetricSnapshot {
    return {
      success_rate: this.completedRuns === 0 ? 0 : this.successfulRuns / this.completedRuns,
      avg_steps: this.completedRuns === 0 ? 0 : this.totalSteps / this.completedRuns,
      retry_count: this.retries,
      failure_types: Object.fromEntries(this.failureTypes.entries()),
    };
  }
}

export function createLogger(logsDirectory: string): Logger {
  mkdirSync(logsDirectory, { recursive: true });
  const destination = path.join(logsDirectory, 'runtime.log');

  return pino(
    {
      level: 'info',
      base: undefined,
    },
    pino.destination(destination),
  );
}
