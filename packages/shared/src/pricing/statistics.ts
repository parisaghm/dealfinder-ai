import type { PriceStatistics, PriceTrend } from '../schemas/price';
import { calculatePercentChange, roundTo } from './discount';

/**
 * Aggregation over recorded price history.
 *
 * Accepts `Date` or ISO string timestamps so the same helpers work on Prisma
 * rows (Date) and on API payloads (string) without conversion at every call
 * site.
 */

export interface PricePointInput {
  price: number;
  recordedAt: Date | string;
}

interface NormalisedPoint {
  price: number;
  time: number;
  iso: string;
}

/**
 * Drop unusable observations and sort oldest → newest.
 *
 * Third-party data contains nulls, NaN and negative sentinels; scoring on
 * those would silently produce nonsense, so they are discarded here once
 * rather than guarded against in every consumer.
 */
function normalise(points: readonly PricePointInput[]): NormalisedPoint[] {
  const result: NormalisedPoint[] = [];

  for (const point of points) {
    if (typeof point?.price !== 'number' || !Number.isFinite(point.price) || point.price < 0) {
      continue;
    }
    const date = point.recordedAt instanceof Date ? point.recordedAt : new Date(point.recordedAt);
    const time = date.getTime();
    if (Number.isNaN(time)) continue;

    result.push({ price: point.price, time, iso: date.toISOString() });
  }

  return result.sort((a, b) => a.time - b.time);
}

const EMPTY_STATISTICS: PriceStatistics = {
  lowest: null,
  highest: null,
  average: null,
  latestPrice: null,
  previousPrice: null,
  sampleSize: 0,
  firstRecordedAt: null,
  lastRecordedAt: null,
};

export function calculatePriceStatistics(points: readonly PricePointInput[]): PriceStatistics {
  const sorted = normalise(points);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return { ...EMPTY_STATISTICS };

  let lowest = first.price;
  let highest = first.price;
  let total = 0;
  for (const point of sorted) {
    if (point.price < lowest) lowest = point.price;
    if (point.price > highest) highest = point.price;
    total += point.price;
  }

  const previous = sorted.length > 1 ? sorted[sorted.length - 2] : undefined;

  return {
    lowest: roundTo(lowest),
    highest: roundTo(highest),
    average: roundTo(total / sorted.length),
    latestPrice: roundTo(last.price),
    previousPrice: previous ? roundTo(previous.price) : null,
    sampleSize: sorted.length,
    firstRecordedAt: first.iso,
    lastRecordedAt: last.iso,
  };
}

/** How far back the trend comparison looks, in observations. */
export const TREND_WINDOW = 6;

/** Below this absolute percentage change the price counts as flat. */
export const TREND_STABLE_THRESHOLD_PERCENT = 0.5;

/**
 * Direction of travel over the most recent `window` observations.
 *
 * Compares the oldest and newest price inside the window rather than fitting a
 * regression: the result is trivially explainable in the UI ("down 12% over
 * the last 6 checks"), which matters more here than statistical elegance.
 */
export function calculatePriceTrend(
  points: readonly PricePointInput[],
  window: number = TREND_WINDOW,
): PriceTrend {
  const sorted = normalise(points);
  const size = Math.max(2, Math.floor(window));
  const recent = sorted.slice(-size);

  const oldest = recent[0];
  const newest = recent[recent.length - 1];
  if (!oldest || !newest || recent.length < 2) {
    return { direction: 'UNKNOWN', changePercent: 0, sampleSize: recent.length };
  }

  const changePercent = calculatePercentChange(oldest.price, newest.price);
  const direction =
    Math.abs(changePercent) < TREND_STABLE_THRESHOLD_PERCENT
      ? 'STABLE'
      : changePercent < 0
        ? 'FALLING'
        : 'RISING';

  return { direction, changePercent, sampleSize: recent.length };
}

/**
 * Series for the price-history chart, oldest first, with ISO timestamps.
 * Returned separately from the statistics so the chart and the summary cards
 * cannot disagree about the underlying data.
 */
export function toPriceSeries(
  points: readonly PricePointInput[],
): Array<{ price: number; recordedAt: string }> {
  return normalise(points).map((point) => ({ price: roundTo(point.price), recordedAt: point.iso }));
}
