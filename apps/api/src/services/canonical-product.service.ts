import { type Prisma, type PrismaClient } from '@deal-finder/db';
import {
  buildBestPriceSeries,
  calculatePriceStatistics,
  calculatePriceTrend,
  crossStoreLow,
  MAX_OFFERS_PER_CANONICAL,
  sortOffers,
  type CanonicalHistoryQuery,
  type CanonicalHistoryResponse,
  type CanonicalOffersQuery,
  type CanonicalOffersResponse,
  type CanonicalProductDetails,
  type CanonicalProductsQuery,
  type CanonicalProductsResponse,
  type CanonicalSort,
  type Currency,
  type PricePoint,
  type ProductSummary,
  type StorePriceSeries,
} from '@deal-finder/shared';
import { ApiError } from '../errors';
import {
  flattenSpecifications,
  toCanonicalOffer,
  toCanonicalSummary,
  toComparableOffer,
  toOfferComparison,
  type CanonicalRow,
  type OfferRow,
} from '../mappers/canonical.mapper';
import { toProductSummary } from '../mappers/product.mapper';
import { fetchHistoryContext } from './price-history.service';

/**
 * Canonical products — the cross-store comparison endpoints.
 *
 * Two things this file is careful about:
 *
 *  1. **Query count is bounded, not proportional to the page.** Listing 24
 *     grouped products naively means 24 offer queries plus 24 history queries.
 *     Instead every step is one round trip over the whole page, in the spirit
 *     of `price-history.service.ts`.
 *
 *  2. **Sorting canonicals happens in SQL; sorting *offers* happens in memory.**
 *     Those look inconsistent and are not. The canonical list is paginated, so
 *     ordering it by a computed value would reorder rows across page
 *     boundaries. An offer list is complete and small, so there is no boundary
 *     to corrupt — and sorting it in memory lets it reuse the exact
 *     `calculateEffectivePrice` and `scoreDealQuality` the rest of the app uses
 *     instead of a SQL re-implementation that would drift.
 */

const CANONICAL_SELECT = {
  id: true,
  name: true,
  brand: true,
  modelNumber: true,
  category: true,
  vertical: true,
  gtin: true,
  ean: true,
  mpn: true,
  imageUrl: true,
  specifications: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CanonicalProductSelect;

const OFFER_SELECT = {
  id: true,
  externalId: true,
  name: true,
  description: true,
  brand: true,
  category: true,
  vertical: true,
  attributes: true,
  imageUrl: true,
  productUrl: true,
  currentPrice: true,
  originalPrice: true,
  shippingPrice: true,
  currency: true,
  discountPercent: true,
  availability: true,
  dataSourceType: true,
  lastCheckedAt: true,
  createdAt: true,
  updatedAt: true,
  canonicalProductId: true,
  canonicalMatchMethod: true,
  canonicalMatchScore: true,
  canonicalMatchedAt: true,
  store: {
    select: { id: true, slug: true, name: true, websiteUrl: true, logoUrl: true, isActive: true },
  },
} satisfies Prisma.ProductSelect;

const CANONICAL_ORDER: Record<CanonicalSort, Prisma.CanonicalProductOrderByWithRelationInput[]> = {
  // Tie-breakers make the ordering total, so a row cannot appear on two pages.
  'most-offers': [{ offers: { _count: 'desc' } }, { updatedAt: 'desc' }, { id: 'asc' }],
  'lowest-price': [{ updatedAt: 'desc' }, { id: 'asc' }],
  'recently-updated': [{ updatedAt: 'desc' }, { id: 'asc' }],
  name: [{ name: 'asc' }, { id: 'asc' }],
};

/**
 * Load offers plus their history context for a set of canonical products, in a
 * fixed number of queries regardless of how many products there are.
 */
async function loadOffers(
  prisma: PrismaClient,
  canonicalIds: readonly string[],
): Promise<Map<string, { rows: OfferRow[]; summaries: ProductSummary[] }>> {
  const grouped = new Map<string, { rows: OfferRow[]; summaries: ProductSummary[] }>();
  if (canonicalIds.length === 0) return grouped;

  const rows = (await prisma.product.findMany({
    where: { canonicalProductId: { in: [...canonicalIds] } },
    select: OFFER_SELECT,
    orderBy: [{ currentPrice: 'asc' }, { id: 'asc' }],
    take: MAX_OFFERS_PER_CANONICAL * canonicalIds.length,
  })) as unknown as OfferRow[];

  const { statistics, recentHistory } = await fetchHistoryContext(
    prisma,
    rows.map((row) => row.id),
  );

  for (const row of rows) {
    const key = row.canonicalProductId;
    if (!key) continue;
    const entry = grouped.get(key) ?? { rows: [], summaries: [] };
    entry.rows.push(row);
    entry.summaries.push(
      toProductSummary(row, {
        statistics: statistics.get(row.id),
        recentHistory: recentHistory.get(row.id),
      }),
    );
    grouped.set(key, entry);
  }

  return grouped;
}

async function countPendingCandidates(
  prisma: PrismaClient,
  canonicalIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (canonicalIds.length === 0) return counts;

  const rows = await prisma.productMatchCandidate.groupBy({
    by: ['candidateCanonicalProductId'],
    where: { candidateCanonicalProductId: { in: [...canonicalIds] }, status: 'PENDING' },
    _count: { _all: true },
  });

  for (const row of rows) {
    counts.set(row.candidateCanonicalProductId, row._count._all);
  }
  return counts;
}

export async function listCanonicalProducts(
  prisma: PrismaClient,
  query: CanonicalProductsQuery,
): Promise<CanonicalProductsResponse> {
  const where: Prisma.CanonicalProductWhereInput = {
    vertical: query.vertical,
    ...(query.category ? { category: query.category } : {}),
    ...(query.brand ? { brandKey: query.brand.toLowerCase() } : {}),
    ...(query.query
      ? {
          AND: query.query
            .split(/\s+/)
            .filter(Boolean)
            .map((term) => ({
              OR: [
                { name: { contains: term, mode: 'insensitive' as const } },
                { brand: { contains: term, mode: 'insensitive' as const } },
                { modelNumber: { contains: term, mode: 'insensitive' as const } },
              ],
            })),
        }
      : {}),
    // A canonical product with no offers describes nothing and must never be
    // returned. The stronger `minOffers` filter is applied after the offers are
    // loaded, because an offer count is not an indexable column.
    offers: { some: {} },
  };

  const skip = (query.page - 1) * query.limit;

  const [total, rows] = await Promise.all([
    prisma.canonicalProduct.count({ where }),
    prisma.canonicalProduct.findMany({
      where,
      select: { ...CANONICAL_SELECT, _count: { select: { offers: true } } },
      orderBy: CANONICAL_ORDER[query.sort],
      skip,
      take: query.limit,
    }),
  ]);

  const ids = rows.map((row) => row.id);
  const [offersByCanonical, pendingCounts] = await Promise.all([
    loadOffers(prisma, ids),
    countPendingCandidates(prisma, ids),
  ]);

  let items = rows.map((row) => {
    const entry = offersByCanonical.get(row.id) ?? { rows: [], summaries: [] };
    return toCanonicalSummary(row as CanonicalRow, {
      offers: entry.summaries,
      offerRows: entry.rows,
      pendingCandidateCount: pendingCounts.get(row.id) ?? 0,
    });
  });

  // `minOffers` and `lowest-price` both depend on values only known after the
  // offers are loaded. Applied here rather than in SQL, and *documented* as a
  // filter that can shrink a page rather than one that changes `total`, so the
  // behaviour is visible instead of surprising.
  if (query.minOffers > 1) {
    items = items.filter((item) => item.offerCount >= query.minOffers);
  }
  if (query.sort === 'lowest-price') {
    items = [...items].sort(
      (a, b) =>
        (a.lowestEffectivePrice ?? a.lowestPrice ?? Number.POSITIVE_INFINITY) -
          (b.lowestEffectivePrice ?? b.lowestPrice ?? Number.POSITIVE_INFINITY) ||
        a.id.localeCompare(b.id),
    );
  }

  const totalPages = Math.ceil(total / query.limit);

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasMore: query.page < totalPages,
    },
    sort: query.sort,
  };
}

async function loadCanonicalOrThrow(prisma: PrismaClient, id: string) {
  const canonical = await prisma.canonicalProduct.findUnique({
    where: { id },
    select: CANONICAL_SELECT,
  });
  if (!canonical) throw ApiError.notFound('Canonical product');
  return canonical;
}

export async function getCanonicalProduct(
  prisma: PrismaClient,
  id: string,
): Promise<CanonicalProductDetails> {
  const canonical = await loadCanonicalOrThrow(prisma, id);
  const grouped = await loadOffers(prisma, [id]);
  const entry = grouped.get(id) ?? { rows: [], summaries: [] };

  const pending = await countPendingCandidates(prisma, [id]);
  const summary = toCanonicalSummary(canonical as CanonicalRow, {
    offers: entry.summaries,
    offerRows: entry.rows,
    pendingCandidateCount: pending.get(id) ?? 0,
  });

  const comparison = toOfferComparison(entry.summaries);
  const bestQuality = entry.summaries.reduce(
    (best, offer) => Math.max(best, offer.dealQuality.score),
    -1,
  );

  const rowsById = new Map(entry.rows.map((row) => [row.id, row]));
  const offers = sortOffers(
    entry.summaries.map((offer) =>
      toCanonicalOffer(offer, rowsById.get(offer.id) as OfferRow, comparison, bestQuality),
    ),
    'lowest-total',
  );

  return {
    ...summary,
    specifications: mergeSpecifications(canonical.specifications, entry.rows),
    offers,
    comparison,
  };
}

/**
 * Merge the canonical record's own specifications with anything the offers add.
 *
 * The canonical row is seeded from whichever listing created it, which is often
 * the least detailed one. Folding in the offers means the comparison page shows
 * everything any store published, rather than the intersection.
 */
function mergeSpecifications(
  canonicalSpecs: Prisma.JsonValue | null,
  offers: readonly OfferRow[],
): Record<string, string> {
  const merged: Record<string, string> = { ...flattenSpecifications(canonicalSpecs) };
  for (const offer of offers) {
    for (const [key, value] of Object.entries(flattenSpecifications(offer.attributes))) {
      merged[key] ??= value;
    }
  }
  return merged;
}

export async function getCanonicalOffers(
  prisma: PrismaClient,
  id: string,
  query: CanonicalOffersQuery,
): Promise<CanonicalOffersResponse> {
  await loadCanonicalOrThrow(prisma, id);

  const grouped = await loadOffers(prisma, [id]);
  const entry = grouped.get(id) ?? { rows: [], summaries: [] };

  const visible = query.includeOutOfStock
    ? entry.summaries
    : entry.summaries.filter((offer) => offer.availability !== 'OUT_OF_STOCK');

  // The comparison is computed over *every* offer, even when out-of-stock rows
  // are hidden: the caveat about a cheaper unavailable offer is precisely the
  // thing a filtered view must not lose.
  const comparison = toOfferComparison(entry.summaries);
  const bestQuality = visible.reduce((best, offer) => Math.max(best, offer.dealQuality.score), -1);
  const rowsById = new Map(entry.rows.map((row) => [row.id, row]));

  const offers = sortOffers(
    visible.map((offer) =>
      toCanonicalOffer(offer, rowsById.get(offer.id) as OfferRow, comparison, bestQuality),
    ),
    query.sort,
  );

  return {
    canonicalProductId: id,
    currency: (entry.summaries[0]?.currency ?? 'EUR') as Currency,
    sort: query.sort,
    offers,
    comparison,
  };
}

export async function getCanonicalHistory(
  prisma: PrismaClient,
  id: string,
  query: CanonicalHistoryQuery,
  now: Date = new Date(),
): Promise<CanonicalHistoryResponse> {
  await loadCanonicalOrThrow(prisma, id);

  const offers = await prisma.product.findMany({
    where: { canonicalProductId: id },
    select: {
      id: true,
      currency: true,
      store: { select: { id: true, slug: true, name: true } },
    },
    orderBy: [{ currentPrice: 'asc' }, { id: 'asc' }],
    take: MAX_OFFERS_PER_CANONICAL,
  });

  const since = new Date(now.getTime() - query.days * 86_400_000);

  // One query for every store's history, rather than one per store.
  const rows =
    offers.length === 0
      ? []
      : await prisma.priceHistory.findMany({
          where: { productId: { in: offers.map((offer) => offer.id) }, recordedAt: { gte: since } },
          select: { productId: true, price: true, recordedAt: true },
          orderBy: [{ productId: 'asc' }, { recordedAt: 'asc' }],
        });

  const pointsByProduct = new Map<string, PricePoint[]>();
  for (const row of rows) {
    const points = pointsByProduct.get(row.productId) ?? [];
    points.push({ price: Number(row.price), recordedAt: row.recordedAt.toISOString() });
    pointsByProduct.set(row.productId, points);
  }

  const series = offers.map((offer) => {
    const points = pointsByProduct.get(offer.id) ?? [];
    return {
      storeId: offer.store.id,
      storeSlug: offer.store.slug,
      storeName: offer.store.name,
      productId: offer.id,
      points,
      statistics: calculatePriceStatistics(points),
    };
  });

  const forBest: StorePriceSeries[] = series.map((entry) => ({
    storeSlug: entry.storeSlug,
    storeName: entry.storeName,
    points: entry.points,
  }));
  const bestPoints = buildBestPriceSeries(forBest, { days: query.days, now });

  return {
    canonicalProductId: id,
    currency: (offers[0]?.currency ?? 'EUR') as Currency,
    days: query.days,
    series,
    best: {
      points: bestPoints,
      statistics: calculatePriceStatistics(bestPoints),
      trend: calculatePriceTrend(bestPoints),
    },
    crossStoreLow: crossStoreLow(forBest),
  };
}

/**
 * The grouping decoration for `GET /api/deals?group=canonical`.
 *
 * Takes the page the search already produced and answers one extra question:
 * which of these listings are the same product, and what else is out there?
 * It never changes which products are on the page.
 */
export async function buildDealGroups(
  prisma: PrismaClient,
  pageProducts: readonly { id: string; canonicalProductId: string | null }[],
) {
  const canonicalIds = [
    ...new Set(
      pageProducts
        .map((product) => product.canonicalProductId)
        .filter((id): id is string => id != null),
    ),
  ];
  if (canonicalIds.length === 0) return [];

  const [rows, offersByCanonical, pendingCounts] = await Promise.all([
    prisma.canonicalProduct.findMany({
      where: { id: { in: canonicalIds } },
      select: CANONICAL_SELECT,
    }),
    loadOffers(prisma, canonicalIds),
    countPendingCandidates(prisma, canonicalIds),
  ]);

  const byId = new Map(rows.map((row) => [row.id, row]));

  return canonicalIds
    .map((canonicalId) => {
      const row = byId.get(canonicalId);
      if (!row) return null;
      const entry = offersByCanonical.get(canonicalId) ?? { rows: [], summaries: [] };
      return {
        canonicalProductId: canonicalId,
        canonical: toCanonicalSummary(row as CanonicalRow, {
          offers: entry.summaries,
          offerRows: entry.rows,
          pendingCandidateCount: pendingCounts.get(canonicalId) ?? 0,
        }),
        productIds: pageProducts
          .filter((product) => product.canonicalProductId === canonicalId)
          .map((product) => product.id),
      };
    })
    .filter((group): group is NonNullable<typeof group> => group != null);
}

export { toComparableOffer };
