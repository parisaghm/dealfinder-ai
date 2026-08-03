import { describe, expect, it } from 'vitest';
import {
  compareOffers,
  offerTotalPrice,
  sortOffers,
  type ComparableOffer,
  type OfferSort,
} from './offer-sort';

function offer(overrides: Partial<ComparableOffer> & { id: string }): ComparableOffer {
  return {
    currentPrice: 100,
    shippingPrice: 0,
    discountPercent: 0,
    lastCheckedAt: '2026-07-01T00:00:00.000Z',
    dealQuality: { score: 50 },
    availability: 'IN_STOCK',
    storeName: 'Store',
    ...overrides,
  };
}

/**
 * The seeded Sony trio, and the whole reason this feature exists: the store
 * with the lowest listed price is not the store that costs least to buy from.
 */
const GIGANTTI = offer({
  id: 'gigantti',
  storeName: 'Gigantti',
  currentPrice: 329,
  shippingPrice: 0,
  discountPercent: 21,
  dealQuality: { score: 78 },
  lastCheckedAt: '2026-07-01T10:00:00.000Z',
});
const VERKKOKAUPPA = offer({
  id: 'verkkokauppa',
  storeName: 'Verkkokauppa.com',
  currentPrice: 319,
  shippingPrice: 12.9,
  discountPercent: 12,
  dealQuality: { score: 64 },
  lastCheckedAt: '2026-07-02T10:00:00.000Z',
});
const POWER = offer({
  id: 'power',
  storeName: 'Power',
  currentPrice: 339,
  shippingPrice: 0,
  discountPercent: 30,
  dealQuality: { score: 71 },
  lastCheckedAt: '2026-06-30T10:00:00.000Z',
});

const TRIO = [GIGANTTI, VERKKOKAUPPA, POWER];

describe('offerTotalPrice', () => {
  it('adds delivery to the listed price', () => {
    expect(offerTotalPrice(VERKKOKAUPPA)).toBe(331.9);
  });

  it('returns null when the store does not publish a delivery cost', () => {
    // Not zero. Treating an unlisted cost as free is how a comparison tool ends
    // up recommending the most expensive option.
    expect(offerTotalPrice(offer({ id: 'x', shippingPrice: null }))).toBeNull();
  });
});

describe('sortOffers', () => {
  it('orders by listed price under lowest-price', () => {
    expect(sortOffers(TRIO, 'lowest-price').map((entry) => entry.id)).toEqual([
      'verkkokauppa',
      'gigantti',
      'power',
    ]);
  });

  // The decisive one: Verkkokauppa lists cheapest but Gigantti costs least.
  it('orders by shipping-inclusive total under lowest-total', () => {
    expect(sortOffers(TRIO, 'lowest-total').map((entry) => entry.id)).toEqual([
      'gigantti',
      'verkkokauppa',
      'power',
    ]);
  });

  it('puts an offer with no published delivery cost last, never first', () => {
    const unknown = offer({ id: 'unknown', currentPrice: 1, shippingPrice: null });
    const sorted = sortOffers([...TRIO, unknown], 'lowest-total');
    expect(sorted[sorted.length - 1]?.id).toBe('unknown');
  });

  it('orders by discount under best-discount', () => {
    expect(sortOffers(TRIO, 'best-discount')[0]?.id).toBe('power');
  });

  it('orders by deal-quality score under best-deal-quality', () => {
    expect(sortOffers(TRIO, 'best-deal-quality').map((entry) => entry.id)).toEqual([
      'gigantti',
      'power',
      'verkkokauppa',
    ]);
  });

  it('orders by last check under recently-updated', () => {
    expect(sortOffers(TRIO, 'recently-updated')[0]?.id).toBe('verkkokauppa');
  });

  it('never mutates its input', () => {
    const input = [...TRIO];
    sortOffers(input, 'lowest-total');
    expect(input.map((entry) => entry.id)).toEqual(TRIO.map((entry) => entry.id));
  });

  const ALL_SORTS: OfferSort[] = [
    'lowest-total',
    'lowest-price',
    'best-discount',
    'best-deal-quality',
    'recently-updated',
  ];

  // Every comparator falls back to price then id, so two identical requests
  // return byte-identical output regardless of the input order.
  it.each(ALL_SORTS)('is total and order-independent under %s', (sort) => {
    const forwards = sortOffers(TRIO, sort).map((entry) => entry.id);
    const backwards = sortOffers([...TRIO].reverse(), sort).map((entry) => entry.id);
    expect(backwards).toEqual(forwards);
  });

  it.each(ALL_SORTS)('breaks exact ties deterministically under %s', (sort) => {
    const twins = [
      offer({ id: 'b', currentPrice: 10 }),
      offer({ id: 'a', currentPrice: 10 }),
    ];
    expect(sortOffers(twins, sort).map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});

describe('compareOffers', () => {
  it('reports both the cheapest listed price and the cheapest payable total', () => {
    const comparison = compareOffers(TRIO);
    expect(comparison.lowestPrice).toBe(319);
    expect(comparison.highestPrice).toBe(339);
    expect(comparison.lowestTotalPrice).toBe(329);
    expect(comparison.highestTotalPrice).toBe(339);
  });

  it('crowns the cheapest total, not the cheapest listing', () => {
    expect(compareOffers(TRIO).cheapestTotalOfferId).toBe('gigantti');
  });

  it('reports the spread and the saving against the dearest offer', () => {
    const comparison = compareOffers(TRIO);
    expect(comparison.priceSpread).toBe(10);
    expect(comparison.savingsAgainstHighest).toBe(20);
    expect(comparison.savingsPercentAgainstHighest).toBeCloseTo(5.9, 1);
  });

  it('never crowns an offer that cannot be bought', () => {
    const soldOut = offer({
      id: 'soldout',
      storeName: 'Elsewhere',
      currentPrice: 250,
      shippingPrice: 0,
      availability: 'OUT_OF_STOCK',
    });
    const comparison = compareOffers([...TRIO, soldOut]);
    expect(comparison.cheapestTotalOfferId).toBe('gigantti');
  });

  // Passing over a cheaper offer silently would be the same dishonesty as an
  // unsupported discount badge. It has to be stated.
  it('says why a cheaper offer was passed over', () => {
    const soldOut = offer({
      id: 'soldout',
      storeName: 'Elsewhere',
      currentPrice: 250,
      shippingPrice: 0,
      availability: 'OUT_OF_STOCK',
    });
    expect(compareOffers([...TRIO, soldOut]).cheapestTotalCaveat).toMatch(/Elsewhere/);
  });

  it('says when a delivery cost is missing, rather than assuming it is free', () => {
    const unlisted = offer({ id: 'unlisted', currentPrice: 300, shippingPrice: null });
    const comparison = compareOffers([...TRIO, unlisted]);
    expect(comparison.cheapestTotalOfferId).toBe('gigantti');
    expect(comparison.cheapestTotalCaveat).toMatch(/delivery cost/);
  });

  it('handles a single offer without inventing a comparison', () => {
    const comparison = compareOffers([GIGANTTI]);
    expect(comparison.priceSpread).toBe(0);
    expect(comparison.savingsAgainstHighest).toBe(0);
    expect(comparison.cheapestTotalOfferId).toBe('gigantti');
  });

  it('returns an empty comparison for an empty offer set', () => {
    const comparison = compareOffers([]);
    expect(comparison.cheapestTotalOfferId).toBeNull();
    expect(comparison.lowestPrice).toBeNull();
  });

  it('reports no winner when no offer publishes a delivery cost', () => {
    const comparison = compareOffers([offer({ id: 'a', shippingPrice: null })]);
    expect(comparison.cheapestTotalOfferId).toBeNull();
    expect(comparison.cheapestTotalCaveat).toMatch(/delivery cost/);
  });
});
