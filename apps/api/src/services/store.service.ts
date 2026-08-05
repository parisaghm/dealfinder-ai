import type { Prisma, PrismaClient } from '@deal-finder/db';
import {
  storeCountriesForRegion,
  type StoresQuery,
  type StoresResponse,
} from '@deal-finder/shared';
import { toStoreWithDelivery, type OfferStoreRow } from '../mappers/offer.mapper';

/**
 * `GET /api/stores`
 *
 * The endpoint where the deliverability rule is most easily got wrong, so it is
 * stated once here: **a store appears for `?country=FI` only when it has at least
 * one Finnish `StoreOffer`.** Not when `supportedDeliveryCountries` contains
 * `FI` — that array is the store's own declaration of reach, and a store can
 * declare a country while every one of its products is excluded from it.
 *
 * Both values are returned, named so they cannot be mistaken for each other, and
 * the declared one is never used as a filter.
 */

export const STORE_SELECT = {
  id: true,
  slug: true,
  name: true,
  websiteUrl: true,
  logoUrl: true,
  isActive: true,
  countryCode: true,
  region: true,
  supportedCurrencies: true,
  supportedDeliveryCountries: true,
  vatRegistrationCountry: true,
  isDemoStore: true,
} satisfies Prisma.StoreSelect;

export async function listStores(
  prisma: PrismaClient,
  query: StoresQuery,
): Promise<StoresResponse> {
  const { country, region } = query;

  /**
   * The region filter reads store *country*, not `Store.region`.
   *
   * `Store.region` records the breadth of a store's own declared network, which
   * the listing displays. It cannot express "local", because local has to mean
   * local to the shopper — a German store is local to a German buyer and foreign
   * to a Finnish one. So the admissible set is computed from the destination.
   */
  const storeCountries =
    country != null && region != null ? storeCountriesForRegion(region, country) : null;

  const where: Prisma.StoreWhereInput = {
    isActive: true,
    ...(country != null ? { storeOffers: { some: { countryCode: country } } } : {}),
    ...(storeCountries != null ? { countryCode: { in: [...storeCountries] } } : {}),
  };

  const stores = await prisma.store.findMany({
    where,
    select: STORE_SELECT,
    orderBy: { name: 'asc' },
  });

  /**
   * Offer counts for the whole page in one aggregate.
   *
   * A count per store would be one query per row. `groupBy` keyed by `storeId` is
   * a single round trip, which matters more than usual here: the development
   * database accepts one connection at a time.
   */
  const offerCounts = new Map<string, number>();
  if (country != null && stores.length > 0) {
    const grouped = await prisma.storeOffer.groupBy({
      by: ['storeId'],
      where: { countryCode: country, storeId: { in: stores.map((store) => store.id) } },
      _count: { _all: true },
    });
    for (const row of grouped) offerCounts.set(row.storeId, row._count._all);
  }

  return {
    items: stores.map((store) =>
      toStoreWithDelivery(
        store as OfferStoreRow,
        // Null, not zero, when no country was asked about: "we did not count" is
        // a different statement from "we counted none".
        country == null ? null : (offerCounts.get(store.id) ?? 0),
      ),
    ),
    country: country ?? null,
  };
}
