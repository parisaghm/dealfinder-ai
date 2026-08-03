import { z } from 'zod';
import { OFFER_SORT_OPTIONS } from '../matching/offer-sort';
import {
  currencySchema,
  idSchema,
  isoDateTimeSchema,
  moneySchema,
  paginationMetaSchema,
  searchTextSchema,
} from './common';
import { matchConfidenceSchema, matchMethodSchema } from './matching';
import { pricePointSchema, priceStatisticsSchema, priceTrendSchema } from './price';
import { productSummarySchema } from './product';

/**
 * Canonical products — one real product, several store offers.
 *
 * The comparison endpoints deliberately report *two* cheapest values, and never
 * collapse them into one. `lowestPrice` is the smallest number a store prints
 * on a page; `lowestEffectivePrice` is what it actually costs to receive the
 * item. They routinely name different stores, and a comparison tool that shows
 * only the first is worse than useless — it recommends the wrong shop with
 * complete confidence.
 */

export const offerSortSchema = z.enum(OFFER_SORT_OPTIONS);
export type OfferSortOption = z.infer<typeof offerSortSchema>;

export const CANONICAL_SORT_OPTIONS = [
  'most-offers',
  'lowest-price',
  'recently-updated',
  'name',
] as const;
export const canonicalSortSchema = z.enum(CANONICAL_SORT_OPTIONS);
export type CanonicalSort = z.infer<typeof canonicalSortSchema>;

export const canonicalIdentifiersSchema = z.object({
  gtin: z.string().max(20).nullable(),
  ean: z.string().max(20).nullable(),
  mpn: z.string().max(120).nullable(),
  modelNumber: z.string().max(120).nullable(),
});
export type CanonicalIdentifiers = z.infer<typeof canonicalIdentifiersSchema>;

export const canonicalProductSummarySchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(300),
  brand: z.string().max(120).nullable(),
  category: z.string().max(64),
  vertical: z.string().max(64),
  imageUrl: z.string().max(2048).nullable(),
  identifiers: canonicalIdentifiersSchema,

  offerCount: z.number().int().nonnegative(),
  storeCount: z.number().int().nonnegative(),
  storeSlugs: z.array(z.string().max(64)),

  currency: currencySchema,
  /** Cheapest and dearest *listed* prices, delivery excluded. */
  lowestPrice: moneySchema.nullable(),
  highestPrice: moneySchema.nullable(),
  /** Cheapest and dearest prices actually payable, delivery included. */
  lowestEffectivePrice: moneySchema.nullable(),
  highestEffectivePrice: moneySchema.nullable(),
  /** Difference between the dearest and cheapest payable totals. */
  priceSpread: moneySchema.nullable(),
  /** Saving against the most expensive *current* offer — never a struck-through claim. */
  savingsAgainstHighest: moneySchema.nullable(),
  savingsPercentAgainstHighest: z.number().finite().min(0).max(100).nullable(),

  /** The offer a shopper should probably take, with its deal-quality verdict. */
  bestOffer: productSummarySchema.nullable(),

  /**
   * The weakest confidence among the attachments in this group. `MEDIUM` means
   * at least one offer was grouped on a judgement rather than an identifier,
   * and the UI must say so rather than presenting the group as settled fact.
   */
  matchConfidence: matchConfidenceSchema,
  /** Non-blocking differences between the grouped offers, e.g. "Colour differs". */
  variantNotes: z.array(z.string().max(200)),
  /** Proposed additions still awaiting review. */
  pendingCandidateCount: z.number().int().nonnegative(),

  updatedAt: isoDateTimeSchema,
});
export type CanonicalProductSummary = z.infer<typeof canonicalProductSummarySchema>;

/** How one offer came to be in the group, so a grouping can be argued with. */
export const offerMatchInfoSchema = z.object({
  method: matchMethodSchema.nullable(),
  score: z.number().int().min(0).max(100).nullable(),
  matchedAt: isoDateTimeSchema.nullable(),
  /** One sentence naming the evidence, e.g. "Both listings publish EAN …". */
  explanation: z.string().max(500).nullable(),
});
export type OfferMatchInfo = z.infer<typeof offerMatchInfoSchema>;

export const canonicalOfferSchema = productSummarySchema.extend({
  /** `currentPrice` plus delivery, or null when delivery is not published. */
  totalPrice: moneySchema.nullable(),
  match: offerMatchInfoSchema,
  isLowestPrice: z.boolean(),
  isLowestTotalPrice: z.boolean(),
  isBestDealQuality: z.boolean(),
  priceDifferenceVsLowest: moneySchema,
  priceDifferenceVsLowestPercent: z.number().finite().min(0).max(100000),
});
export type CanonicalOffer = z.infer<typeof canonicalOfferSchema>;

export const offerComparisonSchema = z.object({
  lowestPrice: moneySchema.nullable(),
  highestPrice: moneySchema.nullable(),
  lowestTotalPrice: moneySchema.nullable(),
  highestTotalPrice: moneySchema.nullable(),
  /**
   * The offer to highlight. Must be purchasable *and* publish a delivery cost —
   * crowning an offer whose real total is unknown is the same dishonesty as an
   * unsupported discount badge.
   */
  cheapestTotalOfferId: idSchema.nullable(),
  /** Why a cheaper offer was passed over, when one was. Never hidden. */
  cheapestTotalCaveat: z.string().max(500).nullable(),
  priceSpread: moneySchema.nullable(),
  priceSpreadPercent: z.number().finite().nullable(),
  savingsAgainstHighest: moneySchema.nullable(),
  savingsPercentAgainstHighest: z.number().finite().nullable(),
});
export type OfferComparisonDto = z.infer<typeof offerComparisonSchema>;

export const canonicalProductDetailsSchema = canonicalProductSummarySchema.extend({
  /** Merged specifications, flattened for display. */
  specifications: z.record(z.string(), z.string()),
  offers: z.array(canonicalOfferSchema),
  comparison: offerComparisonSchema,
});
export type CanonicalProductDetails = z.infer<typeof canonicalProductDetailsSchema>;

export const canonicalProductsQuerySchema = z.object({
  query: searchTextSchema.optional(),
  category: z.string().trim().max(64).optional(),
  brand: z.string().trim().max(120).optional(),
  vertical: z.string().trim().max(64).default('electronics'),
  /** Pass 2 to list only products actually sold by more than one store. */
  minOffers: z.coerce.number().int().min(1).max(50).default(1),
  sort: canonicalSortSchema.default('most-offers'),
  page: z.coerce.number().int().positive().max(1000).default(1),
  limit: z.coerce.number().int().positive().max(60).default(24),
});
export type CanonicalProductsQuery = z.infer<typeof canonicalProductsQuerySchema>;

export const canonicalProductsResponseSchema = z.object({
  items: z.array(canonicalProductSummarySchema),
  pagination: paginationMetaSchema,
  sort: canonicalSortSchema,
});
export type CanonicalProductsResponse = z.infer<typeof canonicalProductsResponseSchema>;

export const canonicalOffersQuerySchema = z.object({
  sort: offerSortSchema.default('lowest-total'),
  includeOutOfStock: z.coerce.boolean().default(true),
});
export type CanonicalOffersQuery = z.infer<typeof canonicalOffersQuerySchema>;

export const canonicalOffersResponseSchema = z.object({
  canonicalProductId: idSchema,
  currency: currencySchema,
  sort: offerSortSchema,
  offers: z.array(canonicalOfferSchema),
  comparison: offerComparisonSchema,
});
export type CanonicalOffersResponse = z.infer<typeof canonicalOffersResponseSchema>;

/** One store's recorded price line, for the multi-series chart. */
export const storePriceSeriesSchema = z.object({
  storeId: idSchema,
  storeSlug: z.string().max(64),
  storeName: z.string().max(120),
  productId: idSchema,
  points: z.array(pricePointSchema),
  statistics: priceStatisticsSchema,
});
export type StorePriceSeriesDto = z.infer<typeof storePriceSeriesSchema>;

export const canonicalHistoryQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(90),
});
export type CanonicalHistoryQuery = z.infer<typeof canonicalHistoryQuerySchema>;

export const canonicalHistoryResponseSchema = z.object({
  canonicalProductId: idSchema,
  currency: currencySchema,
  days: z.number().int().positive(),
  series: z.array(storePriceSeriesSchema),
  /** The cheapest-anywhere line: per-day minimum across all stores. */
  best: z.object({
    points: z.array(pricePointSchema),
    statistics: priceStatisticsSchema,
    trend: priceTrendSchema,
  }),
  /** The lowest price ever recorded at any store, and where. */
  crossStoreLow: z
    .object({
      price: moneySchema,
      storeSlug: z.string().max(64),
      storeName: z.string().max(120),
      recordedAt: isoDateTimeSchema,
    })
    .nullable(),
});
export type CanonicalHistoryResponse = z.infer<typeof canonicalHistoryResponseSchema>;
