import type { Availability } from '@deal-finder/shared';
import type { HistorySpec } from './history';

/**
 * Shape of a sample-catalogue entry.
 *
 * The mock datasets are the single source of product data for the whole
 * development environment: the seed script ingests them exactly as if they had
 * come from a live provider, so the ingestion path is exercised from the first
 * `db:seed` rather than only in production.
 */
export interface MockProductDefinition {
  externalId: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  currentPrice: number;
  /** The store's advertised pre-discount price, when it claims one. */
  originalPrice?: number;
  /** `undefined` means the store publishes no delivery cost; 0 means free. */
  shippingPrice?: number;
  availability?: Availability;
  /**
   * Identifiers, where the sample catalogue models a store that publishes them.
   * Deliberately uneven across the datasets — matching has to work when only
   * some stores expose a code, which is the realistic case.
   */
  modelNumber?: string;
  gtin?: string;
  ean?: string;
  mpn?: string;
  attributes?: Record<string, unknown>;
  /** Determines the synthesised price history. */
  history: HistorySpec;
}

export interface MockStoreDataset {
  slug: string;
  name: string;
  websiteUrl: string;
  logoUrl: string | null;
  /** Path template for product URLs, with `{id}` substituted. */
  productUrlTemplate: string;
  products: readonly MockProductDefinition[];
}
