import 'dotenv/config';

import { disconnectPrisma, getPrismaClient } from '@deal-finder/db';

/**
 * Print a row count for every table, plus the invariants that matter.
 *
 * A verification aid, not a migration or a fixture. It exists because "the seed
 * ran without error" and "the seed did what it was supposed to" are different
 * claims, and the second one needs numbers. Read-only: it opens one connection,
 * counts, and closes.
 *
 *   npm run db:counts
 *   npm run db:counts -- --json    # for diffing two runs
 *
 * Sequential by design. With `DATABASE_POOL_MAX=1` the database accepts one
 * connection at a time, so `Promise.all` over these counts would queue on the
 * single connection with less legible failure — see docs/database-environment.md.
 */

const prisma = getPrismaClient();

async function main() {
  const asJson = process.argv.includes('--json');

  const counts = {
    users: await prisma.user.count(),
    userSettings: await prisma.userSettings.count(),
    countries: await prisma.country.count(),
    countriesSupported: await prisma.country.count({ where: { isSupported: true } }),
    stores: await prisma.store.count(),
    storesDemo: await prisma.store.count({ where: { isDemoStore: true } }),
    products: await prisma.product.count(),
    canonicalProducts: await prisma.canonicalProduct.count(),
    productMatchCandidates: await prisma.productMatchCandidate.count(),
    priceHistory: await prisma.priceHistory.count(),
    storeOffers: await prisma.storeOffer.count(),
    storeOfferPriceHistory: await prisma.storeOfferPriceHistory.count(),
    exchangeRates: await prisma.exchangeRate.count(),
    watchlistItems: await prisma.watchlistItem.count(),
    savedSearches: await prisma.savedSearch.count(),
    notifications: await prisma.notification.count(),
  };

  // ── Invariants ────────────────────────────────────────────────────────────
  // Each of these is a claim the seed and backfill make. Printing them turns a
  // silent regression into a visible one.

  const offersWithUnknownShipping = await prisma.storeOffer.count({
    where: { shippingPrice: null },
  });
  const offersWithNullTotal = await prisma.storeOffer.count({
    where: { totalDeliveredPrice: null },
  });

  // An unpublished delivery cost must produce an unknown total. If a total exists
  // where shipping does not, something substituted zero for "we do not know".
  const offersWithTotalButNoShipping = await prisma.storeOffer.count({
    where: { shippingPrice: null, totalDeliveredPrice: { not: null } },
  });

  const finlandOffers = await prisma.storeOffer.count({ where: { countryCode: 'FI' } });

  const offersByCountry = await prisma.storeOffer.groupBy({
    by: ['countryCode'],
    _count: { _all: true },
    orderBy: { countryCode: 'asc' },
  });

  const storesShippingToFinland = await prisma.store.count({
    where: { storeOffers: { some: { countryCode: 'FI' } } },
  });

  // The reserved canonical groups. Their offer counts are asserted by
  // e2e/cross-store.spec.ts and must not move when demo data is added.
  const sonyGroup = await prisma.canonicalProduct.findFirst({
    where: { offers: { some: { ean: '4548736132443' } } },
    select: { name: true, _count: { select: { offers: true } } },
  });
  const philipsSharedEan = await prisma.product.findMany({
    where: { ean: '8879617123455' },
    select: { externalId: true, canonicalProductId: true },
    orderBy: { externalId: 'asc' },
  });

  /**
   * Referential integrity.
   *
   * Foreign keys already make dangling references impossible, so these should be
   * structurally unreachable. They are checked anyway because "the constraint
   * exists" and "the constraint is on the column I think it is" are different
   * claims, and a raw-SQL data pass could in principle be written that bypasses
   * Prisma's relation handling.
   */
  const [{ count: orphanOffers }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*) FROM store_offers o
       LEFT JOIN products p ON p.id = o."productId"
       LEFT JOIN stores s ON s.id = o."storeId"
      WHERE p.id IS NULL OR s.id IS NULL`,
  );
  const [{ count: orphanOfferHistory }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*) FROM store_offer_price_history h
       LEFT JOIN store_offers o ON o.id = h."storeOfferId"
      WHERE o.id IS NULL`,
  );
  const [{ count: orphanPriceHistory }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*) FROM price_history h
       LEFT JOIN products p ON p.id = h."productId"
      WHERE p.id IS NULL`,
  );
  const [{ count: danglingCanonical }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*) FROM products p
       LEFT JOIN canonical_products c ON c.id = p."canonicalProductId"
      WHERE p."canonicalProductId" IS NOT NULL AND c.id IS NULL`,
  );
  const [{ count: orphanWatchlist }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*) FROM watchlist_items w
       LEFT JOIN products p ON p.id = w."productId"
       LEFT JOIN users u ON u.id = w."userId"
      WHERE p.id IS NULL OR u.id IS NULL`,
  );

  /**
   * An offer whose store does not declare its destination.
   *
   * The reverse of the deliverability rule, and the cheaper direction to check: a
   * StoreOffer proves deliverability, so an offer for a country the store never
   * declared would mean the seed invented a delivery route. The opposite case — a
   * declared country with no offer — is legitimate and expected, because that is
   * exactly the product-level exclusion fixture.
   */
  const [{ count: offersOutsideDeclaredNetwork }] = await prisma.$queryRawUnsafe<
    Array<{ count: bigint }>
  >(
    `SELECT count(*) FROM store_offers o
       JOIN stores s ON s.id = o."storeId"
      WHERE NOT (o."countryCode" = ANY(s."supportedDeliveryCountries"))`,
  );

  const integrity = {
    orphanOffers: Number(orphanOffers),
    orphanOfferHistory: Number(orphanOfferHistory),
    orphanPriceHistory: Number(orphanPriceHistory),
    danglingCanonical: Number(danglingCanonical),
    orphanWatchlist: Number(orphanWatchlist),
    offersOutsideDeclaredNetwork: Number(offersOutsideDeclaredNetwork),
  };

  const invariants = {
    offersWithUnknownShipping,
    offersWithNullTotal,
    offersWithTotalButNoShipping,
    finlandOffers,
    storesShippingToFinland,
    offersByCountry: Object.fromEntries(
      offersByCountry.map((row) => [row.countryCode, row._count._all]),
    ),
    sonyCanonicalOffers: sonyGroup?._count.offers ?? null,
    philipsPairCanonicalIds: philipsSharedEan.map((row) => row.canonicalProductId),
    ...integrity,
  };

  if (asJson) {
    console.log(JSON.stringify({ counts, invariants }, null, 2));
    return;
  }

  const width = Math.max(...Object.keys(counts).map((key) => key.length));
  console.log('\nRow counts');
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key.padEnd(width)}  ${String(value)}`);
  }

  console.log('\nInvariants');
  console.log(`  offers by country          ${JSON.stringify(invariants.offersByCountry)}`);
  console.log(`  Finland offers             ${String(finlandOffers)}`);
  console.log(`  stores reaching Finland    ${String(storesShippingToFinland)}`);
  console.log(`  shipping unpublished       ${String(offersWithUnknownShipping)}`);
  console.log(`  delivered total null       ${String(offersWithNullTotal)}`);

  const checks: Array<[boolean, string]> = [
    [
      offersWithTotalButNoShipping === 0,
      offersWithTotalButNoShipping === 0
        ? 'no offer has a delivered total without a known shipping cost'
        : `${String(offersWithTotalButNoShipping)} offer(s) have a total but no shipping cost — zero was substituted for unknown`,
    ],
    [
      invariants.sonyCanonicalOffers === 3,
      `Sony WH-1000XM5 canonical has ${String(invariants.sonyCanonicalOffers)} offers (must be 3)`,
    ],
    [
      philipsSharedEan.length === 2 &&
        philipsSharedEan[0]?.canonicalProductId !== philipsSharedEan[1]?.canonicalProductId,
      'the Philips pair sharing an EAN remains unmerged',
    ],
    [integrity.orphanOffers === 0, 'every StoreOffer references a real Product and Store'],
    [
      integrity.orphanOfferHistory === 0,
      'every StoreOfferPriceHistory row references a real StoreOffer',
    ],
    [integrity.orphanPriceHistory === 0, 'every PriceHistory row references a real Product'],
    [integrity.danglingCanonical === 0, 'no Product points at a missing CanonicalProduct'],
    [integrity.orphanWatchlist === 0, 'every WatchlistItem references a real Product and User'],
    [
      integrity.offersOutsideDeclaredNetwork === 0,
      'no offer exists for a country its store does not declare',
    ],
  ];

  console.log('');
  let failed = 0;
  for (const [ok, message] of checks) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${message}`);
    if (!ok) failed += 1;
  }
  console.log('');

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error('\nCounting failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
