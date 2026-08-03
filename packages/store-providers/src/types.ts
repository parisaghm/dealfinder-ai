import {
  availabilitySchema,
  countryCodeSchema,
  currencySchema,
  type Availability,
  type CountryCode,
  type Currency,
  type StoreRegion,
} from '@deal-finder/shared';
import { z } from 'zod';

/**
 * The contract every store integration implements.
 *
 * Nothing outside this package knows whether a store is reached through an
 * official API, a product feed, embedded JSON-LD or a headless browser. That
 * isolation is deliberate: scraping is the most brittle and most legally
 * sensitive part of the system, so it is confined behind one interface that
 * the API depends on. Swapping a mock adapter for a live one — or replacing a
 * scraper with an affiliate API — is a change to a single file.
 */
export interface StoreProvider {
  /** Human-readable store name, e.g. "Verkkokauppa.com". */
  name: string;
  /** URL-safe identifier, matching `Store.slug` in the database. */
  slug: string;
  /** Which vertical this adapter serves. */
  vertical: string;
  websiteUrl: string;
  logoUrl?: string | null;
  /** How this adapter obtains data — surfaced in logs and the README. */
  sourceKind: ProviderSourceKind;

  /**
   * Destination context is an **optional second argument**, so every existing
   * caller compiles and behaves unchanged, and a provider that ignores it is
   * still a valid implementation.
   */
  searchProducts(
    query: ProductSearchInput,
    context?: DestinationContext,
  ): Promise<ExternalProduct[]>;

  /**
   * Unchanged signature. This is the path the scheduled monitor uses, and it must
   * keep working exactly as before.
   */
  getProductDetails(url: string): Promise<ExternalProductDetails>;

  // ── Destination awareness ─────────────────────────────────────────────────
  //
  // Added additively. Every member below is required of a provider but changes
  // nothing for the two methods above, which keep their existing signatures so
  // the monitor's `getProductDetails` path is untouched.

  /** Where the store trades from. Drives the tax and duty determination. */
  storeCountry: CountryCode;
  /**
   * Destinations the store declares it delivers to.
   *
   * Coarse capability metadata, and **not** proof that any given product can be
   * delivered. That requires a `StoreOffer` row for the
   * (product, country, currency) tuple. A store can declare FI and still have
   * products with no Finnish offer, and presenting those as deliverable would be
   * a claim the data does not support.
   */
  supportedDeliveryCountries: readonly CountryCode[];
  supportedCurrencies: readonly Currency[];
  /** Breadth of the store's own declared network. Displayed, not filtered on. */
  region: StoreRegion;
  /** True for the fictional retailers used to demonstrate the feature offline. */
  isDemoStore: boolean;

  /**
   * Whether this provider can quote for a destination.
   *
   * Each provider answers for itself rather than a caller inferring it from
   * `supportedDeliveryCountries`, so a provider with genuinely per-destination
   * logic can express it. The default is always "no": a store is not considered
   * to serve a destination unless it has an explicit rule saying so.
   */
  supportsDestination(country: CountryCode): boolean;

  /**
   * What a product costs delivered to a specific destination.
   *
   * Throws `ProviderUnsupportedDestinationError` rather than returning a guess
   * when the destination is not served. Silence or a fabricated shipping cost
   * would both end up presented to a shopper as fact.
   */
  getOffer(productUrl: string, context: DestinationContext): Promise<ExternalStoreOffer>;
}

/** Where the parcel is going, and the currency to quote in. */
export interface DestinationContext {
  destinationCountry: CountryCode;
  currency: CurrencyCode;
}

/**
 * Alias kept because the brief names this type. `Currency` is the canonical name
 * in `@deal-finder/shared`.
 */
export type CurrencyCode = Currency;

/**
 * A store's answer for one product and one destination.
 *
 * Distinct from `ExternalProduct`: that describes a listing, this describes what
 * it costs to have that listing delivered somewhere. The same listing yields a
 * different `ExternalStoreOffer` per destination, which is the whole point.
 */
export interface ExternalStoreOffer {
  /** The store's own identifier for the listing. */
  externalId: string;
  productUrl: string;
  destinationCountry: CountryCode;
  /** The currency the store quotes in — not necessarily the requested one. */
  currency: Currency;

  productPrice: number;
  originalPrice?: number | null;
  /**
   * Null means the store publishes no delivery cost to this destination.
   *
   * Null is not zero and must never be coerced to it. A store that has not said
   * what delivery costs has not said it is free.
   */
  shippingPrice?: number | null;

  availability: Availability;
  /** Business days. Null means the store publishes no estimate. */
  deliveryMinDays?: number | null;
  deliveryMaxDays?: number | null;

  /**
   * Tax and duty, when the *store* publishes something authoritative.
   *
   * Normally omitted: the route-based determination in
   * `@deal-finder/shared/countries` is applied at ingestion instead, so one
   * implementation governs and a provider cannot accidentally assert that a
   * cross-border order is duty-free.
   */
  taxesIncluded?: boolean | null;
  estimatedTax?: number | null;
  estimatedImportFees?: number | null;
}

export const PROVIDER_SOURCE_KINDS = [
  /** Bundled sample data. No network access. */
  'mock',
  /** Official/partner HTTP API. */
  'api',
  /** Structured data published by the page (JSON-LD, microdata). */
  'structured-data',
  /** Rendered DOM read through a headless browser. */
  'browser',
] as const;
export type ProviderSourceKind = (typeof PROVIDER_SOURCE_KINDS)[number];

export interface ProductSearchInput {
  /** Free-text terms. Matched against name and brand. */
  query?: string;
  /** Category slug from the vertical's taxonomy. */
  category?: string;
  maximumPrice?: number;
  minimumDiscount?: number;
  vertical?: string;
  /** Upper bound on returned rows. Adapters must honour it. */
  limit?: number;
}

/**
 * A product as a store describes it.
 *
 * Validated with `externalProductSchema` before it is allowed into the
 * application: this data comes from third parties, and a missing price or a
 * negative number must be rejected at the boundary rather than stored.
 */
export interface ExternalProduct {
  /** The store's own identifier. Stable across checks — used as the upsert key. */
  externalId: string;
  name: string;
  brand?: string | null;
  category: string;
  vertical: string;
  imageUrl?: string | null;
  productUrl: string;
  currentPrice: number;
  /** The store's claimed pre-discount price, when it advertises one. */
  originalPrice?: number | null;
  /** Null means the store does not publish one, which differs from free (0). */
  shippingPrice?: number | null;
  currency: Currency;
  availability: Availability;
  /**
   * Product identifiers as the store publishes them, if it publishes any.
   *
   * Carried through the boundary so cross-store matching has something stronger
   * than a title to work with. All nullish: most storefronts publish none of
   * them, and a listing without a GTIN must still be ingestable.
   */
  modelNumber?: string | null;
  gtin?: string | null;
  ean?: string | null;
  mpn?: string | null;
  /** Vertical-specific fields, validated against the vertical's schema. */
  attributes?: Record<string, unknown> | null;
}

export interface ExternalProductDetails extends ExternalProduct {
  description?: string | null;
  /**
   * Prior prices the source itself publishes. Used only to bootstrap history
   * for a newly-tracked product; ongoing history comes from our own recorded
   * observations.
   */
  priceHistoryHints?: Array<{ price: number; recordedAt: string }>;
}

// ── Boundary validation ─────────────────────────────────────────────────────

export const externalProductSchema = z.object({
  externalId: z.string().min(1).max(128),
  name: z.string().min(1).max(300),
  brand: z.string().max(120).nullish(),
  category: z.string().min(1).max(64),
  vertical: z.string().min(1).max(64),
  imageUrl: z.string().max(2048).nullish(),
  productUrl: z.string().min(1).max(2048),
  currentPrice: z.number().finite().nonnegative().max(10_000_000),
  originalPrice: z.number().finite().nonnegative().max(10_000_000).nullish(),
  shippingPrice: z.number().finite().nonnegative().max(100_000).nullish(),
  currency: currencySchema,
  availability: availabilitySchema,
  modelNumber: z.string().max(120).nullish(),
  gtin: z.string().max(20).nullish(),
  ean: z.string().max(20).nullish(),
  mpn: z.string().max(120).nullish(),
  attributes: z.record(z.string(), z.unknown()).nullish(),
});

/**
 * Boundary validation for a destination offer.
 *
 * Same discipline as `externalProductSchema`: this data comes from a third party,
 * so a negative shipping cost or an absurd delivery estimate is rejected here
 * rather than stored. Note `shippingPrice` is `nullish` and *stays* null — the
 * schema never defaults it, because defaulting it to 0 is precisely the bug.
 */
export const externalStoreOfferSchema = z.object({
  externalId: z.string().min(1).max(128),
  productUrl: z.string().min(1).max(2048),
  destinationCountry: countryCodeSchema,
  currency: currencySchema,
  productPrice: z.number().finite().nonnegative().max(10_000_000),
  originalPrice: z.number().finite().nonnegative().max(10_000_000).nullish(),
  shippingPrice: z.number().finite().nonnegative().max(100_000).nullish(),
  availability: availabilitySchema,
  deliveryMinDays: z.number().int().nonnegative().max(365).nullish(),
  deliveryMaxDays: z.number().int().nonnegative().max(365).nullish(),
  taxesIncluded: z.boolean().nullish(),
  estimatedTax: z.number().finite().nonnegative().max(10_000_000).nullish(),
  estimatedImportFees: z.number().finite().nonnegative().max(10_000_000).nullish(),
});

export const externalProductDetailsSchema = externalProductSchema.extend({
  description: z.string().max(5000).nullish(),
  priceHistoryHints: z
    .array(
      z.object({
        price: z.number().finite().nonnegative().max(10_000_000),
        recordedAt: z.iso.datetime(),
      }),
    )
    .max(1000)
    .optional(),
});

/**
 * Outcome of querying one provider.
 *
 * Providers fail independently and routinely — a site is down, rate-limits, or
 * changes its markup. Returning a result object rather than throwing lets the
 * caller aggregate across stores and degrade gracefully instead of failing the
 * whole search because one store was unavailable.
 */
export type ProviderResult<T> =
  | { ok: true; provider: string; data: T; durationMs: number }
  | { ok: false; provider: string; error: ProviderFailure; durationMs: number };

export interface ProviderFailure {
  kind: 'timeout' | 'blocked' | 'not-found' | 'invalid-data' | 'network' | 'unknown';
  message: string;
  /** Whether retrying the same request could plausibly succeed. */
  retryable: boolean;
}
