import {
  calculateDiscountPercent,
  DEFAULT_VERTICAL_ID,
  type CountryCode,
  type Currency,
} from '@deal-finder/shared';
import { ProviderError, ProviderNotFoundError, ProviderUnsupportedDestinationError } from '../errors';
import type {
  DestinationContext,
  ExternalProduct,
  ExternalProductDetails,
  ExternalStoreOffer,
  ProductSearchInput,
  StoreProvider,
} from '../types';
import {
  datasetCountry,
  deliveryCountries,
  offersProductToDestination,
  resolveDelivery,
} from './delivery-rules';
import { generatePriceHistory } from './history';
import type { MockProductDefinition, MockStoreDataset } from './types';

/**
 * Builds a `StoreProvider` from a bundled sample catalogue.
 *
 * This is what makes the application fully usable — and fully testable —
 * without touching a live website. It is not a stub: it implements the same
 * interface, applies the same filters, validates the same way and can be told
 * to be slow or to fail, so error handling and loading states are exercised in
 * development rather than discovered in production.
 */

export interface MockProviderOptions {
  /** Simulated response latency range, in milliseconds. */
  minLatencyMs?: number;
  maxLatencyMs?: number;
  /**
   * Probability (0–1) that a call fails. Non-zero values let the API's
   * graceful-degradation path be exercised on demand.
   */
  failureRate?: number;
  /** Injectable clock, so seeded history is reproducible in tests. */
  now?: () => Date;
  /** Injectable randomness, so failure injection is deterministic in tests. */
  random?: () => number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toExternalProduct(
  dataset: MockStoreDataset,
  definition: MockProductDefinition,
): ExternalProduct {
  return {
    externalId: definition.externalId,
    name: definition.name,
    brand: definition.brand,
    category: definition.category,
    vertical: DEFAULT_VERTICAL_ID,
    imageUrl: `/images/products/${definition.category}.svg`,
    productUrl: dataset.productUrlTemplate.replace('{id}', definition.externalId),
    currentPrice: definition.currentPrice,
    originalPrice: definition.originalPrice ?? null,
    shippingPrice: definition.shippingPrice ?? null,
    // The store's own currency. Defaults to EUR, which is what the three original
    // Finnish datasets have always quoted in.
    currency: dataset.currency ?? 'EUR',
    availability: definition.availability ?? 'IN_STOCK',
    modelNumber: definition.modelNumber ?? null,
    gtin: definition.gtin ?? null,
    ean: definition.ean ?? null,
    mpn: definition.mpn ?? null,
    attributes: definition.attributes ?? null,
  };
}

/**
 * Filtering mirrors what the API asks a live provider for, so switching to a
 * live adapter does not change the observed behaviour of search.
 */
function matches(definition: MockProductDefinition, query: ProductSearchInput): boolean {
  if (query.category && definition.category !== query.category) return false;

  if (query.maximumPrice != null && definition.currentPrice > query.maximumPrice) return false;

  if (query.minimumDiscount != null) {
    const discount = calculateDiscountPercent(definition.currentPrice, definition.originalPrice);
    if (discount < query.minimumDiscount) return false;
  }

  const terms = query.query?.trim().toLowerCase();
  if (terms) {
    const haystack = `${definition.name} ${definition.brand} ${definition.category}`.toLowerCase();
    // Every whitespace-separated term must appear somewhere: "philips
    // headphones" should not match every pair of headphones.
    const allTermsPresent = terms
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => haystack.includes(term));
    if (!allTermsPresent) return false;
  }

  return true;
}

export function createMockProvider(
  dataset: MockStoreDataset,
  options: MockProviderOptions = {},
): StoreProvider {
  const minLatencyMs = options.minLatencyMs ?? 40;
  const maxLatencyMs = Math.max(minLatencyMs, options.maxLatencyMs ?? 180);
  const failureRate = Math.min(1, Math.max(0, options.failureRate ?? 0));
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;

  async function simulateNetwork(): Promise<void> {
    await delay(minLatencyMs + random() * (maxLatencyMs - minLatencyMs));
    if (failureRate > 0 && random() < failureRate) {
      throw new ProviderError(
        dataset.name,
        'network',
        `Simulated provider failure for ${dataset.name} (PROVIDER_MOCK_FAILURE_RATE is set).`,
        { retryable: true },
      );
    }
  }

  const storeCountry = datasetCountry(dataset);
  const currency: Currency = dataset.currency ?? 'EUR';
  const declaredDeliveryCountries = deliveryCountries(dataset);

  function findDefinition(url: string): MockProductDefinition | undefined {
    // Accept either a full product URL or a bare external id, so callers do not
    // have to reconstruct the store's URL format.
    return (
      dataset.products.find(
        (candidate) => dataset.productUrlTemplate.replace('{id}', candidate.externalId) === url,
      ) ?? dataset.products.find((candidate) => url.endsWith(candidate.externalId))
    );
  }

  return {
    name: dataset.name,
    slug: dataset.slug,
    vertical: DEFAULT_VERTICAL_ID,
    websiteUrl: dataset.websiteUrl,
    logoUrl: dataset.logoUrl,
    sourceKind: 'mock',

    storeCountry,
    supportedDeliveryCountries: declaredDeliveryCountries,
    supportedCurrencies: dataset.supportedCurrencies ?? [currency],
    region: dataset.region ?? 'local',
    isDemoStore: dataset.isDemoStore ?? false,

    supportsDestination(country: CountryCode): boolean {
      // Delegates to the rule map, where absence means no. There is no fallback
      // that would let a store be assumed to serve a country it never declared.
      return declaredDeliveryCountries.includes(country);
    },

    async searchProducts(
      query: ProductSearchInput,
      context?: DestinationContext,
    ): Promise<ExternalProduct[]> {
      await simulateNetwork();

      const limit = Math.max(1, Math.min(query.limit ?? 50, dataset.products.length));
      return dataset.products
        .filter((definition) => matches(definition, query))
        // When a destination is named, a product that cannot reach it is not a
        // result. When none is named — every existing caller — nothing is
        // filtered and the behaviour is exactly as before.
        .filter(
          (definition) =>
            context == null ||
            offersProductToDestination(dataset, definition.externalId, context.destinationCountry),
        )
        .slice(0, limit)
        .map((definition) => toExternalProduct(dataset, definition));
    },

    async getOffer(
      productUrl: string,
      context: DestinationContext,
    ): Promise<ExternalStoreOffer> {
      await simulateNetwork();

      const definition = findDefinition(productUrl);
      if (!definition) throw new ProviderNotFoundError(dataset.name, productUrl);

      const delivery = resolveDelivery(dataset, definition, context.destinationCountry);
      if (delivery == null) {
        // Throw rather than return a guess. A fabricated shipping cost reaches the
        // shopper indistinguishable from a real one.
        throw new ProviderUnsupportedDestinationError(dataset.name, context.destinationCountry);
      }

      return {
        externalId: definition.externalId,
        productUrl: dataset.productUrlTemplate.replace('{id}', definition.externalId),
        destinationCountry: context.destinationCountry,
        // The store quotes in its own currency. Converting to the shopper's
        // requested currency is a read-time concern with its own rate provenance,
        // not something a store adapter should invent.
        currency,
        productPrice: definition.currentPrice,
        originalPrice: definition.originalPrice ?? null,
        shippingPrice: delivery.shippingPrice,
        availability: definition.availability ?? 'IN_STOCK',
        deliveryMinDays: delivery.deliveryMinDays,
        deliveryMaxDays: delivery.deliveryMaxDays,
        // Tax and duty are deliberately left to the route-based determination in
        // @deal-finder/shared, so one implementation governs every provider.
      };
    },

    async getProductDetails(url: string): Promise<ExternalProductDetails> {
      await simulateNetwork();

      const definition = findDefinition(url);
      if (!definition) throw new ProviderNotFoundError(dataset.name, url);

      return {
        ...toExternalProduct(dataset, definition),
        description: definition.description,
        priceHistoryHints: generatePriceHistory(
          definition.externalId,
          definition.currentPrice,
          definition.history,
          now(),
        ),
      };
    },
  };
}

/** All sample definitions for a dataset, for the seed script. */
export function datasetProducts(dataset: MockStoreDataset): readonly MockProductDefinition[] {
  return dataset.products;
}
