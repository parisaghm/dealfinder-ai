import { calculateDiscountPercent } from '@deal-finder/shared';
import type { Availability, PrismaClient } from './generated/prisma/client';

/**
 * The single writer for product prices.
 *
 * Every path that learns a new price — the seed script, an on-demand refresh,
 * the scheduled monitor — goes through here. That is what keeps the
 * denormalised `Product.discountPercent` column honest, and what guarantees
 * the "write a history row only when the price actually changed" rule is
 * applied consistently rather than reimplemented per caller.
 *
 * The input is described structurally rather than importing `ExternalProduct`
 * from the providers package, so the dependency arrow keeps pointing one way:
 * providers → API → db, never db → providers.
 */

export interface ProductUpsertInput {
  externalId: string;
  name: string;
  brand?: string | null;
  category: string;
  vertical: string;
  description?: string | null;
  imageUrl?: string | null;
  productUrl: string;
  /**
   * Identifiers as published by this store, if any.
   *
   * Persisted here but never *used* here: matching is a separate post-pass,
   * because it needs the other stores' products to already exist. Ingestion's
   * only job is to make sure the codes are not thrown away.
   */
  modelNumber?: string | null;
  gtin?: string | null;
  ean?: string | null;
  mpn?: string | null;
  currentPrice: number;
  originalPrice?: number | null;
  shippingPrice?: number | null;
  currency: string;
  availability: Availability;
  attributes?: Record<string, unknown> | null;

  /**
   * How this listing was obtained -- the provider's own `sourceKind`.
   *
   * Required rather than defaulted, because it governs whether the web layer will
   * offer `productUrl` above as an external link. A default would let a new
   * ingestion path silently inherit `'mock'`, or worse, inherit a trusted value
   * it has not earned. The caller knows which provider it just spoke to.
   */
  dataSourceType: string;
}

export interface UpsertProductResult {
  productId: string;
  /** True when this product had never been seen before. */
  isNew: boolean;
  /** True when a price different from the stored one was observed. */
  priceChanged: boolean;
  previousPrice: number | null;
  currentPrice: number;
}

export interface UpsertProductOptions {
  /** Injectable clock so seeding and tests are deterministic. */
  now?: Date;
  /**
   * Skip writing a `PriceHistory` row. The seed script sets this because it
   * writes a full synthetic series itself.
   */
  skipHistory?: boolean;
}

export async function upsertProductFromSource(
  prisma: PrismaClient,
  storeId: string,
  source: ProductUpsertInput,
  options: UpsertProductOptions = {},
): Promise<UpsertProductResult> {
  const now = options.now ?? new Date();

  // Derived column, computed in exactly one place.
  const discountPercent = calculateDiscountPercent(source.currentPrice, source.originalPrice);

  const existing = await prisma.product.findUnique({
    where: { storeId_externalId: { storeId, externalId: source.externalId } },
    select: { id: true, currentPrice: true },
  });

  const previousPrice = existing ? Number(existing.currentPrice) : null;
  const priceChanged = previousPrice != null && previousPrice !== source.currentPrice;

  const writable = {
    name: source.name,
    description: source.description ?? null,
    brand: source.brand ?? null,
    category: source.category,
    vertical: source.vertical,
    attributes: (source.attributes ?? null) as never,
    imageUrl: source.imageUrl ?? null,
    productUrl: source.productUrl,
    modelNumber: source.modelNumber ?? null,
    gtin: source.gtin ?? null,
    ean: source.ean ?? null,
    mpn: source.mpn ?? null,
    currentPrice: source.currentPrice,
    originalPrice: source.originalPrice ?? null,
    shippingPrice: source.shippingPrice ?? null,
    currency: source.currency,
    discountPercent,
    availability: source.availability,
    dataSourceType: source.dataSourceType,
    lastCheckedAt: now,
  };

  const product = await prisma.product.upsert({
    where: { storeId_externalId: { storeId, externalId: source.externalId } },
    create: { externalId: source.externalId, storeId, ...writable },
    update: writable,
    select: { id: true },
  });

  // Record an observation for a brand-new product (so it has a starting point)
  // or when the price moved. Unchanged prices are deliberately not recorded:
  // the series is a record of price changes, not of how often we polled.
  if (!options.skipHistory && (!existing || priceChanged)) {
    await prisma.priceHistory.create({
      data: {
        productId: product.id,
        price: source.currentPrice,
        currency: source.currency,
        recordedAt: now,
      },
    });
  }

  return {
    productId: product.id,
    isNew: !existing,
    priceChanged,
    previousPrice,
    currentPrice: source.currentPrice,
  };
}

/** Append a single observation. Used when replaying a synthetic series. */
export async function recordPriceObservation(
  prisma: PrismaClient,
  productId: string,
  price: number,
  currency: string,
  recordedAt: Date,
): Promise<void> {
  await prisma.priceHistory.create({
    data: { productId, price, currency, recordedAt },
  });
}
