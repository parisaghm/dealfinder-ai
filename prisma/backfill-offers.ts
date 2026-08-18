import 'dotenv/config';

import {
  disconnectPrisma,
  getPrismaClient,
  syncCountries,
  upsertStoreOfferFromSource,
} from '@deal-finder/db';
import { DEFAULT_COUNTRY_CODE } from '@deal-finder/shared';

/**
 * Give every pre-existing product a Finland offer, from data already present.
 *
 * The migration that added the destination tables contains no data changes at
 * all; this script is the data pass, kept separate so it is re-runnable,
 * resumable and inspectable. The same split the canonical-matching backfill uses.
 *
 *   npx tsx prisma/backfill-offers.ts
 *
 * Idempotent: every write is an upsert keyed on
 * (productId, countryCode, currency), and the underlying writer only records a
 * history row when a value actually differs. Running it twice is a no-op the
 * second time, which is what makes it safe to re-run after a partial failure.
 *
 * Sequential by design. With `DATABASE_POOL_MAX=1` the database accepts one
 * connection at a time, so `Promise.all` over products would not go faster — it
 * would just queue on the single connection with less legible failure.
 *
 * ── What this script deliberately does NOT do ──────────────────────────────
 *
 * It writes no `StoreOfferPriceHistory` beyond each offer's opening observation.
 *
 * `PriceHistory` records the item price and nothing else. It says nothing about
 * what shipping cost on any past date, or what any exchange rate was. Projecting
 * it into a destination-aware series would be inventing data that never existed —
 * precisely the kind of confident fabrication this product exists to expose. So
 * destination history starts now, and the charts show a short honest series rather
 * than a long invented one.
 */

const BATCH_SIZE = 50;

const prisma = getPrismaClient();

interface Tally {
  offersCreated: number;
  offersUpdated: number;
  unchanged: number;
  failed: number;
}

/**
 * Bring the three original Finnish stores in line with the new columns.
 *
 * They pre-date the notion of a country entirely, so their `countryCode` is null
 * and their declared delivery list is empty. Both are set to Finland — which is
 * what they always were, just previously implicit.
 */
async function backfillStores(): Promise<number> {
  const stores = await prisma.store.findMany({
    where: { countryCode: null },
    select: { id: true, slug: true, name: true },
  });

  for (const store of stores) {
    await prisma.store.update({
      where: { id: store.id },
      data: {
        countryCode: DEFAULT_COUNTRY_CODE,
        region: 'local',
        supportedCurrencies: ['EUR'],
        supportedDeliveryCountries: [DEFAULT_COUNTRY_CODE],
        vatRegistrationCountry: DEFAULT_COUNTRY_CODE,
        dataSourceType: 'mock',
        // The original three carry real Finnish retailer names and are not part
        // of the fictional European set, so they are not marked as demo stores.
        isDemoStore: false,
      },
    });
    console.log(`  store ${store.name} → ${DEFAULT_COUNTRY_CODE}`);
  }

  return stores.length;
}

async function main() {
  console.log('Backfilling Finland offers for existing products…\n');

  // Countries must exist before any offer can reference one: StoreOffer.countryCode
  // is a foreign key, so this ordering is enforced by the database, not just
  // convention.
  const countries = await syncCountries(prisma);
  console.log(`  countries synced       ${countries}`);

  const storesUpdated = await backfillStores();
  console.log(`  stores backfilled      ${storesUpdated}\n`);

  const tally: Tally = { offersCreated: 0, offersUpdated: 0, unchanged: 0, failed: 0 };

  // Cursor pagination rather than skip/take: the set is being written to as we
  // walk it, and an offset would silently skip rows once one is updated.
  let cursor: string | undefined;
  let processed = 0;

  for (;;) {
    const batch = await prisma.product.findMany({
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        storeId: true,
        currentPrice: true,
        originalPrice: true,
        shippingPrice: true,
        currency: true,
        availability: true,
        lastCheckedAt: true,
        dataSourceType: true,
        store: { select: { countryCode: true } },
      },
    });
    if (batch.length === 0) break;

    for (const product of batch) {
      try {
        const storeCountry = product.store.countryCode ?? DEFAULT_COUNTRY_CODE;

        const result = await upsertStoreOfferFromSource(
          prisma,
          {
            productId: product.id,
            storeId: product.storeId,
            countryCode: DEFAULT_COUNTRY_CODE,
            storeCountryCode: storeCountry,
            currency: product.currency,
            productPrice: Number(product.currentPrice),
            originalPrice:
              product.originalPrice == null ? null : Number(product.originalPrice),
            // Null stays null. A Finnish store that never published a delivery
            // cost still has not published one, and the offer's delivered total
            // is correspondingly null rather than optimistically equal to the
            // product price.
            shippingPrice:
              product.shippingPrice == null ? null : Number(product.shippingPrice),
            // Inherited from the listing this offer is derived from. This script
            // observes nothing itself, so it cannot make the data any more
            // trustworthy than the row it read.
            dataSourceType: product.dataSourceType,
            // A Finnish store selling to a Finnish buyer: VAT is already in the
            // shelf price and there is no customs border, so there is no hidden
            // charge to estimate. Both derived by the shared route rules.
            availability: product.availability,
            // Not published by any existing source, and saying "unknown" is
            // correct — inventing "2–4 days" would be a fabricated promise.
            deliveryMinDays: null,
            deliveryMaxDays: null,
          },
          { now: product.lastCheckedAt },
        );

        if (result.isNew) tally.offersCreated += 1;
        else if (result.changed) tally.offersUpdated += 1;
        else tally.unchanged += 1;
      } catch (error) {
        // One bad product must never abort a catalogue-wide pass.
        tally.failed += 1;
        console.error(
          `  ! ${product.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      processed += 1;
    }

    cursor = batch[batch.length - 1]?.id;
    if (batch.length < BATCH_SIZE) break;
  }

  // Verification, printed rather than assumed. A backfill that quietly covered
  // 57 of 58 products is a bug that only shows up much later.
  const productCount = await prisma.product.count();
  const offerCount = await prisma.storeOffer.count({
    where: { countryCode: DEFAULT_COUNTRY_CODE },
  });
  const withUnknownShipping = await prisma.storeOffer.count({
    where: { countryCode: DEFAULT_COUNTRY_CODE, shippingPrice: null },
  });
  const withNullTotal = await prisma.storeOffer.count({
    where: { countryCode: DEFAULT_COUNTRY_CODE, totalDeliveredPrice: null },
  });

  console.log(
    [
      '',
      `  products processed     ${processed}`,
      `  offers created         ${tally.offersCreated}`,
      `  offers updated         ${tally.offersUpdated}`,
      `  unchanged (re-run)     ${tally.unchanged}`,
      ...(tally.failed > 0 ? [`  failed                 ${tally.failed}`] : []),
      '',
      `  products in database   ${productCount}`,
      `  Finland offers         ${offerCount}`,
      `  shipping unpublished   ${withUnknownShipping}`,
      `  delivered total null   ${withNullTotal}`,
      '',
      productCount === offerCount
        ? '  ✓ every product has a Finland offer'
        : `  ! ${productCount - offerCount} product(s) have no Finland offer`,
      // The invariant that matters most: an unknown shipping cost must produce an
      // unknown total, never a total that silently assumed free delivery.
      withUnknownShipping === withNullTotal
        ? '  ✓ unknown shipping produces an unknown delivered total'
        : `  ! ${withNullTotal} null totals vs ${withUnknownShipping} unpublished shipping — these must match`,
      '',
    ].join('\n'),
  );

  if (productCount !== offerCount || withUnknownShipping !== withNullTotal) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error('\nBackfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
