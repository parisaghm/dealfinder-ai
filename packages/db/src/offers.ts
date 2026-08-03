import {
  deliveredTotal,
  fromMajor,
  importDutyStatusFor,
  taxesIncludedFor,
  toMajor,
  type ImportDutyStatus,
} from '@deal-finder/shared';
import type { Availability, PrismaClient } from './generated/prisma/client';

/**
 * The single writer for destination-specific offers.
 *
 * Mirrors `upsertProductFromSource`'s discipline for the same reasons: the
 * delivered total is a derived column that must be computed in exactly one place,
 * and the "write a history row only when something actually changed" rule must be
 * applied consistently rather than reimplemented per caller.
 *
 * Like ingestion, the input is described structurally rather than importing
 * `ExternalStoreOffer` from the providers package, so the dependency arrow keeps
 * pointing one way: providers → API → db.
 */

export interface StoreOfferUpsertInput {
  productId: string;
  storeId: string;
  /** Where the parcel is going. */
  countryCode: string;
  /** Where the store trades from — drives the tax and duty determination. */
  storeCountryCode: string;
  /** The currency the store quotes in, not the shopper's display currency. */
  currency: string;

  productPrice: number;
  originalPrice?: number | null;
  /** Null means unpublished. Never coerce this to 0. */
  shippingPrice?: number | null;

  /**
   * Overrides for the tax and duty determination.
   *
   * Normally omitted, in which case they are derived from the route by the shared
   * country rules — one implementation, so a provider cannot accidentally claim a
   * cross-border order is duty-free.
   */
  taxesIncluded?: boolean | null;
  estimatedTax?: number | null;
  estimatedImportFees?: number | null;
  importDutyStatus?: ImportDutyStatus;

  availability: Availability;
  deliveryMinDays?: number | null;
  deliveryMaxDays?: number | null;
}

export interface UpsertStoreOfferResult {
  offerId: string;
  isNew: boolean;
  /** True when any cost component or availability moved. */
  changed: boolean;
  totalDeliveredPrice: number | null;
}

export interface UpsertStoreOfferOptions {
  now?: Date;
  /** Skip the history row. The seed sets this when writing its own series. */
  skipHistory?: boolean;
}

/**
 * Compute the delivered total for an offer, in the offer's own currency.
 *
 * Exported because both the writer and the read-time mapper need the identical
 * arithmetic. All of it happens in integer minor units; `toMajor` is applied once
 * at the end, for the Decimal column.
 *
 * Returns null whenever shipping is unpublished — an unknown delivery cost means
 * an unknown total, and substituting zero would present the least informative
 * offer as the cheapest.
 */
export function computeDeliveredTotal(input: {
  currency: string;
  productPrice: number;
  shippingPrice?: number | null;
  estimatedTax?: number | null;
  estimatedImportFees?: number | null;
}): number | null {
  // The currency has already been validated upstream by the Zod boundary; this
  // cast is the seam between the DB's free-text column and the shared enum.
  const currency = input.currency as Parameters<typeof fromMajor>[1];

  const productPrice = fromMajor(input.productPrice, currency);
  if (productPrice == null) return null;

  const shipping =
    input.shippingPrice == null ? null : fromMajor(input.shippingPrice, currency);
  // A present-but-unparseable shipping figure is not the same as an absent one,
  // but both mean the total cannot be trusted, so both yield null.
  if (input.shippingPrice != null && shipping == null) return null;

  const total = deliveredTotal({
    productPrice,
    shippingPrice: shipping,
    estimatedTax: input.estimatedTax == null ? null : fromMajor(input.estimatedTax, currency),
    importFees:
      input.estimatedImportFees == null ? null : fromMajor(input.estimatedImportFees, currency),
  });

  return total == null ? null : toMajor(total);
}

export async function upsertStoreOfferFromSource(
  prisma: PrismaClient,
  source: StoreOfferUpsertInput,
  options: UpsertStoreOfferOptions = {},
): Promise<UpsertStoreOfferResult> {
  const now = options.now ?? new Date();

  // Derived from the route unless the caller explicitly knows better. One
  // implementation of the rule, in the shared package, used everywhere.
  const importDutyStatus =
    source.importDutyStatus ?? importDutyStatusFor(source.storeCountryCode, source.countryCode);
  const taxesIncluded =
    source.taxesIncluded ?? taxesIncludedFor(source.storeCountryCode, source.countryCode);

  const totalDeliveredPrice = computeDeliveredTotal({
    currency: source.currency,
    productPrice: source.productPrice,
    shippingPrice: source.shippingPrice,
    estimatedTax: source.estimatedTax,
    estimatedImportFees: source.estimatedImportFees,
  });

  const key = {
    productId_countryCode_currency: {
      productId: source.productId,
      countryCode: source.countryCode,
      currency: source.currency,
    },
  };

  const existing = await prisma.storeOffer.findUnique({
    where: key,
    select: {
      id: true,
      productPrice: true,
      shippingPrice: true,
      estimatedTax: true,
      estimatedImportFees: true,
      totalDeliveredPrice: true,
      availability: true,
      deliveryMinDays: true,
      deliveryMaxDays: true,
    },
  });

  const asNumber = (value: unknown): number | null =>
    value == null ? null : Number(value as never);

  const changed =
    existing != null &&
    (asNumber(existing.productPrice) !== source.productPrice ||
      asNumber(existing.shippingPrice) !== (source.shippingPrice ?? null) ||
      asNumber(existing.estimatedTax) !== (source.estimatedTax ?? null) ||
      asNumber(existing.estimatedImportFees) !== (source.estimatedImportFees ?? null) ||
      asNumber(existing.totalDeliveredPrice) !== totalDeliveredPrice ||
      existing.availability !== source.availability ||
      existing.deliveryMinDays !== (source.deliveryMinDays ?? null) ||
      existing.deliveryMaxDays !== (source.deliveryMaxDays ?? null));

  const writable = {
    storeId: source.storeId,
    productPrice: source.productPrice,
    originalPrice: source.originalPrice ?? null,
    shippingPrice: source.shippingPrice ?? null,
    taxesIncluded,
    estimatedTax: source.estimatedTax ?? null,
    importDutyStatus,
    estimatedImportFees: source.estimatedImportFees ?? null,
    totalDeliveredPrice,
    availability: source.availability,
    deliveryMinDays: source.deliveryMinDays ?? null,
    deliveryMaxDays: source.deliveryMaxDays ?? null,
    lastCheckedAt: now,
  };

  const offer = await prisma.storeOffer.upsert({
    where: key,
    create: {
      productId: source.productId,
      countryCode: source.countryCode,
      currency: source.currency,
      ...writable,
    },
    update: writable,
    select: { id: true },
  });

  // A starting point for a new offer, or a record of an actual change. An
  // unchanged offer writes nothing: the series records changes, not polling.
  if (!options.skipHistory && (existing == null || changed)) {
    await prisma.storeOfferPriceHistory.create({
      data: {
        storeOfferId: offer.id,
        productPrice: source.productPrice,
        shippingPrice: source.shippingPrice ?? null,
        estimatedTax: source.estimatedTax ?? null,
        estimatedImportFees: source.estimatedImportFees ?? null,
        totalDeliveredPrice,
        // Recorded in the offer's own currency. Conversion is a read-time
        // concern, so a later rate change cannot rewrite history.
        originalCurrency: source.currency,
        displayCurrency: source.currency,
        exchangeRate: null,
        exchangeRateTimestamp: null,
        availability: source.availability,
        recordedAt: now,
      },
    });
  }

  return {
    offerId: offer.id,
    isNew: existing == null,
    changed,
    totalDeliveredPrice,
  };
}

/** Append a single destination-aware observation. Used when replaying a series. */
export async function recordStoreOfferObservation(
  prisma: PrismaClient,
  storeOfferId: string,
  observation: {
    productPrice: number;
    shippingPrice?: number | null;
    estimatedTax?: number | null;
    estimatedImportFees?: number | null;
    currency: string;
    availability: Availability;
    recordedAt: Date;
  },
): Promise<void> {
  await prisma.storeOfferPriceHistory.create({
    data: {
      storeOfferId,
      productPrice: observation.productPrice,
      shippingPrice: observation.shippingPrice ?? null,
      estimatedTax: observation.estimatedTax ?? null,
      estimatedImportFees: observation.estimatedImportFees ?? null,
      totalDeliveredPrice: computeDeliveredTotal(observation),
      originalCurrency: observation.currency,
      displayCurrency: observation.currency,
      exchangeRate: null,
      exchangeRateTimestamp: null,
      availability: observation.availability,
      recordedAt: observation.recordedAt,
    },
  });
}
