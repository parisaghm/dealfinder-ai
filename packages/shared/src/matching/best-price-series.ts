import type { PricePoint } from '../schemas/price';

/**
 * The cheapest-anywhere line for a canonical product's chart.
 *
 * Naively taking the minimum of whatever was recorded on each day would draw
 * nonsense, because `PriceHistory` records *changes*, not polls: a store whose
 * price has not moved for three weeks has no rows for those three weeks, and it
 * would drop out of the minimum entirely. So each store's last known price is
 * forward-filled onto a daily grid first, and the minimum is taken across the
 * filled values.
 *
 * A store is only forward-filled from its first observation onward — before
 * that, we genuinely did not know its price, and inventing one would fabricate
 * the very history the product exists to keep honest.
 *
 * Pure and deterministic given an injected `now`, so it is unit-testable
 * without a clock.
 */

export interface StorePriceSeries {
  storeSlug: string;
  storeName: string;
  points: readonly PricePoint[];
}

export interface BestPricePoint extends PricePoint {
  /** Which store held the cheapest price on that day. */
  storeSlug: string;
  storeName: string;
}

const DAY_MS = 86_400_000;

function startOfDay(value: number): number {
  return Math.floor(value / DAY_MS) * DAY_MS;
}

/**
 * Build the daily cheapest-anywhere series, emitting a point only when the
 * winning price changes — the same "record changes, not polls" convention the
 * per-store series already follows, so the two read consistently on one chart.
 */
export function buildBestPriceSeries(
  series: readonly StorePriceSeries[],
  options: { days: number; now: Date },
): BestPricePoint[] {
  const withPoints = series.filter((entry) => entry.points.length > 0);
  if (withPoints.length === 0) return [];

  const end = startOfDay(options.now.getTime());
  const windowStart = end - Math.max(0, options.days - 1) * DAY_MS;

  const earliest = Math.min(
    ...withPoints.map((entry) =>
      Math.min(...entry.points.map((point) => startOfDay(Date.parse(point.recordedAt)))),
    ),
  );
  const start = Math.max(windowStart, earliest);
  if (!Number.isFinite(start) || start > end) return [];

  // Pre-sort once per store and walk the grid with a cursor, so the whole
  // build is O(days + observations) rather than O(days × observations).
  const cursors = withPoints.map((entry) => ({
    storeSlug: entry.storeSlug,
    storeName: entry.storeName,
    points: [...entry.points]
      .map((point) => ({ price: point.price, day: startOfDay(Date.parse(point.recordedAt)) }))
      .filter((point) => Number.isFinite(point.day) && Number.isFinite(point.price))
      .sort((a, b) => a.day - b.day),
    index: 0,
    current: null as number | null,
  }));

  const result: BestPricePoint[] = [];
  let previousPrice: number | null = null;
  let previousStore: string | null = null;

  for (let day = start; day <= end; day += DAY_MS) {
    for (const cursor of cursors) {
      while (cursor.index < cursor.points.length) {
        const point = cursor.points[cursor.index];
        if (!point || point.day > day) break;
        cursor.current = point.price;
        cursor.index += 1;
      }
    }

    let bestPrice: number | null = null;
    let bestStore: { slug: string; name: string } | null = null;
    for (const cursor of cursors) {
      if (cursor.current == null) continue;
      if (bestPrice == null || cursor.current < bestPrice) {
        bestPrice = cursor.current;
        bestStore = { slug: cursor.storeSlug, name: cursor.storeName };
      }
    }

    if (bestPrice == null || bestStore == null) continue;
    if (bestPrice === previousPrice && bestStore.slug === previousStore) continue;

    result.push({
      price: bestPrice,
      recordedAt: new Date(day).toISOString(),
      storeSlug: bestStore.slug,
      storeName: bestStore.name,
    });
    previousPrice = bestPrice;
    previousStore = bestStore.slug;
  }

  return result;
}

/** The lowest price ever recorded at any store, and where. */
export function crossStoreLow(
  series: readonly StorePriceSeries[],
): { price: number; storeSlug: string; storeName: string; recordedAt: string } | null {
  let best: { price: number; storeSlug: string; storeName: string; recordedAt: string } | null = null;

  for (const entry of series) {
    for (const point of entry.points) {
      if (!Number.isFinite(point.price)) continue;
      if (best == null || point.price < best.price) {
        best = {
          price: point.price,
          storeSlug: entry.storeSlug,
          storeName: entry.storeName,
          recordedAt: point.recordedAt,
        };
      }
    }
  }

  return best;
}
