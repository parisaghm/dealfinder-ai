import type { PrismaClient } from '@deal-finder/db';
import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../env';
import { logger } from '../logger';
import { runPriceCheck, type MonitoringRunSummary } from '../services/monitoring.service';
import { createProviderPriceFetcher } from '../services/provider.service';

/**
 * The cron scheduler.
 *
 * Schedule and batch size come from the environment (`MONITOR_CRON`,
 * `MONITOR_BATCH_SIZE`), and the expression is validated at boot so a typo
 * fails loudly instead of silently never firing.
 *
 * A re-entrancy guard prevents overlapping runs: if a check is slower than the
 * interval, the next tick is skipped rather than doubling the load on every
 * store and racing on the same rows.
 */

let task: ScheduledTask | undefined;
let running = false;

export interface Scheduler {
  stop(): Promise<void>;
  /** Run immediately, outside the schedule. Used by tests and diagnostics. */
  runNow(): Promise<MonitoringRunSummary | null>;
}

export function startScheduler(prisma: PrismaClient): Scheduler {
  const fetchPrice = createProviderPriceFetcher();

  const execute = async (trigger: 'cron' | 'manual'): Promise<MonitoringRunSummary | null> => {
    if (running) {
      logger.warn({ trigger }, 'Price check already in progress; skipping this tick');
      return null;
    }

    running = true;
    try {
      const summary = await runPriceCheck({ prisma, fetchPrice });

      logger.info(
        {
          trigger,
          checked: summary.checked,
          priceChanges: summary.priceChanges,
          alertsSent: summary.alertsSent,
          alertsSuppressed: summary.alertsSuppressed,
          skipped: summary.skipped,
          failures: summary.failures.length,
          durationMs: summary.durationMs,
        },
        'Price check complete',
      );

      // Provider errors are logged but never rethrown: the schedule must keep
      // running even if every store failed this time.
      for (const failure of summary.failures) {
        logger.warn(failure, 'Price check failure');
      }

      return summary;
    } catch (error) {
      // A crash here would kill the timer and silently end all monitoring.
      logger.error({ err: error, trigger }, 'Price check run failed');
      return null;
    } finally {
      running = false;
    }
  };

  if (env.MONITOR_ENABLED) {
    task = cron.schedule(env.MONITOR_CRON, () => void execute('cron'), { timezone: env.TZ });
    logger.info(
      { cron: env.MONITOR_CRON, timezone: env.TZ, batchSize: env.MONITOR_BATCH_SIZE },
      'Price monitoring scheduled',
    );
  } else {
    logger.warn('Price monitoring is disabled (MONITOR_ENABLED=false)');
  }

  return {
    async stop() {
      if (task) {
        await task.stop();
        task = undefined;
        logger.info('Price monitoring stopped');
      }
    },
    runNow: () => execute('manual'),
  };
}
