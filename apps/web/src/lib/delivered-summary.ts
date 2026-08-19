import { toMoneyAmount, type DeliveredComparison, type DestinationOffer, type MoneyAmountDto } from '@deal-finder/shared';

/**
 * The page-level summary of a destination-aware offer set.
 *
 * Exists because the compare page used to headline `OfferComparison` — the
 * destination-*agnostic* summary built from `Product.shippingPrice` — above a
 * table built from `DeliveredComparison`. The two disagree routinely and
 * spectacularly: a group whose three listings publish no legacy shipping cost
 * yields `cheapestTotalOfferId: null`, so the page announced "no offer publishes
 * both a price and a delivery cost" directly above three delivered totals and a
 * row badged "Cheapest delivered total".
 *
 * So every figure here is derived from the *same* `comparison` and `offers` the
 * table renders, and nothing falls back to the legacy set. The winner is not
 * recomputed either — it is looked up by the id the API already chose through the
 * shared ranking rules, which is the only way the summary and the badge can be
 * guaranteed to name one store rather than two.
 */
export interface DeliveredSummary {
  /**
   * Offers with a comparable delivered total: they ship to the destination and
   * their total is known.
   *
   * Derived from the counts rather than by re-filtering `offers`, because
   * `offers` is the *page's* slice and the counts describe the whole comparison.
   * `storesShippingToDestination` counts shippable offers and
   * `offersWithUnknownShipping` counts the shippable ones whose delivery cost is
   * unpublished, so the difference is exactly the comparable set — the same set
   * `lowestDeliveredPrice` and `highestDeliveredPrice` are drawn from.
   */
  comparableCount: number;
  /** The offer the API crowned, when it is on this page. */
  winner: DestinationOffer | null;
  /**
   * The delivered total the page headlines.
   *
   * The *winner's* total, not `lowestDeliveredPrice`. Those differ whenever a
   * cheaper offer was passed over for being unpurchasable or for resting on a
   * stale exchange rate, and in that case the lowest figure is precisely the one
   * a shopper must not be sent to act on. The table explains the gap in its
   * caveat line; the summary must agree with the badge.
   */
  cheapest: MoneyAmountDto | null;
  /** Dearest minus cheapest across comparable delivered totals only. */
  spread: MoneyAmountDto | null;
  /** That spread against the lowest total, mirroring `priceSpreadPercent`. */
  spreadPercent: number | null;
}

const EMPTY: DeliveredSummary = {
  comparableCount: 0,
  winner: null,
  cheapest: null,
  spread: null,
  spreadPercent: null,
};

/**
 * Summarise the offer set the delivered comparison table is showing.
 *
 * Pure and total: an empty offer list, a comparison naming a winner that is not
 * in the list, and a comparison with no winner at all each produce a summary that
 * claims nothing rather than one that guesses.
 */
export function summariseDeliveredOffers(
  offers: readonly DestinationOffer[],
  comparison: DeliveredComparison,
): DeliveredSummary {
  const comparableCount = Math.max(
    0,
    comparison.storesShippingToDestination - comparison.offersWithUnknownShipping,
  );

  const winner =
    comparison.cheapestDeliveredOfferId == null
      ? null
      : (offers.find((offer) => offer.id === comparison.cheapestDeliveredOfferId) ?? null);

  if (comparableCount === 0) return { ...EMPTY, winner, cheapest: null };

  const lowest = comparison.lowestDeliveredPrice;
  const highest = comparison.highestDeliveredPrice;

  /*
    Subtracted in minor units, never in the float mirror: 126.9 - 114.95 is
    11.949999999999999 in binary floating point, and this figure is rendered as
    money. `toMoneyAmount` regenerates the float from the integer once.
  */
  const spread =
    lowest != null && highest != null
      ? toMoneyAmount({
          minorUnits: highest.minorUnits - lowest.minorUnits,
          currency: lowest.currency,
        })
      : null;

  return {
    comparableCount,
    winner,
    // Null when the crowned offer is not on this page: a total with no row to
    // point at is not something the summary can stand behind.
    cheapest: winner?.delivery.totalDeliveredPrice ?? null,
    spread,
    spreadPercent:
      spread != null && lowest != null && lowest.minorUnits > 0
        ? Math.round((spread.minorUnits / lowest.minorUnits) * 1000) / 10
        : null,
  };
}
