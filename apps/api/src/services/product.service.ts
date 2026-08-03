import type { PrismaClient } from '@deal-finder/db';
import {
  calculatePriceStatistics,
  calculatePriceTrend,
  type Currency,
  type PriceHistoryResponse,
  type ProductDetails,
  type ProductSummary,
} from '@deal-finder/shared';
import { ApiError } from '../errors';
import {
  toPricePoints,
  toProductDetails,
  toProductSummary,
  type ProductRow,
} from '../mappers/product.mapper';
import { PRODUCT_SELECT, findTrackedProductIds } from './deals.service';
import { fetchHistoryContext } from './price-history.service';

/** How many similar products the details page shows. */
const SIMILAR_LIMIT = 4;
/** Price band, as a fraction of the product's price, used to find peers. */
const SIMILAR_PRICE_BAND = 0.4;

export async function getProductDetails(
  prisma: PrismaClient,
  productId: string,
  options: { userId?: string } = {},
): Promise<ProductDetails> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: PRODUCT_SELECT,
  });
  if (!product) throw ApiError.notFound('Product');

  // The details page charts the full series, so unlike the list view it does
  // load every observation for this one product.
  const fullHistory = await prisma.priceHistory.findMany({
    where: { productId },
    select: { price: true, recordedAt: true },
    orderBy: { recordedAt: 'asc' },
  });

  const points = toPricePoints(fullHistory);
  const statistics = calculatePriceStatistics(points);

  const canonicalProductId = (product as { canonicalProductId: string | null }).canonicalProductId;

  const [similarProducts, trackedIds, canonicalOfferCount] = await Promise.all([
    findSimilarProducts(prisma, product as ProductRow, options.userId),
    findTrackedProductIds(prisma, options.userId, [productId]),
    // Only asked when the listing is actually grouped, so the ordinary
    // single-store case costs nothing extra.
    canonicalProductId
      ? prisma.product.count({ where: { canonicalProductId } })
      : Promise.resolve(1),
  ]);

  return toProductDetails(product as ProductRow, {
    statistics,
    recentHistory: fullHistory.slice(-6),
    isTracked: trackedIds.has(productId),
    fullHistory,
    similarProducts,
    canonicalProductId,
    canonicalOfferCount,
  });
}

export async function getPriceHistory(
  prisma: PrismaClient,
  productId: string,
  days: number,
): Promise<PriceHistoryResponse> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, currency: true },
  });
  if (!product) throw ApiError.notFound('Product');

  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.priceHistory.findMany({
    where: { productId, recordedAt: { gte: since } },
    select: { price: true, recordedAt: true },
    orderBy: { recordedAt: 'asc' },
  });

  const points = toPricePoints(rows);

  return {
    productId,
    currency: product.currency as Currency,
    points,
    // Statistics describe the requested window, matching what the chart draws.
    statistics: calculatePriceStatistics(points),
    trend: calculatePriceTrend(points),
  };
}

/**
 * Peers for the details page: same category and vertical, comparable price,
 * excluding the product itself.
 *
 * Deliberately simple and explainable rather than a similarity model — it has
 * to be obvious to a user why these four appeared.
 */
export async function findSimilarProducts(
  prisma: PrismaClient,
  product: ProductRow,
  userId?: string,
): Promise<ProductSummary[]> {
  const price = Number(product.currentPrice);
  const lower = price * (1 - SIMILAR_PRICE_BAND);
  const upper = price * (1 + SIMILAR_PRICE_BAND);

  const rows = await prisma.product.findMany({
    where: {
      id: { not: product.id },
      vertical: product.vertical,
      category: product.category,
      currentPrice: { gte: lower, lte: upper },
    },
    select: PRODUCT_SELECT,
    // Best-value peers first: the point of the section is a cheaper alternative.
    orderBy: [{ discountPercent: 'desc' }, { currentPrice: 'asc' }],
    take: SIMILAR_LIMIT,
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
