import { toMajor } from '../money/money';
import type { Currency } from '../schemas/common';
import { DEFAULT_LOCALE, formatMoney } from '../utils/format';
import { PURCHASABLE } from './offer-sort';

/**
 * Destination-aware offer sorting and comparison.
 *
 * A sibling of `offer-sort.ts`, not a replacement for it. That module compares
 * offers on listed price plus published shipping, in one currency, with no
 * notion of where the parcel is going; it is still correct and is still what the
 * pre-expansion pages use. This one compares *delivered totals* to a chosen
 * destination, in a chosen display currency, and has three extra ways an offer
 * can fail to be comparable: it may not ship there at all, its shipping cost may
 * be unpublished, or its currency may not be convertible at a rate we trust.
 *
 * The rule inherited unchanged from `compareOffers` — and the reason both exist —
 * is that the highlighted winner must be an offer a shopper can act on, and any
 * cheaper-looking offer passed over must be *explained* rather than hidden.
 *
 * Amounts here are integer minor units in the display currency. Sorting on
 * floats is how a comparison table develops a stable-looking wrong order.
 */

export const DELIVERED_SORT_OPTIONS = [
  'lowest-delivered',
  'lowest-price',
  'fastest-delivery',
  'best-discount',
  'best-deal-quality',
  'recently-updated',
] as const;
export type DeliveredSort = (typeof DELIVERED_SORT_OPTIONS)[number];

/**
 * The minimum an offer must expose to be ranked for a destination.
 *
 * Structural rather than importing the DTO, matching `SortableOffer`'s reasoning:
 * it stays usable on both sides of the wire and in tests that do not want to
 * build a full payload.
 */
export interface DeliveredSortableOffer {
  id: string;
  storeName: string;
  /** True only when an offer proves delivery is possible. */
  shipsToDestination: boolean;
  /** Delivered total in display-currency minor units; null when unknowable. */
  deliveredMinorUnits: number | null;
  /** Listed product price in display-currency minor units; null when unconvertible. */
  listedMinorUnits: number | null;
  availability: string;
  /** True when a stale or missing exchange rate bars this offer from winning. */
  blocksCheapestClaim: boolean;
  /** Null when the store does not publish a delivery estimate. */
  deliveryMaxDays: number | null;
  discountPercent: number;
  lastCheckedAt: string;
  dealQuality: { score: number };
}

/** Unknown values sort last under every ascending comparator, never first. */
function ascendingWithUnknownLast(a: number | null, b: number | null): number {
  const left = a ?? Number.POSITIVE_INFINITY;
  const right = b ?? Number.POSITIVE_INFINITY;
  return left - right;
}

function byListedThenId(a: DeliveredSortableOffer, b: DeliveredSortableOffer): number {
  return (
    ascendingWithUnknownLast(a.listedMinorUnits, b.listedMinorUnits) || a.id.localeCompare(b.id)
  );
}

const COMPARATORS: Record<
  DeliveredSort,
  (a: DeliveredSortableOffer, b: DeliveredSortableOffer) => number
> = {
  'lowest-delivered': (a, b) =>
    ascendingWithUnknownLast(a.deliveredMinorUnits, b.deliveredMinorUnits) || byListedThenId(a, b),
  'lowest-price': byListedThenId,
  'fastest-delivery': (a, b) =>
    ascendingWithUnknownLast(a.deliveryMaxDays, b.deliveryMaxDays) || byListedThenId(a, b),
  'best-discount': (a, b) => b.discountPercent - a.discountPercent || byListedThenId(a, b),
  'best-deal-quality': (a, b) => b.dealQuality.score - a.dealQuality.score || byListedThenId(a, b),
  'recently-updated': (a, b) =>
    Date.parse(b.lastCheckedAt) - Date.parse(a.lastCheckedAt) || byListedThenId(a, b),
};

/**
 * Sort a complete offer set. Pure — the input array is never mutated.
 *
 * Offers that do not ship to the destination always sort after those that do,
 * whatever the active comparator says, because an offer that cannot arrive is
 * not a cheaper alternative to one that can.
 */
export function sortDeliveredOffers<T extends DeliveredSortableOffer>(
  offers: readonly T[],
  sort: DeliveredSort,
): T[] {
  const comparator = COMPARATORS[sort];
  return [...offers].sort((a, b) => {
    if (a.shipsToDestination !== b.shipsToDestination) return a.shipsToDestination ? -1 : 1;
    return comparator(a, b);
  });
}

/**
 * A reason the comparison has to qualify itself — as data, not as prose.
 *
 * Amounts stay in minor units and stores stay named rather than interpolated,
 * because the sentence has to be rendered in the destination's locale and
 * display currency. A caveat built as a string here would have to pick a format
 * before it knows where it is going, and the result is the mismatch this type
 * exists to prevent: `265.90` in the note beside `265,90 €` in the table.
 *
 * `formatDeliveredCaveats` turns these into that sentence, once, using the same
 * `formatMoney` the table cells use.
 */
export type DeliveredCaveat =
  | {
      kind: 'cheaper-offer-skipped';
      /** Delivered total of the cheaper offer, in display-currency minor units. */
      amountMinorUnits: number;
      storeName: string;
      reason: 'not-purchasable' | 'stale-rate';
    }
  | { kind: 'unknown-shipping'; count: number }
  | { kind: 'not-shipping'; count: number };

export interface DeliveredComparisonResult {
  lowestDeliveredMinorUnits: number | null;
  highestDeliveredMinorUnits: number | null;
  lowestListedMinorUnits: number | null;
  cheapestDeliveredOfferId: string | null;
  /** Why a cheaper-looking offer was not crowned. Empty when there is nothing to explain. */
  cheapestDeliveredCaveats: DeliveredCaveat[];
  storesShippingToDestination: number;
  offersWithUnknownShipping: number;
  offersNotShippingToDestination: number;
  offersBlockedByExchangeRate: number;
}

const SKIP_REASON: Record<
  Extract<DeliveredCaveat, { kind: 'cheaper-offer-skipped' }>['reason'],
  string
> = {
  'not-purchasable': 'it is not currently available to buy',
  'stale-rate': 'its exchange rate is too old to rely on',
};

/** One caveat as a sentence, in the destination's locale and display currency. */
export function formatDeliveredCaveat(
  caveat: DeliveredCaveat,
  currency: Currency,
  locale: string = DEFAULT_LOCALE,
): string {
  switch (caveat.kind) {
    case 'cheaper-offer-skipped': {
      const amount = formatMoney(
        toMajor({ minorUnits: caveat.amountMinorUnits, currency }),
        currency,
        locale,
      );
      return `A cheaper delivered total of ${amount} is listed at ${caveat.storeName}, but ${SKIP_REASON[caveat.reason]}.`;
    }
    case 'unknown-shipping': {
      const one = caveat.count === 1;
      return `${String(caveat.count)} ${one ? 'offer does' : 'offers do'} not publish a delivery cost, so ${one ? 'its' : 'their'} delivered total cannot be compared.`;
    }
    case 'not-shipping':
      return `${String(caveat.count)} ${caveat.count === 1 ? 'store does' : 'stores do'} not ship to this destination.`;
  }
}

/**
 * Every caveat as one paragraph, or null when the comparison needs no qualifying.
 */
export function formatDeliveredCaveats(
  caveats: readonly DeliveredCaveat[],
  currency: Currency,
  locale: string = DEFAULT_LOCALE,
): string | null {
  if (caveats.length === 0) return null;
  return caveats.map((caveat) => formatDeliveredCaveat(caveat, currency, locale)).join(' ');
}

/**
 * Summarise a destination-aware offer set.
 *
 * The winner must satisfy all four conditions, and each one exists because
 * violating it produces a specific, familiar lie:
 *
 *  1. It ships to the destination — otherwise we recommend something that cannot
 *     arrive.
 *  2. Its delivered total is known — otherwise the least-informative offer wins
 *     by virtue of having admitted the least.
 *  3. It is purchasable — otherwise we recommend an out-of-stock listing.
 *  4. Its exchange rate is trustworthy — otherwise a stale rate decides which
 *     store gets the click.
 *
 * Anything excluded by 2, 3 or 4 is *counted and explained*, never dropped in
 * silence. An offer that disappears without a reason reads as an offer that does
 * not exist.
 */
export function compareDeliveredOffers(
  offers: readonly DeliveredSortableOffer[],
): DeliveredComparisonResult {
  const empty: DeliveredComparisonResult = {
    lowestDeliveredMinorUnits: null,
    highestDeliveredMinorUnits: null,
    lowestListedMinorUnits: null,
    cheapestDeliveredOfferId: null,
    cheapestDeliveredCaveats: [],
    storesShippingToDestination: 0,
    offersWithUnknownShipping: 0,
    offersNotShippingToDestination: 0,
    offersBlockedByExchangeRate: 0,
  };
  if (offers.length === 0) return empty;

  const shippable = offers.filter((offer) => offer.shipsToDestination);
  const notShipping = offers.length - shippable.length;

  const withDelivered = shippable.filter(
    (offer): offer is DeliveredSortableOffer & { deliveredMinorUnits: number } =>
      offer.deliveredMinorUnits != null,
  );

  const unknownShipping = shippable.length - withDelivered.length;
  const blockedByRate = shippable.filter((offer) => offer.blocksCheapestClaim).length;

  const deliveredValues = withDelivered.map((offer) => offer.deliveredMinorUnits);
  const lowestDelivered = deliveredValues.length > 0 ? Math.min(...deliveredValues) : null;
  const highestDelivered = deliveredValues.length > 0 ? Math.max(...deliveredValues) : null;

  const listedValues = shippable
    .map((offer) => offer.listedMinorUnits)
    .filter((value): value is number => value != null);
  const lowestListed = listedValues.length > 0 ? Math.min(...listedValues) : null;

  const eligible = withDelivered.filter(
    (offer) => PURCHASABLE.has(offer.availability) && !offer.blocksCheapestClaim,
  );

  const winner = eligible.reduce<(DeliveredSortableOffer & { deliveredMinorUnits: number }) | null>(
    (best, offer) => {
      if (best == null) return offer;
      if (offer.deliveredMinorUnits < best.deliveredMinorUnits) return offer;
      if (offer.deliveredMinorUnits === best.deliveredMinorUnits && offer.id < best.id) return offer;
      return best;
    },
    null,
  );

  const caveats: DeliveredCaveat[] = [];

  if (winner && lowestDelivered != null && winner.deliveredMinorUnits > lowestDelivered) {
    const cheaper = withDelivered.find((offer) => offer.deliveredMinorUnits === lowestDelivered);
    if (cheaper) {
      caveats.push({
        kind: 'cheaper-offer-skipped',
        amountMinorUnits: cheaper.deliveredMinorUnits,
        storeName: cheaper.storeName,
        reason: PURCHASABLE.has(cheaper.availability) ? 'stale-rate' : 'not-purchasable',
      });
    }
  }

  if (unknownShipping > 0) {
    caveats.push({ kind: 'unknown-shipping', count: unknownShipping });
  }

  if (notShipping > 0) {
    caveats.push({ kind: 'not-shipping', count: notShipping });
  }

  return {
    lowestDeliveredMinorUnits: lowestDelivered,
    highestDeliveredMinorUnits: highestDelivered,
    lowestListedMinorUnits: lowestListed,
    cheapestDeliveredOfferId: winner?.id ?? null,
    cheapestDeliveredCaveats: caveats,
    storesShippingToDestination: shippable.length,
    offersWithUnknownShipping: unknownShipping,
    offersNotShippingToDestination: notShipping,
    offersBlockedByExchangeRate: blockedByRate,
  };
}

/**
 * Whether the cheapest *listed* offer differs from the cheapest *delivered* one.
 *
 * The headline case the product exists for: a €319 listing with €12.90 delivery
 * loses to a €329 listing with free delivery, and a tool that highlights the
 * former is actively misleading. Surfaced as a helper so the UI can say so
 * explicitly rather than leave the user to notice.
 */
export function listedAndDeliveredDisagree(
  offers: readonly DeliveredSortableOffer[],
): boolean {
  const comparison = compareDeliveredOffers(offers);
  if (comparison.cheapestDeliveredOfferId == null) return false;
  if (comparison.lowestListedMinorUnits == null) return false;

  const cheapestListed = offers
    .filter((offer) => offer.shipsToDestination && offer.listedMinorUnits != null)
    .reduce<DeliveredSortableOffer | null>(
      (best, offer) =>
        best == null || (offer.listedMinorUnits ?? 0) < (best.listedMinorUnits ?? 0) ? offer : best,
      null,
    );

  return cheapestListed != null && cheapestListed.id !== comparison.cheapestDeliveredOfferId;
}
