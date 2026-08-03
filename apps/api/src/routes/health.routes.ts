import type { PrismaClient } from '@deal-finder/db';
import { Router } from 'express';
import { env } from '../env';

/**
 * `GET /api/health`
 *
 * Actually checks the database with a trivial query rather than reporting "ok"
 * because the process is alive — a health check that cannot fail is worthless
 * to a load balancer. Returns 503 when a dependency is down.
 */
export function createHealthRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const startedAt = Date.now();
    let database: 'up' | 'down' = 'down';
    let databaseError: string | undefined;

    try {
      await prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch (error) {
      databaseError = error instanceof Error ? error.message : String(error);
    }

    const healthy = database === 'up';

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      checks: {
        database: { status: database, latencyMs: Date.now() - startedAt, ...(databaseError ? { error: databaseError } : {}) },
      },
      config: {
        environment: env.NODE_ENV,
        providerMode: env.PROVIDER_MODE,
        monitoringEnabled: env.MONITOR_ENABLED,
        monitorCron: env.MONITOR_CRON,
        emailTransport: env.EMAIL_TRANSPORT,
      },
    });
  });

  return router;
}
