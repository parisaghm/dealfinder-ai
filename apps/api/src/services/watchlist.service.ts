import { decimalToNumber, type Prisma, type PrismaClient } from '@deal-finder/db';
import {
  compareToTarget,
  roundTo,
  type AlertStatus,
  type CreateWatchlistItemInput,
  type UpdateWatchlistItemInput,
  type WatchlistItem,
  type WatchlistResponse,
} from '@deal-finder/shared';
import { ApiError } from '../errors';
import { toProductSummary, type ProductRow } from '../mappers/product.mapper';
import { PRODUCT_SELECT } from './deals.service';
import { fetchHistoryContext } from './price-history.service';

/**
 * Watchlist management.
 *
 * Every mutation is scoped by `userId` in the `where` clause rather than being
 * checked afterwards. A request for another user's item therefore finds nothing
 * and returns 404 — it cannot read or modify data, and it does not reveal that
 * the id exists.
 */

const WATCHLIST_INCLUDE = {
  product: { select: PRODUCT_SELECT },
} satisfies Prisma.WatchlistItemInclude;

type WatchlistRow = Prisma.WatchlistItemGetPayload<{ include: typeof WATCHLIST_INCLUDE }>;

/**
 * Derive the alert state shown in the UI.
 *
 * Paused wins over everything: if the user turned alerts off, telling them a
 * target was reached would be misleading, because no email is coming.
 */
export function deriveAlertStatus(args: {
  alertsEnabled: boolean;
  targetPrice: number | null;
  currentPrice: number;
}): AlertStatus {
  if (!args.alertsEnabled) return 'PAUSED';
  if (args.targetPrice == null) return 'NO_TARGET';
  return args.currentPrice <= args.targetPrice ? 'TARGET_REACHED' : 'WAITING';
}

function toWatchlistItem(
  row: WatchlistRow,
  context: Parameters<typeof toProductSummary>[1],
): WatchlistItem {
  const product = toProductSummary(row.product as ProductRow, { ...context, isTracked: true });
  const targetPrice = decimalToNumber(row.targetPrice);
  const { latestPrice, previousPrice } = product.priceStatistics;

  return {
    id: row.id,
    productId: row.productId,
    targetPrice,
    alertsEnabled: row.alertsEnabled,
    lastAlertedAt: row.lastAlertedAt ? row.lastAlertedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    product,
    targetComparison:
      targetPrice == null ? null : compareToTarget(product.currentPrice, targetPrice),
    alertStatus: deriveAlertStatus({
      alertsEnabled: row.alertsEnabled,
      targetPrice,
      currentPrice: product.currentPrice,
    }),
    priceChangeSincePrevious:
      latestPrice != null && previousPrice != null ? roundTo(latestPrice - previousPrice) : null,
  };
}

/** Attach history context to a set of rows in one pair of queries. */
async function hydrate(prisma: PrismaClient, rows: WatchlistRow[]): Promise<WatchlistItem[]> {
  const productIds = rows.map((row) => row.productId);
  const { statistics, recentHistory } = await fetchHistoryContext(prisma, productIds);

  return rows.map((row) =>
    toWatchlistItem(row, {
      statistics: statistics.get(row.productId),
      recentHistory: recentHistory.get(row.productId),
    }),
  );
}

export async function listWatchlist(
  prisma: PrismaClient,
  userId: string,
): Promise<WatchlistResponse> {
  const rows = await prisma.watchlistItem.findMany({
    where: { userId },
    include: WATCHLIST_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  return { items: await hydrate(prisma, rows), total: rows.length };
}

export async function addToWatchlist(
  prisma: PrismaClient,
  userId: string,
  input: CreateWatchlistItemInput,
): Promise<WatchlistItem> {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true },
  });
  if (!product) throw ApiError.notFound('Product');

  const existing = await prisma.watchlistItem.findUnique({
    where: { userId_productId: { userId, productId: input.productId } },
    select: { id: true },
  });
  if (existing) {
    throw ApiError.conflict('You are already tracking this product.', {
      watchlistItemId: existing.id,
    });
  }

  const row = await prisma.watchlistItem.create({
    data: {
      userId,
      productId: input.productId,
      targetPrice: input.targetPrice ?? null,
      alertsEnabled: input.alertsEnabled,
    },
    include: WATCHLIST_INCLUDE,
  });

  const [item] = await hydrate(prisma, [row]);
  if (!item) throw ApiError.internal('Failed to load the created watchlist item.');
  return item;
}

export async function updateWatchlistItem(
  prisma: PrismaClient,
  userId: string,
  itemId: string,
  input: UpdateWatchlistItemInput,
): Promise<WatchlistItem> {
  // Scoped update: another user's id simply matches no rows.
  const result = await prisma.watchlistItem.updateMany({
    where: { id: itemId, userId },
    data: {
      ...(input.targetPrice !== undefined ? { targetPrice: input.targetPrice } : {}),
      ...(input.alertsEnabled !== undefined ? { alertsEnabled: input.alertsEnabled } : {}),
      // Changing the target restarts the alert cycle, so a new target can fire
      // immediately instead of being suppressed by the previous cooldown.
      ...(input.targetPrice !== undefined ? { lastAlertedAt: null } : {}),
    },
  });
  if (result.count === 0) throw ApiError.notFound('Watchlist item');

  const row = await prisma.watchlistItem.findUnique({
    where: { id: itemId },
    include: WATCHLIST_INCLUDE,
  });
  if (!row) throw ApiError.notFound('Watchlist item');

  const [item] = await hydrate(prisma, [row]);
  if (!item) throw ApiError.internal('Failed to load the updated watchlist item.');
  return item;
}

export async function removeFromWatchlist(
  prisma: PrismaClient,
  userId: string,
  itemId: string,
): Promise<void> {
  const result = await prisma.watchlistItem.deleteMany({ where: { id: itemId, userId } });
  if (result.count === 0) throw ApiError.notFound('Watchlist item');
}
