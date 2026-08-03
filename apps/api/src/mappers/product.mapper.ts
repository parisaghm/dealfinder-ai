import { decimalToNumber, requireDecimalToNumber, type Prisma } from '@deal-finder/db';
import {
  calculateEffectivePrice,
  calculatePriceStatistics,
  calculatePriceTrend,
  scoreDealQuality,
  type Availability,
  type Currency,
  type PricePoint,
  type PriceStatistics,
  type ProductDetails,
  type ProductSummary,
  type StoreSummary,
} from '@deal-finder/shared';

/**
 * Prisma rows → API DTOs.
 *
 * Two jobs, both of which must happen in exactly one place:
 *
 *  1. Convert `Decimal` columns to numbers. Prisma returns Decimal objects to
 *     avoid float drift on money; those do not survive `JSON.stringify`
 *     intact, so conversion happens here rather than being forgotten in one
 *     endpoint out of ten.
 *  2. Attach derived values (discount, effective price, statistics, deal
 *     quality) using the shared pricing helpers, so every endpoint reports
 *     identical numbers for the same product.
 */

export interface StoreRow {
  id: string;
  slug: string;
  name: string;
  websiteUrl: string;
  logoUrl: string | null;
  isActive: boolean;
}

export interface ProductRow {
  id: string;
  externalId: string;
  name: string;
  description: string | null;
  brand: string | null;
  category: string;
  vertical: string;
  attributes: Prisma.JsonValue | null;
  imageUrl: string | null;
  productUrl: string;
  currentPrice: Prisma.Decimal;
  originalPrice: Prisma.Decimal | null;
  shippingPrice: Prisma.Decimal | null;
  currency: string;
  discountPercent: number;
  availability: Availability;
  lastCheckedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  store: StoreRow;
}

export interface PriceHistoryRow {
  price: Prisma.Decimal;
  recordedAt: Date;
}

export function toStoreSummary(store: StoreRow): StoreSummary {
  return {
    id: store.id,
    slug: store.slug,
    name: store.name,
    websiteUrl: store.websiteUrl,
    logoUrl: store.logoUrl,
    isActive: store.isActive,
  };
}

export function toPricePoints(rows: readonly PriceHistoryRow[]): PricePoint[] {
  return rows.map((row) => ({
    price: requireDecimalToNumber(row.price),
    recordedAt: row.recordedAt.toISOString(),
  }));
}

export interface ProductMappingContext {
  /**
   * Aggregates over the product's full history, from a single SQL aggregate.
   * When omitted, they are derived from `recentHistory` — correct but based on
   * fewer observations.
   */
  statistics?: PriceStatistics;
  /** A bounded window of recent observations, used for the trend factor. */
  recentHistory?: readonly PriceHistoryRow[];
  /** Whether the requesting user tracks this product. */
  isTracked?: boolean;
}

export function toProductSummary(
  product: ProductRow,
  context: ProductMappingContext = {},
): ProductSummary {
  const currentPrice = requireDecimalToNumber(product.currentPrice);
  const originalPrice = decimalToNumber(product.originalPrice);
  const shippingPrice = decimalToNumber(product.shippingPrice);
  const currency = product.currency as Currency;

  const recentHistory = context.recentHistory ? toPricePoints(context.recentHistory) : [];
  const statistics = context.statistics ?? calculatePriceStatistics(recentHistory);

  const dealQuality = scoreDealQuality({
    currentPrice,
    originalPrice,
    shippingPrice,
    availability: product.availability,
    currency,
    recentHistory,
    statistics,
  });

  return {
    id: product.id,
    externalId: product.externalId,
    name: product.name,
    brand: product.brand,
    category: product.category,
    vertical: product.vertical,
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    store: toStoreSummary(product.store),

    currency,
    currentPrice,
    originalPrice,
    shippingPrice,
    // Read from the derived column rather than recomputed, so the value the
    // list was sorted and filtered by is the value that is displayed.
    discountPercent: product.discountPercent,
    effectivePrice: calculateEffectivePrice(currentPrice, shippingPrice),

    availability: product.availability,
    lastCheckedAt: product.lastCheckedAt.toISOString(),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),

    priceStatistics: statistics,
    dealQuality,
    isTracked: context.isTracked ?? false,
  };
}

export function toProductDetails(
  product: ProductRow,
  context: ProductMappingContext & {
    fullHistory: readonly PriceHistoryRow[];
    similarProducts: ProductSummary[];
    canonicalProductId?: string | null;
    canonicalOfferCount?: number;
  },
): ProductDetails {
  const priceHistory = toPricePoints(context.fullHistory);

  return {
    ...toProductSummary(product, context),
    description: product.description,
    attributes: isPlainObject(product.attributes) ? product.attributes : null,
    priceHistory,
    trend: calculatePriceTrend(priceHistory),
    similarProducts: context.similarProducts,
    canonicalProductId: context.canonicalProductId ?? null,
    // Defaults to 1, not 0: an unmatched listing is still one store selling it.
    canonicalOfferCount: context.canonicalOfferCount ?? 1,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
