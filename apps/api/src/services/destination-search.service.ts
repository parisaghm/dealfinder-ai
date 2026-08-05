import { Prisma, type PrismaClient } from '@deal-finder/db';
import {
  CURRENCIES,
  DEFAULT_STORE_REGION,
  countryName,
  currencyForCountry,
  isNonEuRoute,
  parseSearchQuery,
  storeCountriesForRegion,
  type AppliedDestination,
  type AppliedFilters,
  type CountryCode,
  type Currency,
  type DealSort,
  type DealsQuery,
  type DealsResponse,
  type DestinationProductSummary,
  type StoreRegion,
} from '@deal-finder/shared';
import { toDeliveryToDestination, type StoreOfferRow } from '../mappers/offer.mapper';
import { toProductSummary, type ProductRow } from '../mappers/product.mapper';
import { buildDealGroups } from './canonical-product.service';
import { findTrackedProductIds } from './deals.service';
import { loadRateContext, type RateContext } from './exchange-rate.service';
import { fetchHistoryContext } from './price-history.service';
// From the leaf module, never from `deals.service`: that module imports this one,
// and reading its constant while it is still initialising is how `select`
// silently becomes `undefined`.
import { PRODUCT_SELECT } from './selects';
import { STORE_SELECT } from './store.service';

/**
 * Destination-aware deal search.
 *
 * A sibling of `searchProductDeals`, not a rewrite of it. That function answers
 * "which listings match?" and is untouched; this one answers a different
 * question — "which offers can actually reach *this* address, and what would they
 * really cost?" — and therefore searches a different table. The root here is
 * `store_offers`, because deliverability, destination shipping and the delivered
 * total are properties of an offer to a country, not of a product.
 *
 * ## Why this one query is raw SQL
 *
 * The requirement is that filtering and sorting happen in SQL *before*
 * pagination. Sorting a page after fetching it reorders within pages and
 * silently produces wrong results — the same reasoning that made
 * `Product.discountPercent` a maintained column.
 *
 * Two things make that impossible to express in the query builder:
 *
 *  1. **The offers are in different currencies.** `store_offers.totalDeliveredPrice`
 *     is denominated in whatever the store quotes — 3 190 SEK, 249 DKK, €299 —
 *     so `ORDER BY "totalDeliveredPrice"` compares numbers that are not
 *     comparable, and a Swedish offer sorts after every euro one for arithmetic
 *     reasons. The sort key has to be normalised into the display currency
 *     *inside* the ORDER BY, which means multiplying by a per-currency rate in
 *     SQL.
 *  2. **Offers that cannot reach the destination must sort last** whatever the
 *     active comparator says, which is a leading boolean sort key
 *     (`countryCode = destination`) that no `orderBy` array can carry.
 *
 * So the ranking runs in SQL and returns offer ids in order; a second query
 * hydrates exactly those rows and they are placed back into the order SQL chose.
 * Restoring a SQL-determined order is not reordering a page — nothing is compared
 * in application code.
 *
 * Every literal below is a bound parameter. `Prisma.sql` never interpolates
 * values into the statement text, so a store slug or a search term cannot become
 * SQL.
 *
 * ## The FX rules, all in one place
 *
 * One rate table is resolved per request and threaded through. A rate that is
 * **missing** contributes `NULL` to the sort key, so the offer ranks last and
 * `deliveredTotal` returns null — it cannot win. A rate that is **stale** still
 * converts, still ranks and is still shown, labelled with its age, but is barred
 * from being crowned cheapest. Same-currency offers consult no rate at all and
 * are never affected by the state of the FX table.
 */

/** The offer columns the destination mapper needs. */
const OFFER_SELECT = {
  id: true,
  productId: true,
  countryCode: true,
  currency: true,
  productPrice: true,
  originalPrice: true,
  shippingPrice: true,
  taxesIncluded: true,
  estimatedTax: true,
  importDutyStatus: true,
  estimatedImportFees: true,
  totalDeliveredPrice: true,
  availability: true,
  deliveryMinDays: true,
  deliveryMaxDays: true,
  lastCheckedAt: true,
  store: { select: STORE_SELECT },
  product: { select: PRODUCT_SELECT },
} satisfies Prisma.StoreOfferSelect;

type OfferWithProduct = Prisma.StoreOfferGetPayload<{ select: typeof OFFER_SELECT }>;

interface CountsRow {
  total: bigint;
  unknown_shipping: bigint;
  not_shipping: bigint;
}

export interface SearchDestinationOptions {
  userId?: string;
  /** Injected by tests that need a fixed clock or a known rate table. */
  rates?: RateContext;
}

export async function searchDealsByDestination(
  prisma: PrismaClient,
  query: DealsQuery & { country: CountryCode },
  options: SearchDestinationOptions = {},
): Promise<DealsResponse> {
  const country = query.country;
  const region: StoreRegion = query.region ?? DEFAULT_STORE_REGION;

  /**
   * The display currency defaults to the destination's own.
   *
   * A shopper in Sweden is quoted in kronor unless they ask otherwise, which also
   * means the common case needs no conversion at all and so cannot be affected by
   * a stale rate.
   */
  const displayCurrency: Currency = query.currency ?? currencyForCountry(country) ?? 'EUR';

  const rates = options.rates ?? (await loadRateContext(prisma));

  // Interpret the sentence first, then let explicit fields win — identical
  // precedence to the legacy path, so the same search reads the same way with and
  // without a destination.
  const parsed = parseSearchQuery(query.query ?? '', { verticalId: query.vertical });
  const effective = {
    text: parsed.query.length > 0 ? parsed.query : undefined,
    maximumPrice: query.maximumPrice ?? parsed.maximumPrice,
    minimumDiscount: query.minimumDiscount ?? parsed.minimumDiscount,
    category: query.category ?? parsed.category,
    stores: query.stores ?? [],
  };

  const storeCountries = admissibleStoreCountries(region, country, query.includeNonEuStores);

  /**
   * Offers with no published delivery cost are shown by default.
   *
   * They are real offers and hiding them would conceal a store that genuinely
   * sells the thing. What they cannot do is win: their delivered total is null,
   * they sort last, and any delivered-cost bound removes them — a null cannot
   * satisfy an upper bound, and the count that was removed is reported rather
   * than left to look like an absence of offers.
   */
  const includeUnknownShipping = query.includeUnknownShipping ?? true;
  const shipsToCountryOnly = query.shipsToCountryOnly ?? true;

  const hasDeliveredBound =
    query.maximumDeliveredPrice != null ||
    query.maximumShippingPrice != null ||
    query.maxDeliveryDays != null;

  const rate = rateExpression(displayCurrency, rates);
  const isDeliverable = Prisma.sql`o."countryCode" = ${country}`;

  const productFilters = buildProductFilters(effective, query.vertical, rate);

  /**
   * The candidate set: every offer *to* the destination, plus each store's own
   * domestic offer for products that have no destination offer at all.
   *
   * The second branch is what makes "this store sells it but does not ship here"
   * a statement the API can make. It is always counted, so the number is
   * available even when those rows are filtered out — an offer that vanishes
   * without explanation reads as an offer that does not exist.
   */
  const baseWhere = Prisma.sql`
    s."countryCode" IN (${Prisma.join(storeCountries)})
    AND ${productFilters}
    AND (
      ${isDeliverable}
      OR (
        o."countryCode" = s."countryCode"
        AND NOT EXISTS (
          SELECT 1 FROM store_offers d
           WHERE d."productId" = o."productId" AND d."countryCode" = ${country}
        )
      )
    )
  `;

  const deliverableOnly = shipsToCountryOnly || hasDeliveredBound;

  const finalWhere = Prisma.sql`
    ${deliverableOnly ? Prisma.sql`${isDeliverable}` : Prisma.sql`TRUE`}
    AND (
      NOT (${isDeliverable})
      OR (
        ${includeUnknownShipping && !hasDeliveredBound ? Prisma.sql`TRUE` : Prisma.sql`o."shippingPrice" IS NOT NULL`}
        ${boundClause(query.maximumDeliveredPrice, Prisma.sql`o."totalDeliveredPrice" * (${rate})`)}
        ${boundClause(query.maximumShippingPrice, Prisma.sql`o."shippingPrice" * (${rate})`)}
        ${
          query.maxDeliveryDays == null
            ? Prisma.empty
            : Prisma.sql`AND o."deliveryMaxDays" IS NOT NULL AND o."deliveryMaxDays" <= ${query.maxDeliveryDays}`
        }
      )
    )
  `;

  const from = Prisma.sql`
    FROM store_offers o
    JOIN products p ON p.id = o."productId"
    JOIN stores s ON s.id = o."storeId"
  `;

  /**
   * All three counts in one statement.
   *
   * `FILTER` lets the total and the two exclusion counts share a single scan of
   * the candidate set. Three separate counts would be three round trips on a
   * database that accepts one connection at a time.
   */
  const [counts] = await prisma.$queryRaw<CountsRow[]>(Prisma.sql`
    SELECT
      count(*) FILTER (WHERE ${finalWhere}) AS total,
      count(*) FILTER (WHERE ${isDeliverable} AND o."shippingPrice" IS NULL) AS unknown_shipping,
      count(*) FILTER (WHERE NOT (${isDeliverable})) AS not_shipping
    ${from}
    WHERE ${baseWhere}
  `);

  const total = Number(counts?.total ?? 0n);
  const unknownShippingInBase = Number(counts?.unknown_shipping ?? 0n);
  const notShippingInBase = Number(counts?.not_shipping ?? 0n);

  const skip = (query.page - 1) * query.limit;

  const ordered = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT o.id
    ${from}
    WHERE ${baseWhere} AND ${finalWhere}
    ORDER BY ${orderByClause(query.sort, country, rate)}
    LIMIT ${query.limit} OFFSET ${skip}
  `);

  const orderedIds = ordered.map((row) => row.id);
  const offers = await hydrateOffers(prisma, orderedIds);

  const productIds = offers.map((offer) => offer.productId);
  const { statistics, recentHistory } = await fetchHistoryContext(prisma, productIds);
  const trackedIds = await findTrackedProductIds(prisma, options.userId, productIds);

  const items: DestinationProductSummary[] = offers.map((offer) => {
    const product = offer.product as unknown as ProductRow;
    return {
      ...toProductSummary(product, {
        statistics: statistics.get(offer.productId),
        recentHistory: recentHistory.get(offer.productId),
        isTracked: trackedIds.has(offer.productId),
      }),
      destinationOffer: toDeliveryToDestination(offer as unknown as StoreOfferRow, {
        destinationCountry: country,
        displayCurrency,
        rates,
        // The authority rule, at its only call site in search: an offer proves
        // delivery only when its own country *is* the destination.
        shipsToDestination: offer.countryCode === country,
      }),
      // Disclosed on every destination-aware item, so the UI can mark a
      // fictional retailer's catalogue and prices as synthetic.
      isDemoStore: offer.store.isDemoStore,
    };
  });

  // Grouping decorates the page that SQL already chose, ordered and counted. It
  // cannot change `items`, `pagination` or `total`.
  const groups =
    query.group === 'canonical'
      ? await buildDealGroups(
          prisma,
          offers.map((offer) => ({
            id: offer.productId,
            canonicalProductId: (offer.product as { canonicalProductId: string | null })
              .canonicalProductId,
          })),
        )
      : undefined;

  const destination: AppliedDestination = {
    country,
    countryName: countryName(country),
    currency: displayCurrency,
    region,
    storeCountries: [...storeCountries],
    maximumDeliveredPrice: query.maximumDeliveredPrice ?? null,
    maximumShippingPrice: query.maximumShippingPrice ?? null,
    maxDeliveryDays: query.maxDeliveryDays ?? null,
    excludedUnknownShipping:
      includeUnknownShipping && !hasDeliveredBound ? 0 : unknownShippingInBase,
    excludedNotShipping: deliverableOnly ? notShippingInBase : 0,
  };

  const appliedFilters: AppliedFilters = {
    query: effective.text ?? null,
    maximumPrice: effective.maximumPrice ?? null,
    minimumDiscount: effective.minimumDiscount ?? null,
    category: effective.category ?? null,
    stores: effective.stores,
    vertical: query.vertical,
    interpretation: parsed.notes,
    destination,
  };

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
    appliedFilters,
    sort: query.sort,
    ...(groups ? { groups } : {}),
  };
}

/**
 * Load the ranked offers and put them back into the order SQL chose.
 *
 * `findMany` gives no ordering guarantee for an `IN` list, so the sequence is
 * restored from `orderedIds`. This is not sorting: no offer is compared to any
 * other here, and dropping this step would randomise a page that the database
 * ordered correctly.
 */
async function hydrateOffers(
  prisma: PrismaClient,
  orderedIds: readonly string[],
): Promise<OfferWithProduct[]> {
  if (orderedIds.length === 0) return [];

  const rows = await prisma.storeOffer.findMany({
    where: { id: { in: [...orderedIds] } },
    select: OFFER_SELECT,
  });

  const byId = new Map(rows.map((row) => [row.id, row]));
  return orderedIds
    .map((id) => byId.get(id))
    .filter((row): row is OfferWithProduct => row !== undefined);
}

/**
 * Which store countries this region setting admits.
 *
 * Computed from the destination rather than read off `Store.region`, because
 * "local" has to mean local to the shopper. `includeNonEuStores` then removes
 * routes that leave the customs union: those carry import charges the displayed
 * total cannot contain, so they are opt-in rather than filtered silently.
 */
function admissibleStoreCountries(
  region: StoreRegion,
  destination: CountryCode,
  includeNonEuStores: boolean | undefined,
): readonly CountryCode[] {
  const countries = storeCountriesForRegion(region, destination);
  if (includeNonEuStores) return countries;
  return countries.filter(
    (code) => code === destination || !isNonEuRoute(code, destination),
  );
}

/**
 * The per-currency multiplier that normalises money into the display currency.
 *
 * A `CASE` over the offer's currency rather than a join, so the whole thing stays
 * one statement with no temporary table. A currency with no resolvable rate is
 * deliberately *absent* from the branches and falls through to `NULL`: an offer
 * we cannot convert must rank last and must not win, and `NULL` achieves both
 * without inventing a number.
 */
function rateExpression(displayCurrency: Currency, rates: RateContext): Prisma.Sql {
  const branches: Prisma.Sql[] = [];

  for (const currency of CURRENCIES) {
    if (currency === displayCurrency) {
      branches.push(Prisma.sql`WHEN ${currency} THEN 1::numeric`);
      continue;
    }
    const resolved = rates.table.resolve(currency, displayCurrency);
    if (resolved == null) continue;
    // The rate goes in as its exact decimal string and is cast, never as a float.
    branches.push(Prisma.sql`WHEN ${currency} THEN ${resolved.snapshot.rate}::numeric`);
  }

  if (branches.length === 0) return Prisma.sql`NULL::numeric`;
  return Prisma.sql`CASE o."currency" ${Prisma.join(branches, ' ')} ELSE NULL END`;
}

/**
 * An upper bound in the display currency, or nothing.
 *
 * `IS NOT NULL` is explicit rather than relying on `NULL <= x` being unknown,
 * because the intent needs to survive a reader: an offer with no delivered total
 * does not "fail" the bound, it cannot be evaluated against it, and either way it
 * must not appear.
 */
function boundClause(limit: number | undefined, expression: Prisma.Sql): Prisma.Sql {
  if (limit == null) return Prisma.empty;
  return Prisma.sql`AND (${expression}) IS NOT NULL AND (${expression}) <= ${limit}`;
}

function buildProductFilters(
  effective: {
    text?: string;
    maximumPrice?: number;
    minimumDiscount?: number;
    category?: string;
    stores: readonly string[];
  },
  vertical: string,
  rate: Prisma.Sql,
): Prisma.Sql {
  const clauses: Prisma.Sql[] = [Prisma.sql`p.vertical = ${vertical}`];

  if (effective.category != null) {
    clauses.push(Prisma.sql`p.category = ${effective.category}`);
  }
  if (effective.minimumDiscount != null) {
    clauses.push(Prisma.sql`p."discountPercent" >= ${Math.round(effective.minimumDiscount)}`);
  }
  if (effective.maximumPrice != null) {
    // Bounded in the display currency, like every other money filter on this
    // path, so "under €300" means the same thing whatever the store quotes in.
    clauses.push(
      Prisma.sql`(o."productPrice" * (${rate})) IS NOT NULL AND (o."productPrice" * (${rate})) <= ${effective.maximumPrice}`,
    );
  }
  if (effective.stores.length > 0) {
    clauses.push(Prisma.sql`s.slug IN (${Prisma.join([...effective.stores])})`);
  }
  if (effective.text != null) {
    // Every term must match somewhere, so "philips headphones" does not return
    // every pair of headphones — the same rule as the legacy path.
    for (const term of effective.text.split(/\s+/).filter(Boolean)) {
      const pattern = `%${escapeLike(term)}%`;
      clauses.push(
        Prisma.sql`(p.name ILIKE ${pattern} OR COALESCE(p.brand, '') ILIKE ${pattern})`,
      );
    }
  }

  return Prisma.join(clauses, ' AND ');
}

/**
 * Neutralise `LIKE` wildcards in user input.
 *
 * Not a safety measure — the value is a bound parameter and cannot alter the
 * statement. It is a correctness one: without it, searching for `50%` matches
 * every product, which looks like a bug in the search rather than in the escaping.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Ordering, entirely in SQL, applied before `LIMIT`/`OFFSET`.
 *
 * Two invariants hold for every option:
 *
 *  - **Offers that cannot reach the destination sort last**, always. An offer that
 *    cannot arrive is not a cheaper alternative to one that can, so the leading
 *    key is deliverability and no comparator can override it.
 *  - **Unknown sorts last, never first.** `NULLS LAST` on every ascending money
 *    key, so an offer that published less information can never be promoted for
 *    having published less.
 *
 * `o.id` closes every ordering. Without a total order, rows tying on the primary
 * key could appear on two pages or on neither.
 */
function orderByClause(sort: DealSort, country: CountryCode, rate: Prisma.Sql): Prisma.Sql {
  const deliverableFirst = Prisma.sql`(o."countryCode" = ${country}) DESC`;
  const normalisedTotal = Prisma.sql`(o."totalDeliveredPrice" * (${rate}))`;
  const normalisedPrice = Prisma.sql`(o."productPrice" * (${rate}))`;

  switch (sort) {
    case 'lowest-delivered':
      return Prisma.sql`${deliverableFirst}, ${normalisedTotal} ASC NULLS LAST, ${normalisedPrice} ASC NULLS LAST, o.id ASC`;
    case 'lowest-price':
      return Prisma.sql`${deliverableFirst}, ${normalisedPrice} ASC NULLS LAST, o.id ASC`;
    case 'highest-price':
      return Prisma.sql`${deliverableFirst}, ${normalisedPrice} DESC NULLS LAST, o.id ASC`;
    case 'recently-updated':
      return Prisma.sql`${deliverableFirst}, o."lastCheckedAt" DESC, o.id ASC`;
    case 'best-discount':
      return Prisma.sql`${deliverableFirst}, p."discountPercent" DESC, ${normalisedPrice} ASC NULLS LAST, o.id ASC`;
  }
}
