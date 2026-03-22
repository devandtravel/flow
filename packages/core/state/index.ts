import type { RunState, StepState, TaskState } from '../../domain';
import { InvalidOperationError } from '../../errors';

const taskTransitions: Record<TaskState, TaskState[]> = {
  queued: ['planning', 'cancelled'],
  planning: ['validating', 'failed', 'blocked'],
  validating: ['executing', 'awaiting_approval', 'failed', 'blocked'],
  executing: ['verifying', 'awaiting_approval', 'failed', 'blocked'],
  awaiting_approval: ['queued', 'cancelled', 'blocked'],
  verifying: ['completed', 'failed', 'retryable', 'rolled_back', 'escalated'],
  completed: [],
  failed: ['retryable', 'escalated', 'rolled_back'],
  retryable: ['planning', 'escalated'],
  blocked: ['retryable', 'escalated', 'cancelled'],
  cancelled: [],
  rolled_back: [],
  escalated: [],
};

const runTransitions: Record<RunState, RunState[]> = {
  queued: ['planning', 'cancelled'],
  planning: ['validating', 'failed'],
  validating: ['executing', 'awaiting_approval', 'failed'],
  executing: ['verifying', 'awaiting_approval', 'failed'],
  awaiting_approval: ['queued', 'cancelled'],
  verifying: ['completed', 'failed', 'escalated'],
  completed: [],
  failed: ['queued', 'escalated', 'cancelled'],
  cancelled: [],
  escalated: [],
};

const stepTransitions: Record<StepState, StepState[]> = {
  queued: ['started', 'awaiting_approval', 'blocked', 'cancelled'],
  started: ['completed', 'failed', 'awaiting_approval'],
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
