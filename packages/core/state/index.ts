export const taskStates = [
  'queued',
  'planning',
  'validating',
  'executing',
  'verifying',
  'completed',
  'failed',
  'retryable',
  'escalated',
] as const;

export type TaskState = (typeof taskStates)[number];

const transitions: Record<TaskState, TaskState[]> = {
  queued: ['planning'],
  planning: ['validating'],
  validating: ['executing'],
  executing: ['verifying', 'failed'],
  verifying: ['completed'],
  completed: [],
  failed: ['retryable', 'escalated'],
  retryable: ['planning'],
  escalated: [],
};

export function assertValidTransition(from: TaskState, to: TaskState): void {
  if (!transitions[from].includes(to)) {
    throw new Error(`Invalid task state transition: ${from} -> ${to}`);
  }
}
