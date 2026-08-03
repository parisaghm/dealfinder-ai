import { z } from 'zod';
import {
  availabilitySchema,
  currencySchema,
  idSchema,
  isoDateTimeSchema,
  moneySchema,
  percentSchema,
} from './common';
import { dealQualitySchema } from './deal-quality';
import { pricePointSchema, priceStatisticsSchema, priceTrendSchema } from './price';

export const storeSummarySchema = z.object({
  id: idSchema,
  /** Stable, URL-safe identifier used in `?stores=` filters. */
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  websiteUrl: z.string().max(2048),
  logoUrl: z.string().max(2048).nullable(),
  isActive: z.boolean(),
});
export type StoreSummary = z.infer<typeof storeSummarySchema>;

/**
 * A product as rendered on a card or in a list.
 *
 * `discountPercent` and `effectivePrice` are derived values computed by the
 * API from the same shared pricing helpers the browser uses, so they are
 * transported rather than recomputed per component.
 */
export const productSummarySchema = z.object({
  id: idSchema,
  externalId: z.string().max(128),
  name: z.string().min(1).max(300),
  brand: z.string().max(120).nullable(),
  category: z.string().max(64),
  vertical: z.string().max(64),
  imageUrl: z.string().max(2048).nullable(),
  productUrl: z.string().max(2048),
  store: storeSummarySchema,

  currency: currencySchema,
  currentPrice: moneySchema,
  originalPrice: moneySchema.nullable(),
  shippingPrice: moneySchema.nullable(),
  /** Whole-percent reduction against `originalPrice`; 0 when unsubstantiated. */
  discountPercent: percentSchema,
  /** `currentPrice` plus shipping — what it actually costs to receive. */
  effectivePrice: moneySchema,

  availability: availabilitySchema,
  lastCheckedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,

  priceStatistics: priceStatisticsSchema,
  dealQuality: dealQualitySchema,

  /** True when the requesting user already tracks this product. */
  isTracked: z.boolean(),
});
export type ProductSummary = z.infer<typeof productSummarySchema>;

export const productDetailsSchema = productSummarySchema.extend({
  description: z.string().max(5000).nullable(),
  /** Vertical-specific fields, validated against the vertical's schema. */
  attributes: z.record(z.string(), z.unknown()).nullable(),
  priceHistory: z.array(pricePointSchema),
  trend: priceTrendSchema,
  similarProducts: z.array(productSummarySchema),

  /**
   * The cross-store product this listing is an offer for, when it has been
   * matched to one. Null is a permanently valid state: a store can be the only
   * one carrying something.
   *
   * Added to *details* only, deliberately. `ProductSummary` is embedded in
   * search results, watchlists and the dashboard, and widening it would change
   * several published payloads to serve one banner on one page.
   */
  canonicalProductId: idSchema.nullable(),
  /** How many stores sell it, including this one. 1 when unmatched. */
  canonicalOfferCount: z.number().int().nonnegative(),
});
export type ProductDetails = z.infer<typeof productDetailsSchema>;

export const priceHistoryResponseSchema = z.object({
  productId: idSchema,
  currency: currencySchema,
  points: z.array(pricePointSchema),
  statistics: priceStatisticsSchema,
  trend: priceTrendSchema,
});
export type PriceHistoryResponse = z.infer<typeof priceHistoryResponseSchema>;

/** `GET /api/products/:id/history?days=90` */
export const priceHistoryQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(90),
});
export type PriceHistoryQuery = z.infer<typeof priceHistoryQuerySchema>;
