import type { RunState, StepState, TaskState } from '../../domain';
import { InvalidOperationError } from '../../errors';

const taskTransitions: Record<TaskState, TaskState[]> = {
  queued: ['planning', 'cancelled'],
  planning: ['validating', 'failed', 'blocked', 'cancelled'],
  validating: ['executing', 'awaiting_approval', 'failed', 'blocked', 'cancelled'],
  executing: ['verifying', 'awaiting_approval', 'failed', 'blocked', 'cancelled'],
  awaiting_approval: ['queued', 'cancelled', 'blocked'],
  verifying: ['completed', 'failed', 'retryable', 'rolled_back', 'escalated', 'cancelled'],
  completed: [],
  failed: ['queued', 'retryable', 'escalated', 'rolled_back', 'cancelled'],
  retryable: ['queued', 'planning', 'escalated', 'cancelled'],
  blocked: ['queued', 'retryable', 'escalated', 'cancelled'],
  cancelled: ['queued'],
  rolled_back: [],
  escalated: ['queued', 'retryable', 'cancelled'],
};

const runTransitions: Record<RunState, RunState[]> = {
  queued: ['planning', 'cancelled'],
  planning: ['validating', 'failed', 'cancelled'],
  validating: ['executing', 'awaiting_approval', 'failed', 'cancelled'],
  executing: ['verifying', 'awaiting_approval', 'failed', 'cancelled'],
  awaiting_approval: ['queued', 'cancelled'],
  verifying: ['completed', 'failed', 'escalated', 'cancelled'],
  completed: [],
  failed: ['queued', 'escalated', 'cancelled'],
  cancelled: [],
  escalated: [],
};

const stepTransitions: Record<StepState, StepState[]> = {
  queued: ['started', 'awaiting_approval', 'blocked', 'cancelled'],
  started: ['completed', 'failed', 'awaiting_approval', 'cancelled'],
  awaiting_approval: ['queued', 'cancelled'],
  completed: [],
  failed: [],
  blocked: [],
  cancelled: [],
};

export function assertValidTaskTransition(from: TaskState, to: TaskState): void {
  if (!taskTransitions[from].includes(to)) {
    throw new InvalidOperationError(`Invalid task state transition: ${from} -> ${to}`, { from, to, entity: 'task' });
  }
}

export function assertValidRunTransition(from: RunState, to: RunState): void {
  if (!runTransitions[from].includes(to)) {
    throw new InvalidOperationError(`Invalid run state transition: ${from} -> ${to}`, { from, to, entity: 'run' });
  }
}

export function assertValidStepTransition(from: StepState, to: StepState): void {
  if (!stepTransitions[from].includes(to)) {
    throw new InvalidOperationError(`Invalid step state transition: ${from} -> ${to}`, { from, to, entity: 'step' });
  }
}
