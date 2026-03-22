export type DomainErrorCode =
  | 'not_found'
  | 'conflict'
  | 'invalid_operation'
  | 'validation'
  | 'approval_required';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('not_found', message, details);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('conflict', message, details);
  }
}

export class InvalidOperationError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('invalid_operation', message, details);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('validation', message, details);
  }
}

export class ApprovalRequiredError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('approval_required', message, details);
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
