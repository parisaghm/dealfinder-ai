import { DEFAULT_VERTICAL_ID } from '@deal-finder/shared';
import { toProviderFailure } from './errors';
import { mapWithConcurrency, withRetry } from './http/retry';
import { gigantiDataset } from './mock/data/gigantti';
import { powerDataset } from './mock/data/power';
import { verkkokauppaDataset } from './mock/data/verkkokauppa';
import { createMockProvider, type MockProviderOptions } from './mock/mock-provider';
import type { MockStoreDataset } from './mock/types';
import {
  externalProductSchema,
  type ExternalProduct,
  type ProductSearchInput,
  type ProviderResult,
  type StoreProvider,
} from './types';

/**
 * The provider registry — the single place mock and live integrations are
 * chosen between, and the only part of the system that knows how many stores
 * exist.
 *
 * `PROVIDER_MODE=mock` (the default) uses the bundled catalogues and needs no
 * network access. `PROVIDER_MODE=live` swaps in the real adapters; read
 * docs/legal-and-ethics.md before enabling it.
 */

export const MOCK_DATASETS: readonly MockStoreDataset[] = [
  gigantiDataset,
  powerDataset,
  verkkokauppaDataset,
];

export type ProviderMode = 'mock' | 'live';

export interface RegistryOptions {
  mode?: ProviderMode;
  vertical?: string;
  mock?: MockProviderOptions;
  /** Provider timeout and retry budget, applied by `searchAllProviders`. */
  timeoutMs?: number;
  maxRetries?: number;
  maxConcurrency?: number;
  logger?: {
    warn: (message: string, context?: Record<string, unknown>) => void;
    debug?: (message: string, context?: Record<string, unknown>) => void;
  };
}

export function createProviderRegistry(options: RegistryOptions = {}) {
  const mode = options.mode ?? 'mock';
  const vertical = options.vertical ?? DEFAULT_VERTICAL_ID;

  const providers: StoreProvider[] =
    mode === 'live'
      ? // Live adapters are created lazily by ./live/index so that Playwright is
        // never imported — let alone launched — in the default mock mode.
        createLiveProviders(options)
      : MOCK_DATASETS.map((dataset) => createMockProvider(dataset, options.mock));

  const bySlug = new Map(providers.map((provider) => [provider.slug, provider]));

  return {
    mode,
    vertical,

    list(): StoreProvider[] {
      return [...providers];
    },

    get(slug: string): StoreProvider | undefined {
      return bySlug.get(slug);
    },

    /**
     * Query every requested store, isolating failures.
     *
     * A store being down must degrade the result set, not fail the request —
     * so each provider is wrapped and its outcome reported individually. The
     * caller decides what to do with partial results.
     */
    async searchAll(
      query: ProductSearchInput,
      storeSlugs?: readonly string[],
    ): Promise<Array<ProviderResult<ExternalProduct[]>>> {
      const selected =
        storeSlugs && storeSlugs.length > 0
          ? providers.filter((provider) => storeSlugs.includes(provider.slug))
          : providers;

      return mapWithConcurrency(selected, options.maxConcurrency ?? 3, async (provider) => {
        const startedAt = Date.now();
        try {
          const raw = await withRetry(() => provider.searchProducts(query), {
            maxRetries: options.maxRetries ?? 2,
            onRetry: (attempt, error, delayMs) =>
              options.logger?.warn('Retrying store provider', {
                provider: provider.slug,
                attempt,
                delayMs,
                error: error instanceof Error ? error.message : String(error),
              }),
          });

          // Providers are third parties: validate before the data is allowed
          // any further, and drop individual bad rows rather than the batch.
          const data: ExternalProduct[] = [];
          for (const candidate of raw) {
            const parsed = externalProductSchema.safeParse(candidate);
            if (parsed.success) {
              data.push(parsed.data as ExternalProduct);
            } else {
              options.logger?.warn('Discarded malformed product from provider', {
                provider: provider.slug,
                externalId: (candidate as { externalId?: string })?.externalId,
                issues: parsed.error.issues.map((issue) => issue.path.join('.')),
              });
            }
          }

          return {
            ok: true as const,
            provider: provider.slug,
            data,
            durationMs: Date.now() - startedAt,
          };
        } catch (error) {
          const failure = toProviderFailure(error, provider.name);
          options.logger?.warn('Store provider failed', {
            provider: provider.slug,
            kind: failure.kind,
            message: failure.message,
          });
          return {
            ok: false as const,
            provider: provider.slug,
            error: failure,
            durationMs: Date.now() - startedAt,
          };
        }
      });
    },
  };
}

export type ProviderRegistry = ReturnType<typeof createProviderRegistry>;

/**
 * Live adapters are resolved through a deferred import so the default mock mode
 * never loads Playwright. Populated by `registerLiveProviderFactory` from
 * ./live/index, which the API imports only when PROVIDER_MODE=live.
 */
type LiveProviderFactory = (options: RegistryOptions) => StoreProvider[];
let liveProviderFactory: LiveProviderFactory | undefined;

export function registerLiveProviderFactory(factory: LiveProviderFactory): void {
  liveProviderFactory = factory;
}

function createLiveProviders(options: RegistryOptions): StoreProvider[] {
  if (!liveProviderFactory) {
    throw new Error(
      'PROVIDER_MODE=live requires the live adapters to be registered. Import "@deal-finder/store-providers/live" during startup, and read docs/legal-and-ethics.md first.',
    );
  }
  return liveProviderFactory(options);
}
