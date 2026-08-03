import type { NextFunction, Request, Response } from 'express';
import { logger, newRequestId } from '../logger';

/**
 * Assigns each request an id, echoes it back, and logs one line per completed
 * request with its duration.
 *
 * The id is the thread that ties an error a user saw to the server logs, so it
 * is generated before anything else can fail and returned on both success and
 * failure responses.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id')?.trim();
  const requestId = incoming && incoming.length <= 64 ? incoming : newRequestId();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const context = {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
    };

    // Health checks are frequent and uninteresting; keep them at debug level.
    if (req.originalUrl.startsWith('/api/health')) {
      logger.debug(context, 'request');
    } else if (res.statusCode >= 500) {
      logger.error(context, 'request');
    } else {
      logger.info(context, 'request');
    }
  });

  next();
}
