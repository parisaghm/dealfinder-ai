import { DEFAULT_COUNTRY_CODE, type CountryCode } from '@deal-finder/shared';
import type { MockDeliveryRule, MockProductDefinition, MockStoreDataset } from './types';

/**
 * Resolving a store's delivery rules for a destination.
 *
 * Kept separate from the provider factory so the rules are testable on their own,
 * and because this is where the load-bearing decision lives: **absence means no**.
 * A country with no rule is not delivered to. There is no flag to forget to set,
 * and no default that quietly opens up the whole continent.
 *
 * Three distinct states have to survive this module intact, because collapsing any
 * two of them is a lie the UI would then repeat:
 *
 *   no rule            → the store does not deliver there
 *   rule, price null   → it delivers there and will not say what it costs
 *   rule, price 0      → free delivery
 */

/**
 * Finland-only, deferring to each product's own published delivery cost.
 *
 * The default for the three original datasets, which predate destinations
 * entirely. It reproduces their existing behaviour exactly: domestic delivery,
 * priced per product, with `null` still meaning unpublished.
 */
const DEFAULT_DELIVERY_RULES: Partial<Record<CountryCode, MockDeliveryRule>> = {
  [DEFAULT_COUNTRY_CODE]: { shippingPrice: null, useProductShipping: true },
};

export function datasetCountry(dataset: MockStoreDataset): CountryCode {
  return dataset.countryCode ?? DEFAULT_COUNTRY_CODE;
}

export function datasetDeliveryRules(
  dataset: MockStoreDataset,
): Partial<Record<CountryCode, MockDeliveryRule>> {
  return dataset.deliveryRules ?? DEFAULT_DELIVERY_RULES;
}

/**
 * Whether the *store* delivers to a country at all.
 *
 * Store-level only. It does not mean any particular product can get there — see
 * `offersProductToDestination`.
 */
export function storeDeliversTo(dataset: MockStoreDataset, country: CountryCode): boolean {
  return datasetDeliveryRules(dataset)[country] != null;
}

export function deliveryCountries(dataset: MockStoreDataset): readonly CountryCode[] {
  return Object.keys(datasetDeliveryRules(dataset)) as CountryCode[];
}

/**
 * Whether this specific product can reach this specific destination.
 *
 * Stricter than `storeDeliversTo`, and deliberately so. A store can ship to
 * Finland in general and still be unable to ship a particular item there. This is
 * the function that makes store-level metadata insufficient as a deliverability
 * claim — and the reason the database keeps `StoreOffer` as the authority rather
 * than trusting `Store.supportedDeliveryCountries`.
 */
export function offersProductToDestination(
  dataset: MockStoreDataset,
  externalId: string,
  country: CountryCode,
): boolean {
  if (!storeDeliversTo(dataset, country)) return false;
  const excluded = dataset.productDestinationExclusions?.[country] ?? [];
  return !excluded.includes(externalId);
}

export interface ResolvedDelivery {
  /** Null means the store publishes no delivery cost for this destination. */
  shippingPrice: number | null;
  deliveryMinDays: number | null;
  deliveryMaxDays: number | null;
}

/**
 * The delivery cost and estimate for one product to one destination.
 *
 * Returns null when the product is not deliverable there, so the caller has to
 * handle that case explicitly rather than receiving a zero it might spend.
 *
 * `freeOver` is applied against the product price alone, not a basket total —
 * these are single-item comparisons and pretending otherwise would understate the
 * cost of a cheap item.
 */
export function resolveDelivery(
  dataset: MockStoreDataset,
  product: MockProductDefinition,
  country: CountryCode,
): ResolvedDelivery | null {
  if (!offersProductToDestination(dataset, product.externalId, country)) return null;

  const rule = datasetDeliveryRules(dataset)[country];
  if (rule == null) return null;

  // Either the store prices delivery per product, or it has a flat rule for this
  // destination. In both cases `undefined` collapses to null — unpublished.
  const baseShipping = rule.useProductShipping
    ? (product.shippingPrice ?? null)
    : rule.shippingPrice;

  const qualifiesForFree =
    rule.freeOver != null && baseShipping != null && product.currentPrice >= rule.freeOver;

  return {
    // A free-shipping threshold can only reduce a *known* cost. Applying it to an
    // unpublished one would invent a price of zero out of a rule about discounts.
    shippingPrice: qualifiesForFree ? 0 : baseShipping,
    deliveryMinDays: rule.minDays ?? null,
    deliveryMaxDays: rule.maxDays ?? null,
  };
}
