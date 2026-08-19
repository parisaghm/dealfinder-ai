import type { DeliveredComparison, DestinationOffer } from '@deal-finder/shared';
import { describe, expect, it } from 'vitest';
import { summariseDeliveredOffers } from './delivered-summary';

/**
 * The compare page's summary must be the table's own arithmetic.
 *
 * The regression these guard is a page that announced "no offer currently
 * publishes both a price and a delivery cost, so no total can be compared"
 * directly above three delivered totals and a row badged "Cheapest delivered
 * total" — because the sentence came from the legacy destination-agnostic
 * comparison and the table came from the destination-aware one.
 *
 * The offers here mirror the seeded Auralis Buds Air group delivered to Germany,
 * which is where it was found: Kanaalshop 114,95 €, TechHalle 119 €, Adriatica
 * 126,90 €, none of them publishing a legacy `Product.shippingPrice`.
 */

function money(minorUnits: number, currency = 'EUR' as const) {
  return { minorUnits, major: minorUnits / 100, currency };
}

/** Only the fields the summary reads; the rest of the DTO is irrelevant here. */
function offer(id: string, storeName: string, deliveredMinorUnits: number | null): DestinationOffer {
  return {
    id,
    productId: `product-${id}`,
    store: { id: `store-${id}`, slug: storeName.toLowerCase(), name: storeName },
    delivery: {
      totalDeliveredPrice: deliveredMinorUnits == null ? null : money(deliveredMinorUnits),
    },
  } as unknown as DestinationOffer;
}

function comparison(overrides: Partial<DeliveredComparison> = {}): DeliveredComparison {
  return {
    destinationCountry: 'DE',
    destinationCountryName: 'Germany',
    displayCurrency: 'EUR',
    lowestDeliveredPrice: money(11495),
    highestDeliveredPrice: money(12690),
    lowestListedPrice: money(10900),
    cheapestDeliveredOfferId: 'kanaalshop',
    cheapestDeliveredCaveats: [],
    storesShippingToDestination: 3,
    offersWithUnknownShipping: 0,
    offersNotShippingToDestination: 0,
    offersBlockedByExchangeRate: 0,
    ...overrides,
  } as DeliveredComparison;
}

const THREE_OFFERS = [
  offer('kanaalshop', 'Kanaalshop', 11495),
  offer('techhalle', 'TechHalle', 11900),
  offer('adriatica', 'Adriatica', 12690),
];

describe('three comparable delivered totals', () => {
  const summary = summariseDeliveredOffers(THREE_OFFERS, comparison());

  it('counts every offer that produced a comparable delivered total', () => {
    expect(summary.comparableCount).toBe(3);
  });

  it('names the same winner the table badges, not the lowest raw figure', () => {
    expect(summary.winner?.id).toBe('kanaalshop');
    expect(summary.cheapest).toEqual(money(11495));
  });

  it('spreads only across comparable delivered totals', () => {
    // 126,90 − 114,95. Asserted in minor units because the float mirror of this
    // subtraction is 11.949999999999999.
    expect(summary.spread?.minorUnits).toBe(1195);
    expect(summary.spread?.major).toBe(11.95);
    expect(summary.spread?.currency).toBe('EUR');
  });

  it('states the spread against the lowest total, as the legacy summary does', () => {
    expect(summary.spreadPercent).toBeCloseTo(10.4, 1);
  });

  it('agrees with the winning offer rather than deriving a second opinion', () => {
    // The property the bug violated: whatever the summary headlines must be the
    // delivered total of the row wearing the badge.
    const badged = THREE_OFFERS.find(
      (candidate) => candidate.id === comparison().cheapestDeliveredOfferId,
    );
    expect(summary.cheapest).toEqual(badged?.delivery.totalDeliveredPrice);
  });
});

describe('unknown shipping stays out of the summary', () => {
  it('is excluded from the comparable count', () => {
    // Four offers ship here, one publishes no delivery cost, so three compare.
    const summary = summariseDeliveredOffers(
      [...THREE_OFFERS, offer('unpublished', 'Iberica', null)],
      comparison({ storesShippingToDestination: 4, offersWithUnknownShipping: 1 }),
    );

    expect(summary.comparableCount).toBe(3);
    expect(summary.winner?.id).toBe('kanaalshop');
    expect(summary.spread?.minorUnits).toBe(1195);
  });

  it('cannot become the cheapest by having admitted the least', () => {
    const summary = summariseDeliveredOffers(
      [offer('unpublished', 'Iberica', null), ...THREE_OFFERS],
      comparison({ storesShippingToDestination: 4, offersWithUnknownShipping: 1 }),
    );

    expect(summary.winner?.id).not.toBe('unpublished');
    expect(summary.cheapest).toEqual(money(11495));
  });
});

describe('a skipped cheaper offer does not become the headline', () => {
  /*
    The API crowned TechHalle at 119 € even though 114,95 € is listed, because
    the cheaper offer is out of stock or rests on a stale rate. The summary must
    headline the crowned figure — the lowest one is the number a shopper must not
    be sent to act on — while the spread still describes the whole comparable set.
  */
  const summary = summariseDeliveredOffers(
    THREE_OFFERS,
    comparison({
      cheapestDeliveredOfferId: 'techhalle',
      offersBlockedByExchangeRate: 1,
      cheapestDeliveredCaveats: [
        {
          kind: 'cheaper-offer-skipped',
          amountMinorUnits: 11495,
          storeName: 'Kanaalshop',
          reason: 'stale-rate',
        },
      ],
    }),
  );

  it('headlines the crowned offer, not the stale-rate one', () => {
    expect(summary.winner?.id).toBe('techhalle');
    expect(summary.cheapest).toEqual(money(11900));
  });

  it('still spreads across every comparable total', () => {
    expect(summary.spread?.minorUnits).toBe(1195);
  });
});

describe('no comparable offer', () => {
  it('claims nothing when nothing ships here', () => {
    const summary = summariseDeliveredOffers(
      [],
      comparison({
        lowestDeliveredPrice: null,
        highestDeliveredPrice: null,
        lowestListedPrice: null,
        cheapestDeliveredOfferId: null,
        storesShippingToDestination: 0,
        offersNotShippingToDestination: 2,
      }),
    );

    expect(summary).toEqual({
      comparableCount: 0,
      winner: null,
      cheapest: null,
      spread: null,
      spreadPercent: null,
    });
  });

  it('claims nothing when every shippable offer hides its delivery cost', () => {
    const summary = summariseDeliveredOffers(
      [offer('a', 'Iberica', null), offer('b', 'Nordbyte', null)],
      comparison({
        lowestDeliveredPrice: null,
        highestDeliveredPrice: null,
        cheapestDeliveredOfferId: null,
        storesShippingToDestination: 2,
        offersWithUnknownShipping: 2,
      }),
    );

    expect(summary.comparableCount).toBe(0);
    expect(summary.cheapest).toBeNull();
    expect(summary.spread).toBeNull();
  });
});

describe('degenerate inputs', () => {
  it('does not headline a winner that is not on the page', () => {
    const summary = summariseDeliveredOffers(
      THREE_OFFERS,
      comparison({ cheapestDeliveredOfferId: 'somewhere-else' }),
    );

    expect(summary.winner).toBeNull();
    expect(summary.cheapest).toBeNull();
    // The set is still describable even when the winner is off-page.
    expect(summary.comparableCount).toBe(3);
    expect(summary.spread?.minorUnits).toBe(1195);
  });

  it('reports a zero spread when one offer is comparable', () => {
    const summary = summariseDeliveredOffers(
      [THREE_OFFERS[0]!],
      comparison({
        highestDeliveredPrice: money(11495),
        storesShippingToDestination: 1,
      }),
    );

    expect(summary.spread?.minorUnits).toBe(0);
    expect(summary.spreadPercent).toBe(0);
  });
});
