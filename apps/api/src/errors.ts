/**
 * Application errors.
 *
 * Services throw these; one middleware turns them into the single JSON error
 * envelope defined in `@deal-finder/shared`. Route handlers never format an
 * error response themselves, which is what keeps the API's error shape
 * consistent across every endpoint.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  /** Expected failures are not logged as server faults. */
  readonly expected: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { details?: unknown; expected?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.expected = options.expected ?? statusCode < 500;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'BAD_REQUEST', message, { details });
  }

  static unauthorized(message = 'Authentication is required.'): ApiError {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static notFound(resource: string): ApiError {
    return new ApiError(404, 'NOT_FOUND', `${resource} was not found.`);
  }

  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError(409, 'CONFLICT', message, { details });
  }

  static unprocessable(message: string, details?: unknown): ApiError {
    return new ApiError(422, 'UNPROCESSABLE', message, { details });
  }

  static internal(message = 'An unexpected error occurred.', cause?: unknown): ApiError {
    return new ApiError(500, 'INTERNAL_ERROR', message, { cause, expected: false });
  }

  static serviceUnavailable(message: string): ApiError {
    return new ApiError(503, 'SERVICE_UNAVAILABLE', message, { expected: true });
  }
}
