import { Prisma } from '@deal-finder/db';
import type { ApiError as ApiErrorPayload } from '@deal-finder/shared';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../env';
import { ApiError } from '../errors';
import { logger } from '../logger';

/**
 * The single place an error becomes an HTTP response.
 *
 * Every failure — thrown `ApiError`, Zod issue, Prisma error, or an unexpected
 * bug — leaves through here and produces the same envelope, so clients have
 * exactly one error shape to handle. Internal details are logged, never
 * returned: a 500 tells the caller a request id and nothing about the
 * database.
 */

/** Maps Prisma's error codes onto meaningful HTTP status codes. */
function fromPrismaError(error: Prisma.PrismaClientKnownRequestError): ApiError {
  const target = (error.meta as { target?: string[] } | undefined)?.target;
  const field = Array.isArray(target) ? target.join(', ') : undefined;

  switch (error.code) {
    case 'P2002':
      return ApiError.conflict(
        field
          ? `A record with that ${field} already exists.`
          : 'That record already exists.',
      );
    case 'P2003':
      return ApiError.badRequest('A referenced record does not exist.');
    case 'P2025':
      return ApiError.notFound('The requested record');
    case 'P2000':
      return ApiError.badRequest('A provided value is too long for its field.');
    default:
      return new ApiError(500, 'DATABASE_ERROR', 'A database error occurred.', {
        expected: false,
        cause: error,
      });
  }
}

function normalise(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof z.ZodError) {
    return ApiError.badRequest('Validation failed.', {
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) return fromPrismaError(error);

  if (error instanceof Prisma.PrismaClientValidationError) {
    return ApiError.badRequest('The request did not match what the database expects.');
  }

  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Error && /ECONNREFUSED|ENOTFOUND/.test(error.message))
  ) {
    return ApiError.serviceUnavailable(
      'The database is unavailable. Start it with `npm run db:dev`.',
    );
  }

  // Malformed JSON bodies surface as a SyntaxError from express.json().
  if (error instanceof SyntaxError && 'body' in error) {
    return ApiError.badRequest('The request body is not valid JSON.');
  }

  return ApiError.internal('An unexpected error occurred.', error);
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  // Required by Express to recognise this as an error handler, even unused.
  _next: NextFunction,
): void {
  const apiError = normalise(error);
  const requestId = req.requestId;

  const context = {
    requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode: apiError.statusCode,
    code: apiError.code,
  };

  if (apiError.expected) {
    logger.warn({ ...context, message: apiError.message }, 'Request failed');
  } else {
    // Unexpected failures get the stack and the original cause.
    logger.error({ ...context, err: error }, 'Unhandled request error');
  }

  const payload: ApiErrorPayload = {
    error: {
      code: apiError.code,
      // A 500's real message may contain internals; keep it generic outside dev.
      message:
        apiError.expected || env.NODE_ENV !== 'production'
          ? apiError.message
          : 'An unexpected error occurred.',
      ...(apiError.details !== undefined ? { details: apiError.details } : {}),
      ...(requestId ? { requestId } : {}),
    },
  };

  if (res.headersSent) {
    // Too late for a body — end the response rather than crashing the process.
    res.end();
    return;
  }

  res.status(apiError.statusCode).json(payload);
}

/** Terminal 404 for unmatched routes, so they use the same envelope. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new ApiError(404, 'NOT_FOUND', `No route matches ${req.method} ${req.originalUrl}.`));
}
