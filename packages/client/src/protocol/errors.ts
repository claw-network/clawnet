import type { ProblemDetail } from './types.js';

const ERROR_BASE_URL = 'https://telagent.org/errors';

export const ErrorCodes = {
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNPROCESSABLE: 'UNPROCESSABLE_ENTITY',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

const ERROR_TYPE_MAP: Record<ErrorCode, string> = {
  VALIDATION_ERROR: `${ERROR_BASE_URL}/validation-error`,
  UNAUTHORIZED: `${ERROR_BASE_URL}/unauthorized`,
  FORBIDDEN: `${ERROR_BASE_URL}/forbidden`,
  NOT_FOUND: `${ERROR_BASE_URL}/not-found`,
  CONFLICT: `${ERROR_BASE_URL}/conflict`,
  UNPROCESSABLE_ENTITY: `${ERROR_BASE_URL}/unprocessable-entity`,
  TOO_MANY_REQUESTS: `${ERROR_BASE_URL}/too-many-requests`,
  INTERNAL_ERROR: `${ERROR_BASE_URL}/internal-error`,
};

const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
};

export class TelagentError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.status = ERROR_STATUS_MAP[code];
  }

  toProblem(instance?: string): ProblemDetail {
    return {
      type: ERROR_TYPE_MAP[this.code],
      title: this.titleFromCode(),
      status: this.status,
      detail: this.message,
      instance,
      code: this.code,
    };
  }

  private titleFromCode(): string {
    switch (this.code) {
      case ErrorCodes.VALIDATION:
        return 'Bad Request';
      case ErrorCodes.UNAUTHORIZED:
        return 'Unauthorized';
      case ErrorCodes.FORBIDDEN:
        return 'Forbidden';
      case ErrorCodes.NOT_FOUND:
        return 'Not Found';
      case ErrorCodes.CONFLICT:
        return 'Conflict';
      case ErrorCodes.UNPROCESSABLE:
        return 'Unprocessable Entity';
      case ErrorCodes.TOO_MANY_REQUESTS:
        return 'Too Many Requests';
      default:
        return 'Internal Server Error';
    }
  }
}

export function asProblemDetail(error: unknown, instance?: string): ProblemDetail {
  if (error instanceof TelagentError) {
    return error.toProblem(instance);
  }
  const detail = error instanceof Error ? error.message : 'Unexpected error';
  return {
    type: ERROR_TYPE_MAP.INTERNAL_ERROR,
    title: 'Internal Server Error',
    status: 500,
    detail,
    instance,
    code: ErrorCodes.INTERNAL,
  };
}
