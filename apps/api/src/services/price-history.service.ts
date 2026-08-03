import { Prisma, type PrismaClient } from '@deal-finder/db';
import { calculatePriceStatistics, type PriceStatistics } from '@deal-finder/shared';
import type { PriceHistoryRow } from '../mappers/product.mapper';

/**
 * History lookups for a *page* of products.
 *
 * A list of 24 products with a price chart's worth of history each would be
 * either 24 extra queries (N+1) or tens of thousands of rows. Instead:
 *
 *  - full-history aggregates come from one `groupBy`, computed by Postgres,
 *  - the recent window needed for trend detection comes from one query using a
 *    window function, which is the only way to get "the last N rows per group"
 *    in a single round trip.
 *
 * Both are keyed by product id so the mapper can look them up in O(1).
 */

/** Observations per product used to determine the recent trend. */
export const RECENT_WINDOW_SIZE = 6;

export type StatisticsByProduct = Map<string, PriceStatistics>;
export type RecentHistoryByProduct = Map<string, PriceHistoryRow[]>;

interface AggregateRow {
  productId: string;
  _min: { price: Prisma.Decimal | null };
  _max: { price: Prisma.Decimal | null };
  _avg: { price: Prisma.Decimal | null };
  _count: { price: number };
}

interface WindowedRow {
  product_id: string;
  price: Prisma.Decimal;
  recorded_at: Date;
}

/**
 * Recent observations for each product, newest first within each product.
 *
 * Uses `ROW_NUMBER() OVER (PARTITION BY …)` because Prisma's query builder
 * cannot express a per-group limit. Parameterised, so the id list cannot be
 * injected.
 */
export async function fetchRecentHistory(
  prisma: PrismaClient,
  productIds: readonly string[],
  windowSize: number = RECENT_WINDOW_SIZE,
): Promise<RecentHistoryByProduct> {
  const result: RecentHistoryByProduct = new Map();
  if (productIds.length === 0) return result;

  const rows = await prisma.$queryRaw<WindowedRow[]>(Prisma.sql`
    SELECT product_id, price, recorded_at
    FROM (
      SELECT
        "productId" AS product_id,
        price,
        "recordedAt" AS recorded_at,
        ROW_NUMBER() OVER (PARTITION BY "productId" ORDER BY "recordedAt" DESC) AS row_number
      FROM price_history
      WHERE "productId" IN (${Prisma.join(productIds)})
    ) ranked
    WHERE row_number <= ${windowSize}
    ORDER BY product_id, recorded_at ASC
  `);

  for (const row of rows) {
    const existing = result.get(row.product_id);
    const point: PriceHistoryRow = { price: row.price, recordedAt: row.recorded_at };
    if (existing) existing.push(point);
    else result.set(row.product_id, [point]);
  }

  return result;
}

/**
 * Low / high / average / count over each product's entire history, aggregated
 * by the database rather than by loading rows into memory.
 *
 * `latestPrice` and `previousPrice` cannot come from an aggregate, so they are
 * filled in from the recent window, which is already loaded.
 */
export async function fetchStatistics(
  prisma: PrismaClient,
  productIds: readonly string[],
  recentHistory: RecentHistoryByProduct,
): Promise<StatisticsByProduct> {
  const result: StatisticsByProduct = new Map();
  if (productIds.length === 0) return result;

  const aggregates = (await prisma.priceHistory.groupBy({
    by: ['productId'],
    where: { productId: { in: [...productIds] } },
    _min: { price: true },
    _max: { price: true },
    _avg: { price: true },
    _count: { price: true },
  })) as unknown as AggregateRow[];

  for (const aggregate of aggregates) {
    const recent = recentHistory.get(aggregate.productId) ?? [];
    // Derived from the window: oldest → newest, so the last two entries are
    // the latest and previous observations.
    const windowStats = calculatePriceStatistics(
      recent.map((row) => ({ price: Number(row.price), recordedAt: row.recordedAt })),
    );

    result.set(aggregate.productId, {
      lowest: toNumber(aggregate._min.price),
      highest: toNumber(aggregate._max.price),
      average: round2(toNumber(aggregate._avg.price)),
      latestPrice: windowStats.latestPrice,
      previousPrice: windowStats.previousPrice,
      sampleSize: aggregate._count.price,
      firstRecordedAt: null,
      lastRecordedAt: windowStats.lastRecordedAt,
    });
  }

  return result;
}

/** Convenience wrapper: both lookups for one page of products. */
export async function fetchHistoryContext(
  prisma: PrismaClient,
  productIds: readonly string[],
): Promise<{ statistics: StatisticsByProduct; recentHistory: RecentHistoryByProduct }> {
  const recentHistory = await fetchRecentHistory(prisma, productIds);
  const statistics = await fetchStatistics(prisma, productIds, recentHistory);
  return { statistics, recentHistory };
}

function toNumber(value: Prisma.Decimal | null): number | null {
  if (value == null) return null;
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : null;
}

function round2(value: number | null): number | null {
  return value == null ? null : Math.round(value * 100) / 100;
}
