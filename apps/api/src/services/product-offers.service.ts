import type { Prisma, PrismaClient } from '@deal-finder/db';
import {
  compareDeliveredOffers,
  countryName,
  scoreDealQuality,
  sortDeliveredOffers,
  type Currency,
  type DeliveredHistoryResponse,
  type DestinationHistoryQuery,
  type DestinationOffer,
  type ProductOffersQuery,
  type ProductOffersResponse,
} from '@deal-finder/shared';
import { ApiError } from '../errors';
import {
  toDeliveredComparison,
  toDeliveredHistoryPoint,
  toDeliveredSortable,
  toDestinationOffer,
  type StoreOfferHistoryRow,
  type StoreOfferRow,
} from '../mappers/offer.mapper';
import { loadRateContext, type RateContext } from './exchange-rate.service';
import { STORE_SELECT } from './store.service';

/**
 * Destination-aware offers for one product, and their recorded history.
 *
 * The comparison table's data source. Two things separate it from the existing
 * canonical-product comparison:
 *
 *  1. It compares **delivered totals to a chosen country**, so an offer that
 *     cannot reach that country is not a cheaper alternative — it is a different
 *     answer to a different question, and is returned in its own field rather
 *     than mixed into the ranking.
 *  2. It reads the **history of the offer**, not of the product. `PriceHistory`
 *     records what an item was listed at; it says nothing about what delivery to
 *     Finland cost on any past date, so it is never substituted here.
 */

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
  dataSourceType: true,
  lastCheckedAt: true,
  store: { select: STORE_SELECT },
  product: {
    select: {
      id: true,
      // Provenance and the deep link: a row must be able to link to the listing
      // rather than the retailer's front page, and the gate needs the listing's
      // own source because a quote is never more trustworthy than its listing.
      productUrl: true,
      dataSourceType: true,
      discountPercent: true,
      currency: true,
      currentPrice: true,
      originalPrice: true,
      shippingPrice: true,
      availability: true,
    },
  },
} satisfies Prisma.StoreOfferSelect;

type OfferRow = Prisma.StoreOfferGetPayload<{ select: typeof OFFER_SELECT }>;

export interface ProductOffersOptions {
  /** Injected by tests that need a fixed clock or a known rate table. */
  rates?: RateContext;
}

export async function getProductOffers(
  prisma: PrismaClient,
  productId: string,
  query: ProductOffersQuery,
  options: ProductOffersOptions = {},
): Promise<ProductOffersResponse> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, canonicalProductId: true },
  });
  if (!product) throw ApiError.notFound('Product');

  /**
   * Which listings count as "this product".
   *
   * All the listings grouped into the same canonical product, so the table
   * compares stores rather than repeating one store's own offer. An unmatched
   * listing is its own group of one — a store can legitimately be the only one
   * carrying something.
   */
  const siblingWhere: Prisma.ProductWhereInput =
    product.canonicalProductId == null
      ? { id: productId }
      : { canonicalProductId: product.canonicalProductId };

  const rates = options.rates ?? (await loadRateContext(prisma));

  /**
   * The destination offers, plus each store's domestic offer.
   *
   * Both in one query. The domestic rows are what make "this store sells it but
   * does not ship here" a fact the response can state, instead of leaving the
   * store's absence to be read as "nobody else sells this".
   */
  const rows = await prisma.storeOffer.findMany({
    where: { product: siblingWhere },
    select: OFFER_SELECT,
    orderBy: [{ totalDeliveredPrice: 'asc' }, { id: 'asc' }],
  });

  const deliverable: DestinationOffer[] = [];
  const seenStores = new Set<string>();
  const domesticByStore = new Map<string, OfferRow>();

  for (const row of rows) {
    if (row.countryCode === query.country) {
      // Prefer the offer quoted in the requested currency when a store publishes
      // more than one for the same destination; they are genuinely different
      // offers, and the one the shopper asked to be billed in is the right default.
      const existingIndex = deliverable.findIndex((offer) => offer.store.id === row.store.id);
      const isPreferred = row.currency === query.currency;
      if (existingIndex >= 0 && !isPreferred) continue;
      const mapped = toDestinationOffer(row as unknown as StoreOfferRow, {
        destinationCountry: query.country,
        displayCurrency: query.currency,
        rates,
        shipsToDestination: true,
      });
      if (existingIndex >= 0) deliverable[existingIndex] = mapped;
      else deliverable.push(mapped);
      seenStores.add(row.store.id);
      continue;
    }

    // A candidate for the "does not ship here" list, kept only if the store turns
    // out to have no destination offer at all.
    if (row.store.countryCode === row.countryCode && !domesticByStore.has(row.store.id)) {
      domesticByStore.set(row.store.id, row);
    }
  }

  const unavailableHere: DestinationOffer[] = [...domesticByStore.entries()]
    .filter(([storeId]) => !seenStores.has(storeId))
    .map(([, row]) =>
      toDestinationOffer(row as unknown as StoreOfferRow, {
        destinationCountry: query.country,
        displayCurrency: query.currency,
        rates,
        shipsToDestination: false,
      }),
    );

  const sortableFor = (offer: DestinationOffer, row: OfferRow | undefined) =>
    toDeliveredSortable(offer, {
      discountPercent: row?.product.discountPercent ?? 0,
      dealQualityScore: dealQualityScoreFor(row),
    });

  const rowById = new Map(rows.map((row) => [row.id, row]));

  /**
   * The comparison always sees every offer, deliverable or not.
   *
   * `unavailableHere` is a separate field, not a filtered-out one: the summary has
   * to be able to say "4 of 7 stores ship to Finland", and it cannot count what it
   * was never shown. `includeNonShipping` therefore governs presentation only —
   * whether the client wants those rows rendered inline — and never what the
   * comparison is computed from.
   */
  const comparisonInput = [...deliverable, ...unavailableHere].map((offer) =>
    sortableFor(offer, rowById.get(offer.id)),
  );

  const rankedIds = new Map(
    sortDeliveredOffers(comparisonInput, 'lowest-delivered').map((offer, index) => [
      offer.id,
      index,
    ]),
  );

  return {
    productId,
    canonicalProductId: product.canonicalProductId,
    // Cheapest delivered first, applying the shared ranking rules — so an
    // out-of-stock or FX-stale offer keeps its place in the list but cannot be
    // the one the comparison crowns.
    offers: [...deliverable].sort(
      (a, b) => (rankedIds.get(a.id) ?? 0) - (rankedIds.get(b.id) ?? 0),
    ),
    unavailableHere,
    comparison: toDeliveredComparison(
      compareDeliveredOffers(comparisonInput),
      query.country,
      query.currency,
    ),
  };
}

/**
 * Deal quality for the `best-deal-quality` ordering, from the shared scorer.
 *
 * Computed from the product's own listed figures rather than the destination
 * offer, because that is what the score means everywhere else in the application
 * and two different definitions of "a good deal" would be worse than one
 * imperfect one.
 */
function dealQualityScoreFor(row: OfferRow | undefined): number {
  if (row == null) return 0;
  return scoreDealQuality({
    currentPrice: Number(row.product.currentPrice),
    originalPrice: row.product.originalPrice == null ? null : Number(row.product.originalPrice),
    shippingPrice: row.product.shippingPrice == null ? null : Number(row.product.shippingPrice),
    availability: row.product.availability,
    currency: row.product.currency as Currency,
    recentHistory: [],
  }).score;
}

const HISTORY_SELECT = {
  productPrice: true,
  shippingPrice: true,
  estimatedTax: true,
  estimatedImportFees: true,
  totalDeliveredPrice: true,
  originalCurrency: true,
  exchangeRate: true,
  exchangeRateTimestamp: true,
  availability: true,
  recordedAt: true,
} satisfies Prisma.StoreOfferPriceHistorySelect;

/**
 * `GET /api/products/:id/history?country=FI&currency=EUR`
 *
 * Reads `StoreOfferPriceHistory` and nothing else. When no offer reaches the
 * destination the series is empty and `hasDestinationOffer` is false — the
 * product's `PriceHistory` is *not* returned in its place. Item-price history
 * says nothing about what delivery to a given country cost on a given date, and
 * presenting it as if it did would manufacture exactly the kind of confident
 * wrong number this feature exists to expose.
 */
export async function getDestinationHistory(
  prisma: PrismaClient,
  productId: string,
  query: DestinationHistoryQuery & { country: NonNullable<DestinationHistoryQuery['country']> },
): Promise<DeliveredHistoryResponse> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) throw ApiError.notFound('Product');

  const offers = await prisma.storeOffer.findMany({
    where: { productId, countryCode: query.country },
    select: { id: true, currency: true },
    orderBy: { id: 'asc' },
  });

  // Prefer the offer quoted in the requested currency; otherwise the only one
  // there is. Two offers for one destination in two currencies are two real
  // offers with two real series, not duplicates to merge.
  const offer = offers.find((candidate) => candidate.currency === query.currency) ?? offers[0];

  if (!offer) {
    return {
      productId,
      destinationCountry: query.country,
      destinationCountryName: countryName(query.country),
      storeOfferId: null,
      currency: null,
      hasDestinationOffer: false,
      points: [],
    };
  }

  const since = new Date(Date.now() - query.days * 86_400_000);
  const rows = await prisma.storeOfferPriceHistory.findMany({
    where: { storeOfferId: offer.id, recordedAt: { gte: since } },
    select: HISTORY_SELECT,
    orderBy: { recordedAt: 'asc' },
  });

  return {
    productId,
    destinationCountry: query.country,
    destinationCountryName: countryName(query.country),
    storeOfferId: offer.id,
    currency: offer.currency as Currency,
    hasDestinationOffer: true,
    points: rows.map((row) => toDeliveredHistoryPoint(row as StoreOfferHistoryRow)),
  };
}
