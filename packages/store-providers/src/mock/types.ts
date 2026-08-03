import type { Availability, CountryCode, Currency, StoreRegion } from '@deal-finder/shared';
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

/**
 * What a store charges to deliver to one country, and how long it takes.
 *
 * The presence of a rule is what makes a destination served. There is no
 * "shipsTo: false" — a country with no rule is simply not delivered to, which
 * makes "does not ship there" the default rather than something a dataset has to
 * remember to declare.
 */
export interface MockDeliveryRule {
  /**
   * Delivery cost in the store's own currency.
   *
   * `null` means the store publishes a rule for this country but no price — it
   * delivers there, and will not say what it costs. Distinct from `0`, which is
   * free delivery, and distinct again from an absent rule, which is no delivery.
   * All three occur in the datasets, because all three occur in reality.
   */
  shippingPrice: number | null;
  /**
   * Take the delivery cost from each product's own `shippingPrice` instead.
   *
   * The three original Finnish datasets publish delivery per product — Gigantti
   * free, Verkkokauppa €12,90, one listing with none at all — and those figures
   * are load-bearing for existing tests. A flat store-level rule would overwrite
   * them, so the domestic rule defers to the product. Explicit rather than
   * inferred, so reading the dataset tells you which model it uses.
   */
  useProductShipping?: boolean;
  /** Order value above which delivery is free. Omitted when the store has none. */
  freeOver?: number;
  /** Business-day estimate. Omit both when the store publishes no estimate. */
  minDays?: number;
  maxDays?: number;
}

export interface MockStoreDataset {
  slug: string;
  name: string;
  websiteUrl: string;
  logoUrl: string | null;
  /** Path template for product URLs, with `{id}` substituted. */
  productUrlTemplate: string;
  products: readonly MockProductDefinition[];

  // ── Destination metadata ──────────────────────────────────────────────────
  //
  // Optional so the three original Finnish datasets remain valid unchanged; the
  // provider factory applies Finnish defaults when they are absent.

  /** Where the store trades from. Defaults to FI. */
  countryCode?: CountryCode;
  /** Currency the store quotes in. Defaults to EUR. */
  currency?: Currency;
  supportedCurrencies?: readonly Currency[];
  /** Breadth of the declared network. Defaults to 'local'. */
  region?: StoreRegion;
  vatRegistrationCountry?: CountryCode;
  /**
   * True for the fictional European retailers. Defaults to false.
   *
   * Surfaced through the provider, the database and the UI so synthetic prices are
   * never mistaken for real commercial data.
   */
  isDemoStore?: boolean;
  /**
   * Per-destination delivery rules. A country absent from this map is a country
   * the store does not deliver to.
   *
   * Defaults to domestic-only when omitted.
   */
  deliveryRules?: Partial<Record<CountryCode, MockDeliveryRule>>;
  /**
   * External ids this store does *not* offer to particular destinations, even
   * though the store itself delivers there.
   *
   * Models the real and awkward case of a listing that cannot be shipped
   * everywhere the store ships — bulky goods, licensing, regional stock. It is
   * also the fixture that proves store-level metadata is not sufficient to claim a
   * product is deliverable: only a StoreOffer row is.
   */
  productDestinationExclusions?: Partial<Record<CountryCode, readonly string[]>>;
}
