import { describe, expect, it } from 'vitest';
import { buildBestPriceSeries, crossStoreLow, type StorePriceSeries } from './best-price-series';

const NOW = new Date('2026-07-10T12:00:00.000Z');

function day(offsetFromStart: number): string {
  return new Date(Date.UTC(2026, 6, 1 + offsetFromStart)).toISOString();
}

function series(storeSlug: string, points: Array<[number, number]>): StorePriceSeries {
  return {
    storeSlug,
    storeName: storeSlug.charAt(0).toUpperCase() + storeSlug.slice(1),
    points: points.map(([offset, price]) => ({ price, recordedAt: day(offset) })),
  };
}

describe('buildBestPriceSeries', () => {
  it('returns nothing when no store has any history', () => {
    expect(buildBestPriceSeries([], { days: 30, now: NOW })).toEqual([]);
    expect(
      buildBestPriceSeries([{ storeSlug: 'a', storeName: 'A', points: [] }], { days: 30, now: NOW }),
    ).toEqual([]);
  });

  it('tracks a single store exactly', () => {
    const result = buildBestPriceSeries([series('gigantti', [[0, 400], [3, 350]])], {
      days: 30,
      now: NOW,
    });
    expect(result.map((point) => point.price)).toEqual([400, 350]);
    expect(result.every((point) => point.storeSlug === 'gigantti')).toBe(true);
  });

  // History records *changes*, not polls. A store whose price has not moved for
  // a week has no rows for that week and must not drop out of the minimum.
  it('forward-fills a store across the gaps in its history', () => {
    const result = buildBestPriceSeries(
      [series('gigantti', [[0, 400]]), series('power', [[5, 380]])],
      { days: 30, now: NOW },
    );
    expect(result[0]).toMatchObject({ price: 400, storeSlug: 'gigantti' });
    expect(result[1]).toMatchObject({ price: 380, storeSlug: 'power' });
  });

  it('takes the cheapest across stores on each day', () => {
    const result = buildBestPriceSeries(
      [
        series('gigantti', [[0, 400], [4, 300]]),
        series('power', [[0, 380], [6, 420]]),
      ],
      { days: 30, now: NOW },
    );
    expect(result[0]).toMatchObject({ price: 380, storeSlug: 'power' });
    expect(result[1]).toMatchObject({ price: 300, storeSlug: 'gigantti' });
  });

  it('emits a point only when the winning price or store changes', () => {
    const result = buildBestPriceSeries([series('gigantti', [[0, 400], [2, 400], [4, 400]])], {
      days: 30,
      now: NOW,
    });
    expect(result).toHaveLength(1);
  });

  it('never invents a price before a store was first observed', () => {
    // Claiming to know what Power charged before we ever looked would fabricate
    // exactly the history this product exists to keep honest.
    const result = buildBestPriceSeries(
      [series('gigantti', [[0, 400]]), series('power', [[5, 100]])],
      { days: 30, now: NOW },
    );
    expect(result[0]?.storeSlug).toBe('gigantti');
    expect(Date.parse(result[1]?.recordedAt ?? '')).toBeGreaterThan(Date.parse(day(4)));
  });

  it('honours the requested window', () => {
    const wide = buildBestPriceSeries([series('gigantti', [[0, 400], [8, 300]])], {
      days: 90,
      now: NOW,
    });
    const narrow = buildBestPriceSeries([series('gigantti', [[0, 400], [8, 300]])], {
      days: 2,
      now: NOW,
    });
    expect(wide.length).toBeGreaterThan(narrow.length);
    expect(narrow.every((point) => Date.parse(point.recordedAt) >= Date.parse(day(7)))).toBe(true);
  });

  it('is deterministic for an injected clock', () => {
    const input = [series('gigantti', [[0, 400], [4, 300]]), series('power', [[2, 350]])];
    expect(buildBestPriceSeries(input, { days: 30, now: NOW })).toEqual(
      buildBestPriceSeries(input, { days: 30, now: NOW }),
    );
  });

  it('ignores unparseable observations rather than emitting NaN', () => {
    const result = buildBestPriceSeries(
      [
        {
          storeSlug: 'gigantti',
          storeName: 'Gigantti',
          points: [
            { price: Number.NaN, recordedAt: day(0) },
            { price: 300, recordedAt: day(1) },
          ],
        },
      ],
      { days: 30, now: NOW },
    );
    expect(result.every((point) => Number.isFinite(point.price))).toBe(true);
    expect(result[0]?.price).toBe(300);
  });
});

describe('crossStoreLow', () => {
  it('finds the lowest price ever recorded anywhere, and where', () => {
    const low = crossStoreLow([
      series('gigantti', [[0, 400], [4, 329]]),
      series('power', [[0, 380], [6, 299]]),
    ]);
    expect(low).toMatchObject({ price: 299, storeSlug: 'power' });
  });

  it('returns null when there is no history at all', () => {
    expect(crossStoreLow([])).toBeNull();
    expect(crossStoreLow([{ storeSlug: 'a', storeName: 'A', points: [] }])).toBeNull();
  });
});
