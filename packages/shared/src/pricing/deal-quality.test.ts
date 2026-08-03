import { describe, expect, it } from 'vitest';
import {
  DEAL_QUALITY_WEIGHTS,
  scoreDealQuality,
  summariseOffer,
  type DealQualityInput,
} from './deal-quality';
import type { PricePointInput } from './statistics';

function series(prices: number[], startIso = '2026-04-01T00:00:00.000Z'): PricePointInput[] {
  const start = new Date(startIso).getTime();
  return prices.map((price, index) => ({
    price,
    recordedAt: new Date(start + index * 86_400_000).toISOString(),
  }));
}

/** A steady €200 product observed 20 times — enough history for HIGH confidence. */
const steadyHistory = series(Array.from({ length: 20 }, () => 200));

function factor(result: ReturnType<typeof scoreDealQuality>, key: string) {
  const found = result.factors.find((entry) => entry.key === key);
  if (!found) throw new Error(`factor ${key} missing`);
  return found;
}

describe('weights', () => {
  it('total exactly 100 so the score is a true weighted percentage', () => {
    const total = Object.values(DEAL_QUALITY_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBe(100);
  });

  it('emits one factor per weight, and every factor is explained', () => {
    const result = scoreDealQuality({ currentPrice: 100, recentHistory: steadyHistory });
    expect(result.factors).toHaveLength(Object.keys(DEAL_QUALITY_WEIGHTS).length);
    for (const entry of result.factors) {
      expect(entry.detail.length).toBeGreaterThan(0);
      expect(entry.score).toBeGreaterThanOrEqual(0);
      expect(entry.score).toBeLessThanOrEqual(100);
    }
  });
});

describe('genuinely good deals', () => {
  it('rates an all-time-low, deeply discounted, in-stock item as excellent', () => {
    const result = scoreDealQuality({
      currentPrice: 129,
      originalPrice: 229,
      shippingPrice: 0,
      availability: 'IN_STOCK',
      recentHistory: series([220, 215, 210, 205, 200, 190, 175, 160, 145, 129]),
    });

    expect(result.label).toBe('EXCELLENT');
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.headline).toMatch(/lowest price/i);
    expect(result.claimedDiscountTrustworthy).toBe(true);
  });

  it('scores the vs-lowest factor at full marks when it matches the record low', () => {
    const result = scoreDealQuality({
      currentPrice: 150,
      recentHistory: series([200, 190, 180, 170, 160, 150]),
    });
    expect(factor(result, 'vs-lowest').score).toBe(100);
  });
});

describe('the fake-discount case', () => {
  // The core promise: a permanent "sale" where the discounted price *is* the
  // normal price must be called out, no matter how large the claimed saving.
  it('flags a claimed discount when the sale price is the usual price', () => {
    const result = scoreDealQuality({
      currentPrice: 199,
      originalPrice: 399,
      availability: 'IN_STOCK',
      recentHistory: series(Array.from({ length: 12 }, () => 199)),
    });

    expect(result.claimedDiscountTrustworthy).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/normally costs/i);
    // The advertised discount earns nothing, because our own records contradict
    // it. Crediting a 50%-off claim we can disprove would defeat the purpose.
    expect(factor(result, 'discount').score).toBe(0);
    expect(factor(result, 'discount').detail).toMatch(/does not support that claim/i);
    // With no substantiated discount and a price at its usual level, this is
    // an average price, not a deal.
    expect(result.label).toBe('AVERAGE');
    expect(result.score).toBeLessThan(55);
  });

  it('flags an original price higher than anything ever actually charged', () => {
    const result = scoreDealQuality({
      currentPrice: 149,
      originalPrice: 400,
      recentHistory: series([180, 175, 170, 165, 160, 149]),
    });

    expect(result.claimedDiscountTrustworthy).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/above the highest price/i);
  });

  it('does not accuse a store without enough history to justify it', () => {
    const result = scoreDealQuality({
      currentPrice: 199,
      originalPrice: 399,
      recentHistory: series([199, 199]),
    });
    expect(result.claimedDiscountTrustworthy).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

describe('price increases', () => {
  it('labels a mediocre offer whose price just rose as PRICE_INCREASED', () => {
    const result = scoreDealQuality({
      currentPrice: 210,
      originalPrice: null,
      availability: 'IN_STOCK',
      recentHistory: series([180, 185, 190, 195, 200, 210]),
    });

    expect(result.label).toBe('PRICE_INCREASED');
    expect(result.headline).toMatch(/went up/i);
  });

  // Retail prices wobble by cents between checks; that is not a price increase.
  it('ignores sub-half-percent noise rather than crying "price increased"', () => {
    const result = scoreDealQuality({
      currentPrice: 1199.3,
      availability: 'IN_STOCK',
      recentHistory: [
        ...series([1199, 1199.2, 1199.1, 1199, 1199.2]),
        { price: 1199.3, recordedAt: '2026-04-06T00:00:00.000Z' },
      ],
    });
    expect(result.label).not.toBe('PRICE_INCREASED');
  });

  it('does not label a still-excellent deal as PRICE_INCREASED for a token rise', () => {
    // Rose €1 from an all-time low, but remains far below the average.
    const result = scoreDealQuality({
      currentPrice: 121,
      originalPrice: 299,
      shippingPrice: 0,
      availability: 'IN_STOCK',
      recentHistory: series([290, 280, 270, 260, 240, 200, 160, 120]),
    });

    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.label).not.toBe('PRICE_INCREASED');
  });
});

describe('average pricing', () => {
  it('rates a product sitting at its usual price as average', () => {
    const result = scoreDealQuality({
      currentPrice: 200,
      originalPrice: null,
      availability: 'IN_STOCK',
      recentHistory: steadyHistory,
    });
    expect(result.label).toBe('AVERAGE');
    expect(result.score).toBeLessThan(55);
  });
});

describe('shipping', () => {
  it('scores free delivery full marks and expensive delivery poorly', () => {
    const base: DealQualityInput = { currentPrice: 100, recentHistory: steadyHistory };
    expect(factor(scoreDealQuality({ ...base, shippingPrice: 0 }), 'shipping').score).toBe(100);
    expect(factor(scoreDealQuality({ ...base, shippingPrice: 15 }), 'shipping').score).toBe(0);
  });

  it('explains the real total when delivery is charged', () => {
    const result = scoreDealQuality({
      currentPrice: 100,
      shippingPrice: 5.9,
      recentHistory: steadyHistory,
    });
    expect(factor(result, 'shipping').detail).toContain('105,9');
  });

  // Shipping must not also depress the history comparisons, or a delivery fee
  // would be counted twice against the same product.
  it('does not let shipping distort the history comparison', () => {
    const withShipping = scoreDealQuality({
      currentPrice: 200,
      shippingPrice: 20,
      recentHistory: steadyHistory,
    });
    const withoutShipping = scoreDealQuality({
      currentPrice: 200,
      shippingPrice: 0,
      recentHistory: steadyHistory,
    });
    expect(factor(withShipping, 'vs-average').score).toBe(
      factor(withoutShipping, 'vs-average').score,
    );
  });
});

describe('availability', () => {
  it('gives an out-of-stock item no credit and warns about it', () => {
    const result = scoreDealQuality({
      currentPrice: 100,
      availability: 'OUT_OF_STOCK',
      recentHistory: steadyHistory,
    });
    expect(factor(result, 'availability').score).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/out of stock/i);
  });
});

describe('confidence', () => {
  it('is LOW with no history and says so plainly', () => {
    const result = scoreDealQuality({ currentPrice: 199, originalPrice: 249 });
    expect(result.confidence).toBe('LOW');
    expect(result.headline).toMatch(/just started tracking/i);
    expect(factor(result, 'vs-average').score).toBe(50);
    expect(factor(result, 'vs-lowest').score).toBe(50);
  });

  it.each([
    { count: 4, expected: 'LOW' },
    { count: 5, expected: 'MEDIUM' },
    { count: 19, expected: 'MEDIUM' },
    { count: 20, expected: 'HIGH' },
  ])('is $expected with $count observations', ({ count, expected }) => {
    const result = scoreDealQuality({
      currentPrice: 200,
      recentHistory: series(Array.from({ length: count }, () => 200)),
    });
    expect(result.confidence).toBe(expected);
  });
});

describe('robustness and contract', () => {
  it('always returns a score inside 0–100 and a disclaimer', () => {
    const inputs: DealQualityInput[] = [
      { currentPrice: 0 },
      { currentPrice: Number.NaN, originalPrice: Number.NaN },
      { currentPrice: 1e9, originalPrice: 1, shippingPrice: -5 },
      { currentPrice: 100, recentHistory: [] },
    ];
    for (const input of inputs) {
      const result = scoreDealQuality(input);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.disclaimer).toMatch(/not financial advice/i);
    }
  });

  it('is deterministic', () => {
    const input: DealQualityInput = {
      currentPrice: 149,
      originalPrice: 199,
      recentHistory: series([190, 180, 170, 160, 149]),
    };
    expect(scoreDealQuality(input)).toEqual(scoreDealQuality(input));
  });

  it('accepts pre-computed statistics so list endpoints avoid loading full history', () => {
    const result = scoreDealQuality({
      currentPrice: 150,
      statistics: {
        lowest: 150,
        highest: 260,
        average: 220,
        latestPrice: 150,
        previousPrice: 180,
        sampleSize: 40,
        firstRecordedAt: '2026-04-01T00:00:00.000Z',
        lastRecordedAt: '2026-05-01T00:00:00.000Z',
      },
    });
    expect(result.confidence).toBe('HIGH');
    expect(factor(result, 'vs-average').detail).toMatch(/below/i);
  });
});

describe('summariseOffer', () => {
  it('returns the derived numbers a product card needs', () => {
    const summary = summariseOffer({
      currentPrice: 149,
      originalPrice: 199,
      shippingPrice: 5.9,
      recentHistory: steadyHistory,
    });
    expect(summary.discountPercent).toBe(25);
    expect(summary.effectivePrice).toBe(154.9);
    expect(summary.dealQuality.score).toBeGreaterThan(0);
  });
});
