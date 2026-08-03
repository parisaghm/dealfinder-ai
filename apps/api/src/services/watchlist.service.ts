import { decimalToNumber, type Prisma, type PrismaClient } from '@deal-finder/db';
import {
  compareToTarget,
  countryName,
  roundTo,
  type AlertStatus,
  type CountryCode,
  type CreateWatchlistItemInput,
  type Currency,
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
  product: {
    select: {
      ...PRODUCT_SELECT,
      /**
       * The offers for this listing, so a row can show the delivered total for
       * the destination it tracks.
       *
       * Selected wholesale rather than filtered per row: a watchlist is small and
       * bounded by what one person chose to track, and filtering per item would
       * mean one query per row. The row picks its own destination out of this set.
       */
      storeOffers: {
        select: {
          countryCode: true,
          currency: true,
          totalDeliveredPrice: true,
          shippingPrice: true,
        },
      },
    },
  },
} satisfies Prisma.WatchlistItemInclude;

type WatchlistRow = Prisma.WatchlistItemGetPayload<{ include: typeof WATCHLIST_INCLUDE }>;

/**
 * Derive the alert state shown in the UI.
 *
 * Paused wins over everything: if the user turned alerts off, telling them a
 * target was reached would be misleading, because no email is coming.
 *
 * A delivered-price target takes precedence over a list-price one when both are
 * set, because the delivered figure is the one the user actually pays. If a
 * delivered target is set but the delivered total is unknown, the status is
 * `WAITING` rather than `TARGET_REACHED` — an unknown total has not been shown to
 * beat anything.
 */
export function deriveAlertStatus(args: {
  alertsEnabled: boolean;
  targetPrice: number | null;
  currentPrice: number;
  targetDeliveredPrice?: number | null;
  currentDeliveredPrice?: number | null;
}): AlertStatus {
  if (!args.alertsEnabled) return 'PAUSED';

  if (args.targetDeliveredPrice != null) {
    if (args.currentDeliveredPrice == null) return 'WAITING';
    return args.currentDeliveredPrice <= args.targetDeliveredPrice ? 'TARGET_REACHED' : 'WAITING';
  }

  if (args.targetPrice == null) return 'NO_TARGET';
  return args.currentPrice <= args.targetPrice ? 'TARGET_REACHED' : 'WAITING';
}

function toWatchlistItem(
  row: WatchlistRow,
  context: Parameters<typeof toProductSummary>[1],
): WatchlistItem {
  const product = toProductSummary(row.product as ProductRow, { ...context, isTracked: true });
  const targetPrice = decimalToNumber(row.targetPrice);
  const targetDeliveredPrice = decimalToNumber(row.targetDeliveredPrice);
  const { latestPrice, previousPrice } = product.priceStatistics;

  // The offer matching the destination and currency this row tracks. Absent means
  // no offer proves delivery is possible there, which is reported as an unknown
  // delivered price rather than silently falling back to the list price.
  const offer = row.product.storeOffers.find(
    (candidate) =>
      candidate.countryCode === row.destinationCountry &&
      candidate.currency === row.preferredCurrency,
  );
  const currentDeliveredPrice = decimalToNumber(offer?.totalDeliveredPrice ?? null);

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
      targetDeliveredPrice,
      currentDeliveredPrice,
    }),
    priceChangeSincePrevious:
      latestPrice != null && previousPrice != null ? roundTo(latestPrice - previousPrice) : null,

    destinationCountry: row.destinationCountry as CountryCode,
    destinationCountryName: countryName(row.destinationCountry),
    preferredCurrency: row.preferredCurrency as Currency,
    targetDeliveredPrice,
    currentDeliveredPrice,
    // Only comparable when both the target and the actual delivered total are
    // known. An unknown delivered total cannot be "€12 away" from anything.
    deliveredComparison:
      targetDeliveredPrice == null || currentDeliveredPrice == null
        ? null
        : compareToTarget(currentDeliveredPrice, targetDeliveredPrice),
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

  // Tracking identity is (user, product, destination, currency) — so the same
  // product can be tracked for Finland and Germany independently.
  const exact = await prisma.watchlistItem.findUnique({
    where: {
      userId_productId_destinationCountry_preferredCurrency: {
        userId,
        productId: input.productId,
        destinationCountry: input.destinationCountry,
        preferredCurrency: input.preferredCurrency,
      },
    },
    select: { id: true },
  });
  if (exact) {
    throw ApiError.conflict(
      `You are already tracking this product for delivery to ${countryName(input.destinationCountry)} in ${input.preferredCurrency}.`,
      { watchlistItemId: exact.id, reason: 'DUPLICATE_TRACKING_TARGET' },
    );
  }

  /**
   * A near-miss that differs only by currency.
   *
   * Two currency targets for one destination is a legitimate thing to want —
   * `targetDeliveredPrice` is currency-specific, and "below €300" and "below
   * 3 200 kr" are genuinely different thresholds. But it is almost never what
   * someone means when they simply changed a dropdown, so the existing item is
   * named in the response and the client offers to update it instead. Creating
   * the second target stays possible; it just has to be asked for.
   */
  const sameDestination = await prisma.watchlistItem.findFirst({
    where: {
      userId,
      productId: input.productId,
      destinationCountry: input.destinationCountry,
    },
    select: { id: true, preferredCurrency: true },
  });
  if (sameDestination && !input.allowAdditionalCurrency) {
    throw ApiError.conflict(
      `You already track this product for delivery to ${countryName(input.destinationCountry)} in ${sameDestination.preferredCurrency}. Update that target, or confirm you want a separate ${input.preferredCurrency} target as well.`,
      {
        watchlistItemId: sameDestination.id,
        existingCurrency: sameDestination.preferredCurrency,
        requestedCurrency: input.preferredCurrency,
        reason: 'CURRENCY_ONLY_CONFLICT',
      },
    );
  }

  const row = await prisma.watchlistItem.create({
    data: {
      userId,
      productId: input.productId,
      targetPrice: input.targetPrice ?? null,
      alertsEnabled: input.alertsEnabled,
      destinationCountry: input.destinationCountry,
      preferredCurrency: input.preferredCurrency,
      targetDeliveredPrice: input.targetDeliveredPrice ?? null,
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
      ...(input.targetDeliveredPrice !== undefined
        ? { targetDeliveredPrice: input.targetDeliveredPrice }
        : {}),
      // Changing the currency updates this target in place rather than creating a
      // second one — a changed dropdown must never be the reason a user starts
      // getting two emails. A genuinely separate currency target is a distinct,
      // explicitly-confirmed action on the create path.
      ...(input.destinationCountry !== undefined
        ? { destinationCountry: input.destinationCountry }
        : {}),
      ...(input.preferredCurrency !== undefined
        ? { preferredCurrency: input.preferredCurrency }
        : {}),
      // Any change to what is being tracked, or to the threshold, restarts the
      // alert cycle so the new target can fire immediately instead of being
      // suppressed by the previous cooldown.
      ...(input.targetPrice !== undefined ||
      input.targetDeliveredPrice !== undefined ||
      input.destinationCountry !== undefined ||
      input.preferredCurrency !== undefined
        ? { lastAlertedAt: null }
        : {}),
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
