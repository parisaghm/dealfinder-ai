import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { ApiError } from '../errors';

/**
 * Request validation.
 *
 * Handlers receive parsed, typed, defaulted data instead of `unknown` — and
 * a malformed request is rejected with a precise 400 before it reaches any
 * business logic. The parsed result replaces the raw input, so coercions
 * (`"24"` → `24`) and defaults declared in the schema are what handlers see.
 */

type RequestPart = 'query' | 'body' | 'params';

/** Where a validated payload is stashed, since Express 5 makes `query` a getter. */
export const VALIDATED = Symbol('validated');

interface ValidatedRequest extends Request {
  [VALIDATED]?: Partial<Record<RequestPart, unknown>>;
}

export function validate<TSchema extends z.ZodTypeAny>(schema: TSchema, part: RequestPart = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);

    if (!result.success) {
      next(
        ApiError.badRequest(`Invalid request ${part}.`, {
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
          })),
        }),
      );
      return;
    }

    const request = req as ValidatedRequest;
    request[VALIDATED] = { ...request[VALIDATED], [part]: result.data };
    next();
  };
}

/**
 * Read what `validate` produced.
 *
 * Throws rather than returning undefined: reaching a handler without its
 * validated payload means the middleware was not wired up, which is a
 * programming error that should surface immediately, not a runtime condition
 * to handle.
 */
export function validated<T>(req: Request, part: RequestPart = 'body'): T {
  const value = (req as ValidatedRequest)[VALIDATED]?.[part];
  if (value === undefined) {
    throw ApiError.internal(`Route is missing validate(schema, '${part}') middleware.`);
  }
  return value as T;
}
