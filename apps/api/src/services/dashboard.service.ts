import { decimalToNumber, type PrismaClient } from '@deal-finder/db';
import {
  calculatePercentChange,
  roundTo,
  type Currency,
  type DashboardResponse,
  type Notification,
  type PriceChangeEntry,
  type ProductSummary,
} from '@deal-finder/shared';
import { toProductSummary, type ProductRow } from '../mappers/product.mapper';
import { PRODUCT_SELECT, findTrackedProductIds } from './deals.service';
import { fetchHistoryContext } from './price-history.service';
import { toSavedSearch } from './saved-search.service';

/** `GET /api/dashboard` — assembled in one round trip of parallel queries. */

const RECENT_CHANGES_LIMIT = 6;
const BEST_DEALS_LIMIT = 6;
const ALERT_ACTIVITY_LIMIT = 8;
const WEEK_MS = 7 * 86_400_000;

export async function getDashboard(
  prisma: PrismaClient,
  userId: string,
): Promise<DashboardResponse> {
  const since = new Date(Date.now() - WEEK_MS);

  const [trackedProducts, activeAlerts, dealsFoundThisWeek, savedSearchRows, notificationRows] =
    await Promise.all([
      prisma.watchlistItem.count({ where: { userId } }),
      prisma.watchlistItem.count({
        where: { userId, alertsEnabled: true, targetPrice: { not: null } },
      }),
      // "Found this week" = discounted products whose price we saw change in the
      // last seven days. Counting every discounted product would never move.
      prisma.product.count({
        where: { discountPercent: { gt: 0 }, priceHistory: { some: { recordedAt: { gte: since } } } },
      }),
      prisma.savedSearch.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 6 }),
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: ALERT_ACTIVITY_LIMIT,
        select: {
          id: true,
          productId: true,
          type: true,
          message: true,
          status: true,
          priceAtAlert: true,
          sentAt: true,
          createdAt: true,
          product: { select: { name: true } },
        },
      }),
    ]);

  const [recentPriceChanges, bestDeals, estimatedSavings] = await Promise.all([
    getRecentPriceChanges(prisma, userId),
    getBestDeals(prisma, userId),
    getEstimatedSavings(prisma, userId),
  ]);

  const alertActivity: Notification[] = notificationRows.map((row) => ({
    id: row.id,
    productId: row.productId,
    productName: row.product?.name ?? null,
    type: row.type,
    message: row.message,
    status: row.status,
    priceAtAlert: decimalToNumber(row.priceAtAlert),
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    summary: {
      trackedProducts,
      activeAlerts,
      dealsFoundThisWeek,
      estimatedSavings,
      currency: 'EUR' as Currency,
    },
    recentPriceChanges,
    bestDeals,
    alertActivity,
    savedSearches: savedSearchRows.map(toSavedSearch),
  };
}

/**
 * Recent movements among the products this user tracks.
 *
 * Compares each tracked product's two most recent observations. Only products
 * that actually moved are returned, because a list of unchanged prices is not
 * "recent price changes".
 */
async function getRecentPriceChanges(
  prisma: PrismaClient,
  userId: string,
): Promise<PriceChangeEntry[]> {
  const tracked = await prisma.watchlistItem.findMany({
    where: { userId },
    select: { productId: true },
  });
  const productIds = tracked.map((item) => item.productId);
  if (productIds.length === 0) return [];

  const [products, { statistics, recentHistory }] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: productIds } }, select: PRODUCT_SELECT }),
    fetchHistoryContext(prisma, productIds),
  ]);

  const entries: PriceChangeEntry[] = [];

  for (const product of products) {
    const window = recentHistory.get(product.id) ?? [];
    const latest = window[window.length - 1];
    const previous = window[window.length - 2];
    if (!latest || !previous) continue;

    const currentPrice = Number(latest.price);
    const previousPrice = Number(previous.price);
    if (currentPrice === previousPrice) continue;

    entries.push({
      product: toProductSummary(product as ProductRow, {
        statistics: statistics.get(product.id),
        recentHistory: window,
        isTracked: true,
      }),
      previousPrice: roundTo(previousPrice),
      currentPrice: roundTo(currentPrice),
      changePercent: calculatePercentChange(previousPrice, currentPrice),
      changedAt: latest.recordedAt.toISOString(),
    });
  }

  // Biggest drops first — that is the actionable end of the list.
  return entries
    .sort((a, b) => a.changePercent - b.changePercent)
    .slice(0, RECENT_CHANGES_LIMIT);
}

async function getBestDeals(prisma: PrismaClient, userId: string): Promise<ProductSummary[]> {
  const rows = await prisma.product.findMany({
    where: { discountPercent: { gt: 0 }, availability: { in: ['IN_STOCK', 'LOW_STOCK'] } },
    select: PRODUCT_SELECT,
    orderBy: [{ discountPercent: 'desc' }, { currentPrice: 'asc' }],
    take: BEST_DEALS_LIMIT,
  });

  const ids = rows.map((row) => row.id);
  const [{ statistics, recentHistory }, trackedIds] = await Promise.all([
    fetchHistoryContext(prisma, ids),
    findTrackedProductIds(prisma, userId, ids),
  ]);

  return rows.map((row) =>
    toProductSummary(row as ProductRow, {
      statistics: statistics.get(row.id),
      recentHistory: recentHistory.get(row.id),
      isTracked: trackedIds.has(row.id),
    }),
  );
}

/**
 * Estimated savings across tracked products: for each, how far its current
 * price sits below its own recorded average.
 *
 * An estimate of what tracking has been worth, not a claim about money the user
 * definitely saved — the UI labels it accordingly.
 */
async function getEstimatedSavings(prisma: PrismaClient, userId: string): Promise<number> {
  const tracked = await prisma.watchlistItem.findMany({
    where: { userId },
    select: { product: { select: { id: true, currentPrice: true } } },
  });
  if (tracked.length === 0) return 0;

  const productIds = tracked.map((item) => item.product.id);
  const aggregates = await prisma.priceHistory.groupBy({
    by: ['productId'],
    where: { productId: { in: productIds } },
    _avg: { price: true },
  });

  const averageByProduct = new Map(
    aggregates.map((row) => [row.productId, decimalToNumber(row._avg.price)]),
  );

  let total = 0;
  for (const item of tracked) {
    const average = averageByProduct.get(item.product.id);
    if (average == null) continue;
    const difference = average - Number(item.product.currentPrice);
    if (difference > 0) total += difference;
  }

  return roundTo(total);
}
