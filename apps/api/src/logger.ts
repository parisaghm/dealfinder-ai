import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { env, isProduction } from './env';

/**
 * Structured logging.
 *
 * JSON in production so logs are queryable; human-readable when developing.
 * Every request gets an id that is attached to its log lines *and* returned in
 * error responses, so a user-reported failure can be traced to the exact
 * request without asking them to reproduce it.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'deal-finder-api' },
  redact: {
    // Never log credentials or tokens, however they arrive.
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'SMTP_PASSWORD',
      'DATABASE_URL',
    ],
    censor: '[redacted]',
  },
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
      },
});

export type Logger = typeof logger;

export function newRequestId(): string {
  return randomUUID();
}
