import { describe, expect, it } from 'vitest';
import {
  calculateAbsoluteSaving,
  calculateDiscountPercent,
  calculateEffectivePrice,
  calculatePercentChange,
  clamp,
  compareToTarget,
  roundTo,
} from './discount';

describe('calculateDiscountPercent', () => {
  it.each([
    { current: 149, original: 199, expected: 25 },
    { current: 50, original: 100, expected: 50 },
    { current: 699, original: 999, expected: 30 },
    { current: 1, original: 100, expected: 99 },
  ])('reports $expected% off when $current replaces $original', ({ current, original, expected }) => {
    expect(calculateDiscountPercent(current, original)).toBe(expected);
  });

  it('returns 0 when no original price is advertised', () => {
    expect(calculateDiscountPercent(199, null)).toBe(0);
    expect(calculateDiscountPercent(199, undefined)).toBe(0);
  });

  // A store listing an "original" at or below the price being charged is the
  // fake-sale case the product exists to expose. It must never surface as a
  // negative discount, which would sort as if it were a bargain.
  it('never returns a negative discount', () => {
    expect(calculateDiscountPercent(199, 199)).toBe(0);
    expect(calculateDiscountPercent(249, 199)).toBe(0);
  });

  it('rejects unusable inputs rather than propagating NaN', () => {
    expect(calculateDiscountPercent(Number.NaN, 100)).toBe(0);
    expect(calculateDiscountPercent(50, Number.POSITIVE_INFINITY)).toBe(0);
    expect(calculateDiscountPercent(50, 0)).toBe(0);
    expect(calculateDiscountPercent(50, -100)).toBe(0);
  });

  it('rounds to the nearest whole percent', () => {
    // 33.4% down, 33.5% up.
    expect(calculateDiscountPercent(66.6, 100)).toBe(33);
    expect(calculateDiscountPercent(66.4, 100)).toBe(34);
  });
});

describe('calculateAbsoluteSaving', () => {
  it('reports the money saved', () => {
    expect(calculateAbsoluteSaving(149.9, 199.9)).toBe(50);
  });

  it('clamps to zero when there is no saving', () => {
    expect(calculateAbsoluteSaving(199, 149)).toBe(0);
    expect(calculateAbsoluteSaving(199, null)).toBe(0);
  });
});

describe('calculateEffectivePrice', () => {
  it('adds shipping, because delivery is part of what you pay', () => {
    expect(calculateEffectivePrice(89.9, 5.9)).toBe(95.8);
  });

  it('treats missing or negative shipping as zero', () => {
    expect(calculateEffectivePrice(89.9, null)).toBe(89.9);
    expect(calculateEffectivePrice(89.9, undefined)).toBe(89.9);
    expect(calculateEffectivePrice(89.9, -10)).toBe(89.9);
  });
});

describe('calculatePercentChange', () => {
  it('is negative for a drop and positive for a rise', () => {
    expect(calculatePercentChange(100, 80)).toBe(-20);
    expect(calculatePercentChange(100, 125)).toBe(25);
  });

  it('returns 0 without a usable baseline', () => {
    expect(calculatePercentChange(0, 80)).toBe(0);
    expect(calculatePercentChange(Number.NaN, 80)).toBe(0);
  });
});

describe('compareToTarget', () => {
  it('marks the target reached at exactly the target price', () => {
    expect(compareToTarget(150, 150)).toEqual({ difference: 0, percentAway: 0, reached: true });
  });

  it('reports how far above the target the price still is', () => {
    expect(compareToTarget(180, 150)).toEqual({ difference: 30, percentAway: 20, reached: false });
  });

  it('reports a negative difference when the target is beaten', () => {
    const result = compareToTarget(120, 150);
    expect(result.difference).toBe(-30);
    expect(result.reached).toBe(true);
  });
});

describe('roundTo / clamp', () => {
  it('avoids binary float artefacts', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
  });

  it('clamps into range and falls back to the minimum for NaN', () => {
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(Number.NaN, 0, 100)).toBe(0);
  });
});
