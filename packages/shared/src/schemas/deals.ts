import { z } from 'zod';
import { canonicalProductSummarySchema } from './canonical';
import { commaSeparatedList, idSchema, paginationMetaSchema, searchTextSchema } from './common';
import { productSummarySchema } from './product';

/**
 * `GET /api/deals` — the search endpoint.
 *
 * All four sort options map onto indexed database columns rather than onto
 * values computed in application code, so sorting is applied before
 * pagination and a page boundary can never reorder results. `discountPercent`
 * is maintained as a derived column on `Product` for exactly this reason (see
 * prisma/schema.prisma).
 */

export const DEAL_SORT_OPTIONS = [
  'best-discount',
  'lowest-price',
  'highest-price',
  'recently-updated',
] as const;
export const dealSortSchema = z.enum(DEAL_SORT_OPTIONS);
export type DealSort = z.infer<typeof dealSortSchema>;

export const DEALS_DEFAULT_LIMIT = 24;
export const DEALS_MAX_LIMIT = 60;

/**
 * How results are presented. Opt-in, defaulting to `none`.
 *
 * `canonical` *decorates* the page — it never changes which products the page
 * contains, how many there are, or what order they are in. Collapsing rows in
 * SQL would make `total` count products-after-grouping, which silently breaks
 * pagination, the "N deals found" summary and every price-ordering guarantee,
 * for a benefit the decoration already delivers.
 */
export const DEAL_GROUPING_OPTIONS = ['none', 'canonical'] as const;
export const dealGroupingSchema = z.enum(DEAL_GROUPING_OPTIONS);
export type DealGrouping = z.infer<typeof dealGroupingSchema>;

export const dealsQuerySchema = z.object({
  query: searchTextSchema.optional(),
  maximumPrice: z.coerce.number().positive().max(10_000_000).optional(),
  minimumDiscount: z.coerce.number().min(0).max(99).optional(),
  category: z.string().trim().max(64).optional(),
  /** Store slugs. Accepts `?stores=a&stores=b` or `?stores=a,b`. */
  stores: commaSeparatedList(z.string().trim().max(64)).optional(),
  vertical: z.string().trim().max(64).default('electronics'),
  sort: dealSortSchema.default('best-discount'),
  group: dealGroupingSchema.default('none'),
  page: z.coerce.number().int().positive().max(1000).default(1),
  limit: z.coerce.number().int().positive().max(DEALS_MAX_LIMIT).default(DEALS_DEFAULT_LIMIT),
});
export type DealsQuery = z.infer<typeof dealsQuerySchema>;

/**
 * Echo of the filters actually applied, including anything lifted out of the
 * free-text query by the parser. The search page renders this as its summary
 * so the user can always see — and correct — how their sentence was read.
 */
export const appliedFiltersSchema = z.object({
  query: z.string().nullable(),
  maximumPrice: z.number().nullable(),
  minimumDiscount: z.number().nullable(),
  category: z.string().nullable(),
  stores: z.array(z.string()),
  vertical: z.string(),
  /** e.g. ["Maximum price €1 000", "Category Laptops"] */
  interpretation: z.array(z.string()),
});
export type AppliedFilters = z.infer<typeof appliedFiltersSchema>;

/**
 * A group of offers on the current page that turned out to be one product.
 *
 * `productIds` lists only the ids *on this page*, so the client can render the
 * remaining `items` as ordinary cards without guessing. `offerCount` and
 * `storeCount` on `canonical` count every store, page or no page — which is
 * what makes "also at 2 other stores" honest.
 */
export const dealGroupSchema = z.object({
  canonicalProductId: idSchema,
  canonical: canonicalProductSummarySchema,
  productIds: z.array(idSchema),
});
export type DealGroup = z.infer<typeof dealGroupSchema>;

export const dealsResponseSchema = z.object({
  items: z.array(productSummarySchema),
  pagination: paginationMetaSchema,
  appliedFilters: appliedFiltersSchema,
  sort: dealSortSchema,
  /**
   * Present only when `group=canonical` was requested. Optional rather than
   * nullable so a client on the previous contract parses an ungrouped response
   * unchanged.
   */
  groups: z.array(dealGroupSchema).optional(),
});
export type DealsResponse = z.infer<typeof dealsResponseSchema>;
