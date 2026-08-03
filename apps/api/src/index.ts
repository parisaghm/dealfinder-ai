import { disconnectPrisma, getPrismaClient } from '@deal-finder/db';
import { createApp } from './app';
import { env } from './env';
import { startScheduler, type Scheduler } from './jobs/scheduler';
import { logger } from './logger';
import { assertAuthNotInsecure } from './middleware/auth';
import { getProviderRegistry, initialiseProviders } from './services/provider.service';

/**
 * Server entry point.
 *
 * Boot order matters: validate the environment (done at import of ./env),
 * refuse to run insecure development auth in production, verify the database
 * is actually reachable, then start accepting traffic, and only then start the
 * scheduler. Starting the cron before the database is confirmed would produce
 * a burst of failing jobs at boot.
 */

async function main(): Promise<void> {
  assertAuthNotInsecure();

  const prisma = getPrismaClient();

  // Fail fast with an actionable message rather than serving 503s.
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    logger.error(
      { err: error },
      'Cannot reach the database. Start it with `npm run db:dev` and check DATABASE_URL in .env (use 127.0.0.1, not localhost).',
    );
    process.exit(1);
  }

  // In live mode this loads the Playwright-backed adapters. It is a deliberate,
  // legally significant choice, and it is logged as such.
  await initialiseProviders();
  getProviderRegistry();

  const app = createApp(prisma);

  const server = app.listen(env.API_PORT, env.API_HOST, () => {
    logger.info(
      {
        url: `http://localhost:${env.API_PORT}`,
        environment: env.NODE_ENV,
        providerMode: env.PROVIDER_MODE,
        emailTransport: env.EMAIL_TRANSPORT,
      },
      'DealFinder API listening',
    );
  });

  const scheduler: Scheduler = startScheduler(prisma);

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    // Stop the cron first so no new work starts, then drain HTTP, then release
    // the connection pool.
    await scheduler.stop();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Do not hang forever on a stuck keep-alive connection.
      setTimeout(() => resolve(), 10_000).unref();
    });

    await disconnectPrisma();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // A rejection that reaches here is a bug; log it with context rather than
  // letting Node print an opaque trace and exit.
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception — shutting down');
    void shutdown('uncaughtException');
  });
}

void main();
