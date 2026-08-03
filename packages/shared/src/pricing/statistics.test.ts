import { describe, expect, it } from 'vitest';
import {
  calculatePriceStatistics,
  calculatePriceTrend,
  toPriceSeries,
  type PricePointInput,
} from './statistics';

/** Build a series with one observation per day, oldest first. */
function series(prices: number[], startIso = '2026-05-01T00:00:00.000Z'): PricePointInput[] {
  const start = new Date(startIso).getTime();
  return prices.map((price, index) => ({
    price,
    recordedAt: new Date(start + index * 86_400_000).toISOString(),
  }));
}

describe('calculatePriceStatistics', () => {
  it('returns explicit nulls — not zeros — with no history', () => {
    const stats = calculatePriceStatistics([]);
    expect(stats).toEqual({
      lowest: null,
      highest: null,
      average: null,
      latestPrice: null,
      previousPrice: null,
      sampleSize: 0,
      firstRecordedAt: null,
      lastRecordedAt: null,
    });
  });

  it('computes low, high, average and the last two observations', () => {
    const stats = calculatePriceStatistics(series([200, 180, 220, 150, 170]));
    expect(stats.lowest).toBe(150);
    expect(stats.highest).toBe(220);
    expect(stats.average).toBe(184);
    expect(stats.latestPrice).toBe(170);
    expect(stats.previousPrice).toBe(150);
    expect(stats.sampleSize).toBe(5);
  });

  it('has no previous price for a single observation', () => {
    const stats = calculatePriceStatistics(series([99]));
    expect(stats.latestPrice).toBe(99);
    expect(stats.previousPrice).toBeNull();
    expect(stats.average).toBe(99);
  });

  // Provider data arrives unsorted; latest/previous must follow the clock,
  // not the array order.
  it('sorts by recorded time regardless of input order', () => {
    const stats = calculatePriceStatistics([
      { price: 100, recordedAt: '2026-05-03T00:00:00.000Z' },
      { price: 300, recordedAt: '2026-05-01T00:00:00.000Z' },
      { price: 200, recordedAt: '2026-05-02T00:00:00.000Z' },
    ]);
    expect(stats.latestPrice).toBe(100);
    expect(stats.previousPrice).toBe(200);
    expect(stats.firstRecordedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(stats.lastRecordedAt).toBe('2026-05-03T00:00:00.000Z');
  });

  it('accepts Date objects as well as ISO strings', () => {
    const stats = calculatePriceStatistics([
      { price: 120, recordedAt: new Date('2026-05-01T00:00:00.000Z') },
      { price: 100, recordedAt: new Date('2026-05-02T00:00:00.000Z') },
    ]);
    expect(stats.latestPrice).toBe(100);
    expect(stats.sampleSize).toBe(2);
  });

  it('discards malformed observations instead of poisoning the aggregate', () => {
    const stats = calculatePriceStatistics([
      ...series([100, 200]),
      { price: Number.NaN, recordedAt: '2026-05-03T00:00:00.000Z' },
      { price: -50, recordedAt: '2026-05-04T00:00:00.000Z' },
      { price: 150, recordedAt: 'not-a-date' },
    ]);
    expect(stats.sampleSize).toBe(2);
    expect(stats.average).toBe(150);
  });
});

describe('calculatePriceTrend', () => {
  it('detects a falling price', () => {
    const trend = calculatePriceTrend(series([200, 195, 190, 180, 175, 170]));
    expect(trend.direction).toBe('FALLING');
    expect(trend.changePercent).toBe(-15);
    expect(trend.sampleSize).toBe(6);
  });

  it('detects a rising price', () => {
    const trend = calculatePriceTrend(series([100, 105, 110, 120]));
    expect(trend.direction).toBe('RISING');
    expect(trend.changePercent).toBe(20);
  });

  it('treats an unchanged price as stable', () => {
    expect(calculatePriceTrend(series([150, 150, 150])).direction).toBe('STABLE');
  });

  it('treats sub-half-percent noise as stable rather than a trend', () => {
    expect(calculatePriceTrend(series([200, 200.2])).direction).toBe('STABLE');
  });

  it('reports UNKNOWN rather than guessing from a single point', () => {
    expect(calculatePriceTrend(series([150])).direction).toBe('UNKNOWN');
    expect(calculatePriceTrend([]).direction).toBe('UNKNOWN');
  });

  // Only the recent window matters: a product that was expensive months ago
  // but has been flat for weeks is not "falling" today.
  it('only considers the most recent window', () => {
    const trend = calculatePriceTrend(series([500, 400, 300, 200, 200, 200, 200, 200]), 4);
    expect(trend.direction).toBe('STABLE');
    expect(trend.sampleSize).toBe(4);
  });
});

describe('toPriceSeries', () => {
  it('returns a chart-ready series, oldest first', () => {
    const points = toPriceSeries([
      { price: 100, recordedAt: '2026-05-02T00:00:00.000Z' },
      { price: 120, recordedAt: '2026-05-01T00:00:00.000Z' },
    ]);
    expect(points).toEqual([
      { price: 120, recordedAt: '2026-05-01T00:00:00.000Z' },
      { price: 100, recordedAt: '2026-05-02T00:00:00.000Z' },
    ]);
  });
});
