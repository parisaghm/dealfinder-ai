import type { Prisma, PrismaClient } from '@deal-finder/db';
import {
  isDestinationAware,
  parseSearchQuery,
  type AppliedFilters,
  type DealSort,
  type DealsQuery,
  type DealsResponse,
} from '@deal-finder/shared';
import { toProductSummary, type ProductRow } from '../mappers/product.mapper';
import { buildDealGroups } from './canonical-product.service';
import { searchDealsByDestination } from './destination-search.service';
import { fetchHistoryContext } from './price-history.service';
import { PRODUCT_SELECT } from './selects';

/**
 * Deal search.
 *
 * The database is the source of truth for listings: providers write into it
 * (via seeding, refresh or the monitor) and search reads from it. That keeps
 * search fast and available even when every store is unreachable, which is the
 * "gracefully handle unavailable stores" requirement.
 *
 * Filtering and sorting both happen in SQL against indexed columns, so sorting
 * is applied *before* pagination. Doing it in application code after fetching
 * a page would reorder within pages and silently produce wrong results — which
 * is precisely why `discountPercent` is a maintained column rather than an
 * expression computed per request.
 *
 * `searchDeals` is now a two-way switch on one thing only: whether the request
 * named a delivery country. Without one, `searchProductDeals` below runs — the
 * pre-expansion query, byte for byte, returning the pre-expansion payload with no
 * destination fields in it at all. With one, the destination-aware branch runs
 * against `store_offers`. Keeping the legacy body untouched rather than
 * generalising it is deliberate: it is the reason the existing API and end-to-end
 * suites still describe real behaviour instead of being re-baselined.
 */

const SORT_ORDER: Record<DealSort, Prisma.ProductOrderByWithRelationInput[]> = {
  // Secondary keys make ordering total: without them, rows tying on the primary
  // key could appear on two pages or on neither.
  'best-discount': [{ discountPercent: 'desc' }, { currentPrice: 'asc' }, { id: 'asc' }],
  'lowest-price': [{ currentPrice: 'asc' }, { id: 'asc' }],
  'highest-price': [{ currentPrice: 'desc' }, { id: 'asc' }],
  'recently-updated': [{ lastCheckedAt: 'desc' }, { id: 'asc' }],
  // `lowest-delivered` needs a delivered total, which only exists per
  // destination on `StoreOffer`. On this path — a search with no `country` — there
  // is no destination, so there is nothing to sort on and it degrades to the
  // nearest honest equivalent rather than silently returning an arbitrary order.
  // The destination-aware branch has its own ordering over the indexed
  // `StoreOffer.totalDeliveredPrice` column.
  'lowest-delivered': [{ currentPrice: 'asc' }, { id: 'asc' }],
};

export interface SearchDealsOptions {
  /** Marks results the user already tracks, for the Track button's state. */
  userId?: string;
}

/**
 * The entry point every caller uses. Dispatches on the presence of `country`.
 */
export async function searchDeals(
  prisma: PrismaClient,
  query: DealsQuery,
  options: SearchDealsOptions = {},
): Promise<DealsResponse> {
  if (isDestinationAware(query)) {
    return searchDealsByDestination(prisma, query, options);
  }
  return searchProductDeals(prisma, query, options);
}

/**
 * The pre-expansion search, unmodified.
 *
 * Reached only when no delivery country was requested. Nothing inside it knows
 * about destinations, offers or exchange rates, and nothing it returns mentions
 * them.
 */
export async function searchProductDeals(
  prisma: PrismaClient,
  query: DealsQuery,
  options: SearchDealsOptions = {},
): Promise<DealsResponse> {
  // Interpret the free-text box ("Laptop under €1,000"), then let explicit
  // filter fields win — a value the user typed into a field is a stronger
  // signal than one inferred from a sentence.
  const parsed = parseSearchQuery(query.query ?? '', { verticalId: query.vertical });

  const effective = {
    text: parsed.query.length > 0 ? parsed.query : undefined,
    maximumPrice: query.maximumPrice ?? parsed.maximumPrice,
    minimumDiscount: query.minimumDiscount ?? parsed.minimumDiscount,
    category: query.category ?? parsed.category,
    stores: query.stores ?? [],
  };

  const where: Prisma.ProductWhereInput = {
    vertical: query.vertical,
    ...(effective.category ? { category: effective.category } : {}),
    ...(effective.maximumPrice != null ? { currentPrice: { lte: effective.maximumPrice } } : {}),
    ...(effective.minimumDiscount != null
      ? { discountPercent: { gte: Math.round(effective.minimumDiscount) } }
      : {}),
    ...(effective.stores.length > 0 ? { store: { slug: { in: effective.stores } } } : {}),
    ...(effective.text
      ? {
          // Every term must match somewhere, so "philips headphones" does not
          // return every pair of headphones.
          AND: effective.text
            .split(/\s+/)
            .filter(Boolean)
            .map((term) => ({
              OR: [
                { name: { contains: term, mode: 'insensitive' as const } },
                { brand: { contains: term, mode: 'insensitive' as const } },
              ],
            })),
        }
      : {}),
  };

  const skip = (query.page - 1) * query.limit;

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: PRODUCT_SELECT,
      orderBy: SORT_ORDER[query.sort],
      skip,
      take: query.limit,
    }),
  ]);

  const productIds = rows.map((row) => row.id);
  const [{ statistics, recentHistory }, trackedIds] = await Promise.all([
    fetchHistoryContext(prisma, productIds),
    findTrackedProductIds(prisma, options.userId, productIds),
  ]);

  const items = rows.map((row) =>
    toProductSummary(row as ProductRow, {
      statistics: statistics.get(row.id),
      recentHistory: recentHistory.get(row.id),
      isTracked: trackedIds.has(row.id),
    }),
  );

  // Grouping is a decoration of the page that has already been selected,
  // ordered and counted. It cannot change `items`, `pagination` or `total` —
  // collapsing rows in SQL would make `total` count products-after-grouping and
  // silently break both pagination and the "N deals found" summary.
  const groups =
    query.group === 'canonical'
      ? await buildDealGroups(
          prisma,
          rows.map((row) => ({
            id: row.id,
            canonicalProductId: (row as { canonicalProductId: string | null }).canonicalProductId,
          })),
        )
      : undefined;

  const totalPages = Math.ceil(total / query.limit);

  const appliedFilters: AppliedFilters = {
    query: effective.text ?? null,
    maximumPrice: effective.maximumPrice ?? null,
    minimumDiscount: effective.minimumDiscount ?? null,
    category: effective.category ?? null,
    stores: effective.stores,
    vertical: query.vertical,
    // Shown on the results page so a misread sentence is visible and fixable.
    interpretation: parsed.notes,
  };

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasMore: query.page < totalPages,
    },
    appliedFilters,
    sort: query.sort,
    // Omitted entirely in ungrouped mode, so a client on the previous contract
    // sees a byte-identical response.
    ...(groups ? { groups } : {}),
  };
}

/** Which of these products the user already tracks. Empty when anonymous. */
export async function findTrackedProductIds(
  prisma: PrismaClient,
  userId: string | undefined,
  productIds: readonly string[],
): Promise<Set<string>> {
  if (!userId || productIds.length === 0) return new Set();

  const rows = await prisma.watchlistItem.findMany({
    where: { userId, productId: { in: [...productIds] } },
    select: { productId: true },
  });
  return new Set(rows.map((row) => row.productId));
}

export { PRODUCT_SELECT };
