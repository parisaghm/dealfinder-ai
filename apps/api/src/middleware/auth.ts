import type { PrismaClient } from '@deal-finder/db';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../env';
import { ApiError } from '../errors';

/**
 * Development authentication.
 *
 * The MVP intentionally has no login. Every request resolves to a single
 * development user, either from an `x-user-email` header (so the API can be
 * exercised as different users) or from `DEV_USER_EMAIL`.
 *
 * The point of this file is the *seam*, not the implementation. Everything
 * downstream depends only on `req.user` being populated by an
 * `AuthenticationStrategy`. Adding Auth.js, Clerk, Firebase or Supabase Auth
 * later means writing one more strategy that verifies a token and looks up the
 * user — no route, service or query needs to change.
 *
 * This must never be used in production: it trusts a client-supplied header.
 * `assertAuthNotInsecure` refuses to start a production server with it enabled.
 */

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      requestId?: string;
    }
  }
}

export interface AuthenticationStrategy {
  readonly name: string;
  /** Resolve the caller, or return null when unauthenticated. */
  authenticate(req: Request): Promise<AuthenticatedUser | null>;
}

/**
 * Resolves (and, on first use, provisions) the single development user.
 *
 * Auto-provisioning keeps a fresh clone usable before `db:seed` has been run.
 */
export function createDevAuthStrategy(prisma: PrismaClient): AuthenticationStrategy {
  return {
    name: 'dev-header',

    async authenticate(req: Request): Promise<AuthenticatedUser | null> {
      const header = req.header('x-user-email')?.trim().toLowerCase();
      const email = header && header.length > 0 ? header : env.DEV_USER_EMAIL;

      const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, name: true },
      });
      if (existing) return existing;

      // Only auto-create the configured development user; an arbitrary header
      // value must not be able to create accounts.
      if (email !== env.DEV_USER_EMAIL) return null;

      const created = await prisma.user.create({
        data: {
          email,
          name: env.DEV_USER_NAME,
          settings: { create: {} },
        },
        select: { id: true, email: true, name: true },
      });
      return created;
    },
  };
}

/** Populates `req.user` when the strategy recognises the caller. */
export function attachUser(strategy: AuthenticationStrategy) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await strategy.authenticate(req);
      if (user) req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Guards routes that operate on a specific user's data. */
export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(
      ApiError.unauthorized(
        'No user could be resolved for this request. Set the x-user-email header to a known user, or run `npm run db:seed`.',
      ),
    );
    return;
  }
  next();
}

/** Convenience accessor for handlers that run behind `requireUser`. */
export function currentUser(req: Request): AuthenticatedUser {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

/**
 * Refuses to run header-trusting auth in production.
 *
 * Called during startup. Shipping the development strategy to production would
 * let anyone act as any user by setting a header, so this is a hard failure
 * rather than a warning.
 */
export function assertAuthNotInsecure(): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to start: the development authentication strategy trusts the x-user-email header and must not run in production. Replace it with a real provider (see apps/api/src/middleware/auth.ts).',
    );
  }
}
