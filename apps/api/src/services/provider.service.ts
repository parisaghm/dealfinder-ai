import {
  createProviderRegistry,
  type ProviderRegistry,
} from '@deal-finder/store-providers';
import { env } from '../env';
import { logger } from '../logger';
import type { PriceFetcher, PriceObservation } from './monitoring.service';

/**
 * The application's provider registry, configured from the environment.
 *
 * One instance per process: adapters may hold resources (in live mode, a
 * browser), so they must not be constructed per request.
 */

let registry: ProviderRegistry | undefined;

/**
 * Load and register the live adapters.
 *
 * A dynamic import, called only when `PROVIDER_MODE=live`, so a default
 * installation never loads Playwright and never makes an outbound request.
 * Must be awaited before `getProviderRegistry()` in live mode.
 */
export async function initialiseProviders(): Promise<void> {
  if (env.PROVIDER_MODE !== 'live') return;

  logger.warn(
    'PROVIDER_MODE=live — loading live store adapters. You are responsible for complying with each site\'s terms of service, robots.txt and rate limits. See docs/legal-and-ethics.md.',
  );
  await import('@deal-finder/store-providers/live/index');
}

export function getProviderRegistry(): ProviderRegistry {
  if (registry) return registry;

  registry = createProviderRegistry({
    mode: env.PROVIDER_MODE,
    timeoutMs: env.PROVIDER_TIMEOUT_MS,
    maxRetries: env.PROVIDER_MAX_RETRIES,
    maxConcurrency: env.PROVIDER_MAX_CONCURRENCY,
    mock: {
      minLatencyMs: env.PROVIDER_MOCK_MIN_LATENCY_MS,
      maxLatencyMs: env.PROVIDER_MOCK_MAX_LATENCY_MS,
      failureRate: env.PROVIDER_MOCK_FAILURE_RATE,
    },
    logger: {
      warn: (message, context) => logger.warn(context ?? {}, message),
      debug: (message, context) => logger.debug(context ?? {}, message),
    },
  });

  logger.info(
    { mode: registry.mode, stores: registry.list().map((provider) => provider.slug) },
    'Store providers ready',
  );

  return registry;
}

/**
 * A `PriceFetcher` backed by the registry, for the monitoring job.
 *
 * Returns null rather than throwing when a store is simply not configured, so
 * the monitor records it as a skipped item instead of a failure.
 */
export function createProviderPriceFetcher(): PriceFetcher {
  return async (product): Promise<PriceObservation | null> => {
    const provider = getProviderRegistry().get(product.storeSlug);
    if (!provider) {
      logger.warn({ store: product.storeSlug }, 'No provider registered for store');
      return null;
    }

    const details = await provider.getProductDetails(product.productUrl);

    return {
      currentPrice: details.currentPrice,
      originalPrice: details.originalPrice ?? null,
      shippingPrice: details.shippingPrice ?? null,
      availability: details.availability,
    };
  };
}

/** Test hook: drop the memoised registry. */
export function resetProviderRegistry(): void {
  registry = undefined;
}
