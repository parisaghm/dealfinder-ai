import { calculateEffectivePrice } from '../pricing/discount';

/**
 * Offer sorting for a canonical product's comparison table.
 *
 * This sorts in memory rather than in SQL, which is the opposite of what
 * `deals.service.ts` does — deliberately, and for a reason that does not apply
 * here. The rule that search must sort in SQL is about *pagination*: ordering a
 * paginated list by a value computed after the page was fetched reorders within
 * pages and silently produces wrong results. An offer list is not paginated.
 * It is one offer per store for one product, bounded structurally and again by
 * a hard cap, so there is no page boundary to corrupt.
 *
 * What that buys: `lowest-total` uses the same `calculateEffectivePrice` the
 * rest of the app uses, and `best-deal-quality` uses the score the API already
 * computed for every offer — instead of re-implementing six weighted factors
 * and three calibration ratios in SQL and guaranteeing they drift apart.
 *
 * Every comparator falls back to price then id, so the order is *total* and two
 * identical requests return byte-identical output.
 */

export const OFFER_SORT_OPTIONS = [
  'lowest-total',
  'lowest-price',
  'best-discount',
  'best-deal-quality',
  'recently-updated',
] as const;
export type OfferSort = (typeof OFFER_SORT_OPTIONS)[number];

/** Never return more offers than this, whatever the data says. */
export const MAX_OFFERS_PER_CANONICAL = 50;

/**
 * The minimum an offer must expose to be sorted. Structural rather than
 * importing `ProductSummary`, so this stays usable on both sides of the wire
 * and in tests that do not want to build a full DTO.
 */
export interface SortableOffer {
  id: string;
  currentPrice: number;
  shippingPrice: number | null;
  discountPercent: number;
  lastCheckedAt: string;
  dealQuality: { score: number };
}

/**
 * Shipping-inclusive total, or `null` when the store does not publish a
 * delivery cost.
 *
 * `null` is not zero. Treating an unlisted delivery cost as free is how a
 * comparison tool ends up crowning an offer that turns out to be the most
 * expensive — precisely the dishonesty this product exists to expose.
 */
export function offerTotalPrice(offer: SortableOffer): number | null {
  if (offer.shippingPrice == null) return null;
  return calculateEffectivePrice(offer.currentPrice, offer.shippingPrice);
}

/** Offers with an unknown total sort last, never first. */
function totalForSorting(offer: SortableOffer): number {
  return offerTotalPrice(offer) ?? Number.POSITIVE_INFINITY;
}

function byPriceThenId(a: SortableOffer, b: SortableOffer): number {
  return a.currentPrice - b.currentPrice || a.id.localeCompare(b.id);
}

const COMPARATORS: Record<OfferSort, (a: SortableOffer, b: SortableOffer) => number> = {
  'lowest-total': (a, b) => totalForSorting(a) - totalForSorting(b) || byPriceThenId(a, b),
  'lowest-price': byPriceThenId,
  'best-discount': (a, b) => b.discountPercent - a.discountPercent || byPriceThenId(a, b),
  'best-deal-quality': (a, b) => b.dealQuality.score - a.dealQuality.score || byPriceThenId(a, b),
  'recently-updated': (a, b) =>
    Date.parse(b.lastCheckedAt) - Date.parse(a.lastCheckedAt) || byPriceThenId(a, b),
};

/** Sort a complete offer set. Pure — the input array is never mutated. */
export function sortOffers<T extends SortableOffer>(offers: readonly T[], sort: OfferSort): T[] {
  return [...offers].sort(COMPARATORS[sort]);
}

export interface OfferComparison {
  /** Lowest listed product price, ignoring delivery. */
  lowestPrice: number | null;
  highestPrice: number | null;
  /** Lowest price *actually payable*, delivery included. */
  lowestTotalPrice: number | null;
  highestTotalPrice: number | null;
  /** The offer a shopper should choose, or null when none qualifies. */
  cheapestTotalOfferId: string | null;
  /** Why a cheaper offer was passed over, when one was. */
  cheapestTotalCaveat: string | null;
  /** Difference between the dearest and cheapest payable totals. */
  priceSpread: number | null;
  priceSpreadPercent: number | null;
  /** Saving against the most expensive current offer. */
  savingsAgainstHighest: number | null;
  savingsPercentAgainstHighest: number | null;
}

export interface ComparableOffer extends SortableOffer {
  availability: string;
  storeName: string;
}

const PURCHASABLE = new Set(['IN_STOCK', 'LOW_STOCK', 'PREORDER']);

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Summarise an offer set for the comparison header and the table highlight.
 *
 * The highlighted winner must be an offer a shopper can *act on*: in stock,
 * with a published delivery cost. When a cheaper offer exists but fails that
 * test, it is not silently dropped — `cheapestTotalCaveat` says so, because
 * concealing it would be the same sin as an unsupported discount badge.
 */
export function compareOffers(offers: readonly ComparableOffer[]): OfferComparison {
  const empty: OfferComparison = {
    lowestPrice: null,
    highestPrice: null,
    lowestTotalPrice: null,
    highestTotalPrice: null,
    cheapestTotalOfferId: null,
    cheapestTotalCaveat: null,
    priceSpread: null,
    priceSpreadPercent: null,
    savingsAgainstHighest: null,
    savingsPercentAgainstHighest: null,
  };
  if (offers.length === 0) return empty;

  const prices = offers.map((offer) => offer.currentPrice);
  const lowestPrice = Math.min(...prices);
  const highestPrice = Math.max(...prices);

  const withTotals = offers
    .map((offer) => ({ offer, total: offerTotalPrice(offer) }))
    .filter((entry): entry is { offer: ComparableOffer; total: number } => entry.total != null);

  const totals = withTotals.map((entry) => entry.total);
  const lowestTotalPrice = totals.length > 0 ? Math.min(...totals) : null;
  const highestTotalPrice = totals.length > 0 ? Math.max(...totals) : null;

  const purchasable = withTotals.filter((entry) => PURCHASABLE.has(entry.offer.availability));
  const winner = purchasable.reduce<{ offer: ComparableOffer; total: number } | null>(
    (best, entry) =>
      best == null || entry.total < best.total || (entry.total === best.total && entry.offer.id < best.offer.id)
        ? entry
        : best,
    null,
  );

  let caveat: string | null = null;
  if (winner && lowestTotalPrice != null && winner.total > lowestTotalPrice) {
    const cheaper = withTotals.find((entry) => entry.total === lowestTotalPrice);
    caveat = cheaper
      ? `A cheaper total of ${cheaper.total.toFixed(2)} is listed at ${cheaper.offer.storeName}, but it is not currently available to buy.`
      : null;
  }
  const unlisted = offers.length - withTotals.length;
  if (unlisted > 0) {
    const note = `${unlisted} ${unlisted === 1 ? 'offer does' : 'offers do'} not publish a delivery cost, so ${unlisted === 1 ? 'its' : 'their'} total cannot be compared.`;
    caveat = caveat ? `${caveat} ${note}` : note;
  }

  const spread =
    lowestTotalPrice != null && highestTotalPrice != null
      ? round(highestTotalPrice - lowestTotalPrice)
      : null;

  return {
    lowestPrice: round(lowestPrice),
    highestPrice: round(highestPrice),
    lowestTotalPrice: lowestTotalPrice != null ? round(lowestTotalPrice) : null,
    highestTotalPrice: highestTotalPrice != null ? round(highestTotalPrice) : null,
    cheapestTotalOfferId: winner?.offer.id ?? null,
    cheapestTotalCaveat: caveat,
    priceSpread: spread,
    priceSpreadPercent:
      spread != null && lowestTotalPrice != null && lowestTotalPrice > 0
        ? round((spread / lowestTotalPrice) * 100)
        : null,
    savingsAgainstHighest: round(highestPrice - lowestPrice),
    savingsPercentAgainstHighest:
      highestPrice > 0 ? round(((highestPrice - lowestPrice) / highestPrice) * 100) : null,
  };
}
