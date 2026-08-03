import { describe, expect, it } from 'vitest';
import {
  DELIVERED_SORT_OPTIONS,
  compareDeliveredOffers,
  listedAndDeliveredDisagree,
  sortDeliveredOffers,
  type DeliveredSortableOffer,
} from './delivered-sort';

function offer(overrides: Partial<DeliveredSortableOffer> = {}): DeliveredSortableOffer {
  return {
    id: 'offer-1',
    storeName: 'Test Store',
    shipsToDestination: true,
    deliveredMinorUnits: 31190,
    listedMinorUnits: 29900,
    availability: 'IN_STOCK',
    blocksCheapestClaim: false,
    deliveryMaxDays: 6,
    discountPercent: 0,
    lastCheckedAt: '2026-08-02T10:00:00.000Z',
    dealQuality: { score: 50 },
    ...overrides,
  };
}

/**
 * The cross-border quartet from the plan. Deliberately mirrors the fixture the
 * web and E2E suites use, so a change in ranking rules fails here first.
 */
const QUARTET: DeliveredSortableOffer[] = [
  // Cheapest DELIVERED: 299 + 12.90 shipping to Finland.
  offer({
    id: 'techhalle',
    storeName: 'TechHalle GmbH',
    listedMinorUnits: 29900,
    deliveredMinorUnits: 31190,
    deliveryMaxDays: 6,
  }),
  // Dearer listing, free delivery.
  offer({
    id: 'gigantti',
    storeName: 'Gigantti',
    listedMinorUnits: 32900,
    deliveredMinorUnits: 32900,
    deliveryMaxDays: 3,
  }),
  // Cheapest LISTED, but shipping to Finland is unpublished.
  offer({
    id: 'nordbyte',
    storeName: 'Nordbyte AB',
    listedMinorUnits: 27753,
    deliveredMinorUnits: null,
    deliveryMaxDays: null,
  }),
  // Cannot reach the destination at all.
  offer({
    id: 'maison',
    storeName: 'Maison Numérique SAS',
    shipsToDestination: false,
    listedMinorUnits: 28900,
    deliveredMinorUnits: null,
  }),
];

describe('sortDeliveredOffers', () => {
  it('ranks by delivered total, not by listed price', () => {
    const sorted = sortDeliveredOffers(QUARTET, 'lowest-delivered');
    expect(sorted.map((entry) => entry.id)).toEqual([
      'techhalle', // 311.90 delivered
      'gigantti', // 329.00 delivered
      'nordbyte', // delivered unknown
      'maison', // does not ship here
    ]);
  });

  it('sorts an unknown delivered total last, never first', () => {
    const sorted = sortDeliveredOffers(QUARTET, 'lowest-delivered');
    expect(sorted[sorted.length - 2]?.id).toBe('nordbyte');
  });

  it('always sorts a non-shipping offer after every shipping one, whatever the mode', () => {
    for (const sort of DELIVERED_SORT_OPTIONS) {
      const sorted = sortDeliveredOffers(QUARTET, sort);
      expect(sorted[sorted.length - 1]?.id).toBe('maison');
    }
  });

  it('ranks by listed price under lowest-price, which disagrees with delivered', () => {
    const sorted = sortDeliveredOffers(QUARTET, 'lowest-price');
    // Cheapest listing wins here even though its delivered total is unknown.
    expect(sorted[0]?.id).toBe('nordbyte');
  });

  it('ranks by delivery speed under fastest-delivery, unknown estimates last', () => {
    const sorted = sortDeliveredOffers(QUARTET, 'fastest-delivery');
    expect(sorted[0]?.id).toBe('gigantti');
    expect(sorted[2]?.id).toBe('nordbyte');
  });

  it('never mutates the input array', () => {
    const input = [...QUARTET];
    const snapshot = input.map((entry) => entry.id);
    sortDeliveredOffers(input, 'lowest-delivered');
    expect(input.map((entry) => entry.id)).toEqual(snapshot);
  });

  it.each(DELIVERED_SORT_OPTIONS)('is a total, deterministic order under %s', (sort) => {
    const once = sortDeliveredOffers(QUARTET, sort).map((entry) => entry.id);
    const reversed = sortDeliveredOffers([...QUARTET].reverse(), sort).map((entry) => entry.id);
    expect(once).toEqual(reversed);
  });

  it('handles an empty set', () => {
    expect(sortDeliveredOffers([], 'lowest-delivered')).toEqual([]);
  });
});

describe('compareDeliveredOffers', () => {
  it('crowns the cheapest delivered total, not the cheapest listing', () => {
    const result = compareDeliveredOffers(QUARTET);
    expect(result.cheapestDeliveredOfferId).toBe('techhalle');
    expect(result.lowestDeliveredMinorUnits).toBe(31190);
    // The cheapest listing is Nordbyte at 277.53 and it does not win.
    expect(result.lowestListedMinorUnits).toBe(27753);
  });

  it('counts stores shipping to the destination from offers, not store metadata', () => {
    const result = compareDeliveredOffers(QUARTET);
    expect(result.storesShippingToDestination).toBe(3);
    expect(result.offersNotShippingToDestination).toBe(1);
  });

  it('counts and explains offers with unpublished shipping rather than dropping them', () => {
    const result = compareDeliveredOffers(QUARTET);
    expect(result.offersWithUnknownShipping).toBe(1);
    expect(result.cheapestDeliveredCaveat).toMatch(/does not publish a delivery cost/i);
  });

  it('says how many stores cannot reach the destination', () => {
    const result = compareDeliveredOffers(QUARTET);
    expect(result.cheapestDeliveredCaveat).toMatch(/1 store does not ship to this destination/i);
  });

  it('never treats an unknown delivered total as free', () => {
    const result = compareDeliveredOffers([
      offer({ id: 'unknown', deliveredMinorUnits: null, listedMinorUnits: 100 }),
      offer({ id: 'known', deliveredMinorUnits: 50000, listedMinorUnits: 49000 }),
    ]);
    expect(result.cheapestDeliveredOfferId).toBe('known');
  });

  it('refuses to crown an offer that cannot be bought, and says why', () => {
    const result = compareDeliveredOffers([
      offer({ id: 'cheap-oos', deliveredMinorUnits: 20000, availability: 'OUT_OF_STOCK' }),
      offer({ id: 'dearer-in-stock', deliveredMinorUnits: 25000 }),
    ]);
    expect(result.cheapestDeliveredOfferId).toBe('dearer-in-stock');
    expect(result.cheapestDeliveredCaveat).toMatch(/not currently available to buy/i);
    // The cheaper total is still reported — it is real, just not actionable.
    expect(result.lowestDeliveredMinorUnits).toBe(20000);
  });

  it('refuses to crown an offer whose exchange rate is too stale to trust', () => {
    const result = compareDeliveredOffers([
      offer({ id: 'stale-cheap', deliveredMinorUnits: 20000, blocksCheapestClaim: true }),
      offer({ id: 'fresh-dearer', deliveredMinorUnits: 25000 }),
    ]);
    expect(result.cheapestDeliveredOfferId).toBe('fresh-dearer');
    expect(result.offersBlockedByExchangeRate).toBe(1);
    expect(result.cheapestDeliveredCaveat).toMatch(/exchange rate is too old/i);
  });

  it('shows a stale-rate total rather than hiding it', () => {
    // Barred from winning is not the same as concealed: the offer is genuinely
    // relevant and the user is entitled to see it, labelled.
    const result = compareDeliveredOffers([
      offer({ id: 'stale', deliveredMinorUnits: 20000, blocksCheapestClaim: true }),
    ]);
    expect(result.lowestDeliveredMinorUnits).toBe(20000);
    expect(result.cheapestDeliveredOfferId).toBeNull();
  });

  it('treats PREORDER and LOW_STOCK as buyable, matching offer-sort', () => {
    for (const availability of ['LOW_STOCK', 'PREORDER'] as const) {
      const result = compareDeliveredOffers([offer({ id: 'x', availability })]);
      expect(result.cheapestDeliveredOfferId).toBe('x');
    }
  });

  it('breaks a delivered-total tie deterministically by id', () => {
    const result = compareDeliveredOffers([
      offer({ id: 'bbb', deliveredMinorUnits: 10000 }),
      offer({ id: 'aaa', deliveredMinorUnits: 10000 }),
    ]);
    expect(result.cheapestDeliveredOfferId).toBe('aaa');
  });

  it('reports nothing rather than guessing for an empty set', () => {
    const result = compareDeliveredOffers([]);
    expect(result.cheapestDeliveredOfferId).toBeNull();
    expect(result.lowestDeliveredMinorUnits).toBeNull();
    expect(result.cheapestDeliveredCaveat).toBeNull();
  });

  it('has no caveat when every offer is comparable and buyable', () => {
    const result = compareDeliveredOffers([
      offer({ id: 'a', deliveredMinorUnits: 10000 }),
      offer({ id: 'b', deliveredMinorUnits: 12000 }),
    ]);
    expect(result.cheapestDeliveredCaveat).toBeNull();
  });

  it('excludes non-shipping offers from the delivered range entirely', () => {
    const result = compareDeliveredOffers([
      offer({ id: 'ships', deliveredMinorUnits: 30000, listedMinorUnits: 30000 }),
      offer({
        id: 'does-not',
        shipsToDestination: false,
        deliveredMinorUnits: 10000,
        listedMinorUnits: 10000,
      }),
    ]);
    // A price that cannot be delivered here is not a price here.
    expect(result.lowestDeliveredMinorUnits).toBe(30000);
    expect(result.lowestListedMinorUnits).toBe(30000);
  });
});

describe('listedAndDeliveredDisagree', () => {
  it('is true when the cheapest listing is not the cheapest delivered', () => {
    expect(listedAndDeliveredDisagree(QUARTET)).toBe(true);
  });

  it('is false when the same store wins both', () => {
    expect(
      listedAndDeliveredDisagree([
        offer({ id: 'a', listedMinorUnits: 10000, deliveredMinorUnits: 10000 }),
        offer({ id: 'b', listedMinorUnits: 20000, deliveredMinorUnits: 20000 }),
      ]),
    ).toBe(false);
  });

  it('is false when there is no delivered winner to disagree with', () => {
    expect(
      listedAndDeliveredDisagree([offer({ id: 'a', deliveredMinorUnits: null })]),
    ).toBe(false);
  });
});
