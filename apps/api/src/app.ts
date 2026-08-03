import type { PrismaClient } from '@deal-finder/db';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env } from './env';
import { attachUser, createDevAuthStrategy } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { requestContext } from './middleware/request-context';
import { createAlertsRouter } from './routes/alerts.routes';
import { createCanonicalProductsRouter } from './routes/canonical-products.routes';
import { createDashboardRouter } from './routes/dashboard.routes';
import { createDealsRouter } from './routes/deals.routes';
import { createHealthRouter } from './routes/health.routes';
import { createMatchCandidatesRouter } from './routes/match-candidates.routes';
import { createMetaRouter } from './routes/meta.routes';
import { createProductsRouter } from './routes/products.routes';
import { createSavedSearchesRouter } from './routes/saved-searches.routes';
import { createSettingsRouter } from './routes/settings.routes';
import { createWatchlistRouter } from './routes/watchlist.routes';

/**
 * Express application factory.
 *
 * Separated from server startup so integration tests can mount the real app
 * with supertest — same middleware, same validation, same error handling —
 * without binding a port or starting the cron scheduler.
 */
export function createApp(prisma: PrismaClient): Express {
  const app = express();

  // Trust the first proxy hop so rate limiting and logging see real client IPs
  // behind a load balancer, without trusting an arbitrary XFF chain.
  app.set('trust proxy', 1);
  // Predictable array/nested query parsing regardless of Express defaults.
  app.set('query parser', 'extended');
  app.disable('x-powered-by');

  app.use(requestContext);

  app.use(
    helmet({
      // The API serves JSON only; a restrictive default CSP is appropriate and
      // costs nothing here.
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Allow same-origin/non-browser callers (curl, tests) which send no Origin.
        if (!origin || env.CORS_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${origin} is not permitted by CORS_ORIGINS.`));
      },
      credentials: true,
      exposedHeaders: ['x-request-id'],
    }),
  );

  // Cap body size: nothing this API accepts is large, and an unbounded body is
  // a trivial denial-of-service vector.
  app.use(express.json({ limit: '64kb' }));

  app.use(
    '/api',
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      // Health checks must not be able to exhaust a monitor's budget.
      skip: (req) => req.path.startsWith('/health'),
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
    }),
  );

  // Resolves req.user when possible; individual routers decide whether a user
  // is required. Browsing deals works anonymously.
  app.use(attachUser(createDevAuthStrategy(prisma)));

  app.use('/api/health', createHealthRouter(prisma));
  app.use('/api/meta', createMetaRouter(prisma));
  app.use('/api/deals', createDealsRouter(prisma));
  app.use('/api/products', createProductsRouter(prisma));
  app.use('/api/canonical-products', createCanonicalProductsRouter(prisma));
  app.use('/api/match-candidates', createMatchCandidatesRouter(prisma));
  app.use('/api/watchlist', createWatchlistRouter(prisma));
  app.use('/api/saved-searches', createSavedSearchesRouter(prisma));
  app.use('/api/dashboard', createDashboardRouter(prisma));
  app.use('/api/settings', createSettingsRouter(prisma));
  app.use('/api/alerts', createAlertsRouter(prisma));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
