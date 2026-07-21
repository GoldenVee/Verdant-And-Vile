// Structured error codes and the AppError type. The Fastify error handler turns
// these into responses shaped { error: { code, message, details? } }.
//
// This is the code-side mirror of docs/errors.md. Keep the two in sync: a new code
// here should get a row there.

export const ERROR_CODES = {
  // Request/validation layer
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  // Feature not yet built (combination pipeline is stubbed)
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  // Generic fallback
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// Application error carrying an HTTP status, a stable machine code, and optional
// structured details. Thrown anywhere in the request path; the Fastify error
// handler serializes it.
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  toBody(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }

  static notFound(message: string, details?: unknown): AppError {
    return new AppError(404, ERROR_CODES.NOT_FOUND, message, details);
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError(400, ERROR_CODES.VALIDATION_ERROR, message, details);
  }
}
