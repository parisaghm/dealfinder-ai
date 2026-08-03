import { z } from 'zod';
import { canonicalProductSummarySchema } from './canonical';
import { commaSeparatedList, idSchema, paginationMetaSchema, searchTextSchema } from './common';
import {
  appliedDestinationSchema,
  destinationProductSummarySchema,
  destinationQuerySchema,
} from './destination';

/**
 * `GET /api/deals` — the search endpoint.
 *
 * All four sort options map onto indexed database columns rather than onto
 * values computed in application code, so sorting is applied before
 * pagination and a page boundary can never reorder results. `discountPercent`
 * is maintained as a derived column on `Product` for exactly this reason (see
 * prisma/schema.prisma).
 */

/**
 * `lowest-delivered` is appended rather than inserted, so the existing four keep
 * their meaning and any stored `?sort=` link keeps working. It sorts on
 * `StoreOffer.totalDeliveredPrice`, which is indexed by
 * `[countryCode, totalDeliveredPrice]` precisely so that this option is still a
 * SQL sort applied before pagination rather than an in-memory reshuffle of a
 * page that was already chosen.
 *
 * It is only meaningful alongside `country`; without a destination there is no
 * delivered total to sort on, and the service falls back to `lowest-price`.
 */
export const DEAL_SORT_OPTIONS = [
  'best-discount',
  'lowest-price',
  'highest-price',
  'recently-updated',
  'lowest-delivered',
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

export const dealsQuerySchema = z
  .object({
    query: searchTextSchema.optional(),
    /**
     * Upper bound on the listed product price.
     *
     * Deliberately *not* renamed to `maximumDeliveredPrice`: this parameter is in
     * existing links, saved searches and tests, and it still means exactly what
     * it always meant. The destination-aware bound is a separate parameter, and
     * the UI relabels its field rather than repurposing this one.
     */
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
  })
  /**
   * The destination half is merged in, every field optional.
   *
   * `country` is the switch. Absent, the service runs the pre-expansion query and
   * returns the byte-identical pre-expansion payload — which is what allows this
   * feature to exist without re-baselining the API and E2E suites. Present, the
   * destination-aware branch runs.
   */
  .extend(destinationQuerySchema.shape);
export type DealsQuery = z.infer<typeof dealsQuerySchema>;

/** True when a query asked for destination-aware behaviour. */
export function isDestinationAware(
  query: Pick<DealsQuery, 'country'>,
): query is DealsQuery & { country: NonNullable<DealsQuery['country']> } {
  return query.country != null;
}

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
  /**
   * Present only for a destination-aware search. Optional rather than nullable so
   * a client on the previous contract parses an unchanged response.
   */
  destination: appliedDestinationSchema.optional(),
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
  /**
   * `destinationProductSummarySchema` is `productSummarySchema` plus one optional
   * field, so this validates a pre-expansion payload identically. The field is
   * only populated when the request named a `country`.
   */
  items: z.array(destinationProductSummarySchema),
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
