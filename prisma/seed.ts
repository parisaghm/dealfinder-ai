import 'dotenv/config';

import {
  disconnectPrisma,
  getPrismaClient,
  pruneOrphanedCanonicalProducts,
  resolveCanonicalForProduct,
  upsertProductFromSource,
} from '@deal-finder/db';
import { DEFAULT_VERTICAL_ID, MATCHER_VERSION } from '@deal-finder/shared';
import {
  generatePriceHistory,
  gigantiDataset,
  powerDataset,
  verkkokauppaDataset,
  type MockStoreDataset,
} from '@deal-finder/store-providers';

/**
 * Seed the development database.
 *
 * Products are written through the same `upsertProductFromSource` path that a
 * live provider refresh uses, so seeding exercises real ingestion rather than
 * inserting rows behind its back. Price history is the deterministic synthetic
 * series declared by each sample product, which is what makes the
 * deal-quality scoring immediately visible: the catalogue deliberately
 * contains a permanent fake "sale", a rising price, genuine all-time lows and
 * volatile items.
 *
 * Idempotent: safe to run repeatedly. Products upsert on
 * `(storeId, externalId)`, and history is rewritten for each seeded product.
 */

const DATASETS: readonly MockStoreDataset[] = [gigantiDataset, powerDataset, verkkokauppaDataset];

const prisma = getPrismaClient();

const DEV_USER_EMAIL = process.env.DEV_USER_EMAIL ?? 'demo@dealfinder.test';
const DEV_USER_NAME = process.env.DEV_USER_NAME ?? 'Demo User';

/** Fixed clock so a re-seed produces identical history. */
const SEED_NOW = new Date();

async function seedUser() {
  const user = await prisma.user.upsert({
    where: { email: DEV_USER_EMAIL },
    create: { email: DEV_USER_EMAIL, name: DEV_USER_NAME },
    update: { name: DEV_USER_NAME },
    select: { id: true, email: true },
  });

  await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      notifyByEmail: true,
      notifyOnTargetReached: true,
      notifyOnPriceDrop: false,
      checkFrequency: 'EVERY_6_HOURS',
      preferredStores: [],
      preferredCategories: ['headphones', 'laptops'],
      currency: 'EUR',
    },
    update: {},
  });

  return user;
}

async function seedStore(dataset: MockStoreDataset) {
  return prisma.store.upsert({
    where: { slug: dataset.slug },
    create: {
      slug: dataset.slug,
      name: dataset.name,
      websiteUrl: dataset.websiteUrl,
      logoUrl: dataset.logoUrl,
      isActive: true,
    },
    update: { name: dataset.name, websiteUrl: dataset.websiteUrl, logoUrl: dataset.logoUrl },
    select: { id: true, slug: true, name: true },
  });
}

async function seedProducts(dataset: MockStoreDataset, storeId: string) {
  let count = 0;

  for (const definition of dataset.products) {
    const history = generatePriceHistory(
      definition.externalId,
      definition.currentPrice,
      definition.history,
      SEED_NOW,
    );

    const { productId } = await upsertProductFromSource(
      prisma,
      storeId,
      {
        externalId: definition.externalId,
        name: definition.name,
        brand: definition.brand,
        category: definition.category,
        vertical: DEFAULT_VERTICAL_ID,
        description: definition.description,
        imageUrl: `/images/products/${definition.category}.svg`,
        productUrl: dataset.productUrlTemplate.replace('{id}', definition.externalId),
        currentPrice: definition.currentPrice,
        originalPrice: definition.originalPrice ?? null,
        shippingPrice: definition.shippingPrice ?? null,
        currency: 'EUR',
        availability: definition.availability ?? 'IN_STOCK',
        modelNumber: definition.modelNumber ?? null,
        gtin: definition.gtin ?? null,
        ean: definition.ean ?? null,
        mpn: definition.mpn ?? null,
        attributes: definition.attributes ?? null,
      },
      // The synthetic series below replaces any single observation.
      { now: SEED_NOW, skipHistory: true },
    );

    await prisma.priceHistory.deleteMany({ where: { productId } });

    // Write the series in one statement rather than one round trip per point:
    // ~40 products × ~90 days is 3,600 rows.
    await prisma.priceHistory.createMany({
      data: history.map((point) => ({
        productId,
        price: point.price,
        currency: 'EUR',
        recordedAt: new Date(point.recordedAt),
      })),
    });

    count += 1;
  }

  return count;
}

/**
 * Give the demo user a populated watchlist and dashboard.
 *
 * Chosen deliberately to show every alert state at once: a target already met,
 * a target still out of reach, a paused item, and one tracked with no target.
 */
async function seedWatchlist(userId: string) {
  const picks: Array<{ externalId: string; targetPrice: number | null; alertsEnabled: boolean }> = [
    // Currently €329 — target already beaten, so it renders as TARGET_REACHED.
    { externalId: 'gig-sony-wh1000xm5', targetPrice: 349, alertsEnabled: true },
    // Currently €1,299 — still WAITING.
    { externalId: 'gig-lg-oled-c5-55', targetPrice: 1100, alertsEnabled: true },
    // The permanent fake "sale", tracked with no target: NO_TARGET.
    { externalId: 'gig-roborock-q7-max', targetPrice: null, alertsEnabled: true },
    // Monitoring paused by the user.
    { externalId: 'pow-lenovo-yoga-slim7', targetPrice: 899, alertsEnabled: false },
    // A rising price, so the change indicator has something to show.
    { externalId: 'pow-sennheiser-momentum-4', targetPrice: 240, alertsEnabled: true },
    { externalId: 'vkk-philips-oled809-55', targetPrice: 999, alertsEnabled: true },
  ];

  let created = 0;
  for (const pick of picks) {
    const product = await prisma.product.findFirst({
      where: { externalId: pick.externalId },
      select: { id: true },
    });
    if (!product) continue;

    // Tracking identity now includes destination and currency. The seeded items
    // are Finnish EUR targets, which is exactly what they were before the columns
    // existed — the defaults make this an unchanged upsert, not a new row.
    await prisma.watchlistItem.upsert({
      where: {
        userId_productId_destinationCountry_preferredCurrency: {
          userId,
          productId: product.id,
          destinationCountry: 'FI',
          preferredCurrency: 'EUR',
        },
      },
      create: {
        userId,
        productId: product.id,
        targetPrice: pick.targetPrice,
        alertsEnabled: pick.alertsEnabled,
        destinationCountry: 'FI',
        preferredCurrency: 'EUR',
      },
      update: { targetPrice: pick.targetPrice, alertsEnabled: pick.alertsEnabled },
    });
    created += 1;
  }
  return created;
}

async function seedSavedSearches(userId: string) {
  const searches = [
    {
      name: 'Noise cancelling headphones under €300',
      query: 'noise cancelling',
      category: 'headphones',
      maximumPrice: 300,
      minimumDiscount: null as number | null,
      stores: [] as string[],
      alertsEnabled: true,
    },
    {
      name: 'Laptops under €1,000',
      query: null,
      category: 'laptops',
      maximumPrice: 1000,
      minimumDiscount: null,
      stores: [],
      alertsEnabled: false,
    },
    {
      name: 'Anything at 30% off or more',
      query: null,
      category: null,
      maximumPrice: null,
      minimumDiscount: 30,
      stores: ['gigantti', 'verkkokauppa'],
      alertsEnabled: true,
    },
  ];

  // Replace rather than accumulate duplicates across repeated seeds.
  await prisma.savedSearch.deleteMany({ where: { userId } });
  await prisma.savedSearch.createMany({
    data: searches.map((search) => ({
      userId,
      name: search.name,
      query: search.query,
      category: search.category,
      maximumPrice: search.maximumPrice,
      minimumDiscount: search.minimumDiscount,
      stores: search.stores,
      vertical: DEFAULT_VERTICAL_ID,
      alertsEnabled: search.alertsEnabled,
    })),
  });

  return searches.length;
}

/** A little alert history so the dashboard's activity panel is not empty. */
async function seedNotifications(userId: string) {
  await prisma.notification.deleteMany({ where: { userId } });

  const tracked = await prisma.watchlistItem.findMany({
    where: { userId },
    select: { productId: true, product: { select: { name: true, currentPrice: true } } },
    take: 3,
  });

  if (tracked.length === 0) return 0;

  const hourMs = 3_600_000;
  await prisma.notification.createMany({
    data: tracked.map((item, index) => ({
      userId,
      productId: item.productId,
      type: 'TARGET_REACHED' as const,
      status: 'SENT' as const,
      message: `${item.product.name} reached your target price.`,
      priceAtAlert: item.product.currentPrice,
      sentAt: new Date(SEED_NOW.getTime() - (index + 1) * 8 * hourMs),
      createdAt: new Date(SEED_NOW.getTime() - (index + 1) * 8 * hourMs),
    })),
  });

  return tracked.length;
}

/**
 * Resolve cross-store identity for every seeded listing.
 *
 * Runs *after* all three stores, because matching a product needs the other
 * stores' products to already exist — a listing cannot be grouped with a peer
 * that has not been written yet.
 *
 * Idempotent without any deletes. The stickiness gate inside
 * `resolveCanonicalForProduct` short-circuits an already-attached product, and
 * the unique indexes on gtin / ean / (brandKey, mpn) make a duplicate canonical
 * record impossible to create. Deliberately no `deleteMany` on the canonical
 * tables: that would destroy the pre-rejected candidate below along with any
 * real review decisions a developer had made.
 */
async function seedMatching() {
  const products = await prisma.product.findMany({
    orderBy: { externalId: 'asc' },
    select: { id: true },
  });

  const tally = { attached: 0, created: 0, candidates: 0, unmatched: 0 };

  // Sequential, matching the loop above and the single-connection database.
  for (const product of products) {
    const outcome = await resolveCanonicalForProduct(prisma, product.id, {
      now: SEED_NOW,
      createCanonicalWhenUnmatched: true,
    });
    if (outcome.action === 'ATTACHED') tally.attached += 1;
    else if (outcome.action === 'CANONICAL_CREATED') tally.created += 1;
    else if (outcome.action === 'CANDIDATES_RECORDED') tally.candidates += 1;
    else if (outcome.action === 'UNMATCHED') tally.unmatched += 1;
  }

  await pruneOrphanedCanonicalProducts(prisma);
  return tally;
}

/**
 * Pre-reject the deliberately unsafe match.
 *
 * Power's €549 espresso machine and Gigantti's €39 milk jug share an EAN — a
 * data error real retailers do make. The engine already refuses to merge them
 * (the category mismatch and the 14× price ratio cap the score below
 * auto-attach), so it queues them for review instead. Marking that candidate
 * REJECTED here does two jobs: it gives the review UI a worked example of a
 * refused match, and it exercises the rejection memo — `db:match` will now
 * never propose the pair again.
 */
async function seedRejectedCandidate() {
  const [source, target] = await Promise.all([
    prisma.product.findFirst({
      where: { externalId: 'gig-philips-lattego-maitosailio' },
      select: { id: true, canonicalProductId: true },
    }),
    prisma.product.findFirst({
      where: { externalId: 'pow-philips-5400-espresso' },
      select: { canonicalProductId: true },
    }),
  ]);

  if (!source || !target?.canonicalProductId) return 0;
  if (source.canonicalProductId === target.canonicalProductId) {
    // The engine merged them after all. That is a regression in the matcher,
    // not something to paper over in the seed.
    throw new Error(
      'The deliberately unsafe Philips pair was auto-merged. Stage 3 should have refused it — ' +
        'check the category and price-sanity caps in packages/shared/src/matching/score.ts.',
    );
  }

  await prisma.productMatchCandidate.upsert({
    where: {
      sourceProductId_candidateCanonicalProductId: {
        sourceProductId: source.id,
        candidateCanonicalProductId: target.canonicalProductId,
      },
    },
    create: {
      sourceProductId: source.id,
      candidateCanonicalProductId: target.canonicalProductId,
      score: 55,
      confidence: 'MEDIUM',
      reasons: {
        score: 55,
        confidence: 'MEDIUM',
        method: 'IDENTIFIER',
        engineVersion: MATCHER_VERSION,
        reasons: [
          {
            key: 'identifier',
            label: 'Identifier',
            detail: 'Both listings publish EAN 8879617123455.',
            weight: 40,
            score: 100,
          },
        ],
        conflicts: [
          {
            key: 'identifier:context',
            label: 'Identifier context',
            detail:
              'The shared identifier appears on listings in unrelated categories, which usually means one store published the wrong code.',
            severity: 'REVIEWABLE',
          },
          {
            key: 'price:implausible',
            label: 'Price',
            detail:
              'Prices differ by 14.1×, which is far more than the same product varies between stores.',
            severity: 'REVIEWABLE',
          },
        ],
      },
      status: 'REJECTED',
      reviewedAt: SEED_NOW,
      reviewedBy: 'seed',
      note: 'A spare part is not the appliance it fits. The shared EAN is a retailer data error.',
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    },
    update: {
      status: 'REJECTED',
      reviewedBy: 'seed',
    },
  });

  return 1;
}

async function main() {
  console.log('Seeding DealFinder AI…\n');

  const user = await seedUser();
  console.log(`  user             ${user.email}`);

  let productTotal = 0;
  for (const dataset of DATASETS) {
    const store = await seedStore(dataset);
    const count = await seedProducts(dataset, store.id);
    productTotal += count;
    console.log(`  ${store.name.padEnd(17)}${count} products`);
  }

  // Matching runs after every store, because grouping a listing needs its
  // cross-store peers to exist first.
  await seedMatching();
  const rejectedCount = await seedRejectedCandidate();

  const watchlistCount = await seedWatchlist(user.id);
  const savedSearchCount = await seedSavedSearches(user.id);
  const notificationCount = await seedNotifications(user.id);
  const historyCount = await prisma.priceHistory.count();

  const canonicalCount = await prisma.canonicalProduct.count();
  // Counted from the database rather than from this run's tally: on a re-seed
  // every product is already attached, and reporting 0 would make an idempotent
  // run look like a broken one.
  const attachedOffers = await prisma.product.count({ where: { canonicalProductId: { not: null } } });
  const groupedCanonicals = (
    await prisma.canonicalProduct.findMany({ select: { _count: { select: { offers: true } } } })
  ).filter((entry) => entry._count.offers > 1).length;
  const pendingCandidates = await prisma.productMatchCandidate.count({ where: { status: 'PENDING' } });

  console.log(
    [
      '',
      `  products           ${productTotal}`,
      `  price history      ${historyCount} observations`,
      `  canonical products ${canonicalCount} (${groupedCanonicals} sold by more than one store)`,
      `  matched offers     ${attachedOffers} of ${productTotal}`,
      `  match candidates   ${pendingCandidates} pending, ${rejectedCount} pre-rejected`,
      `  watchlist          ${watchlistCount} items`,
      `  saved searches     ${savedSearchCount}`,
      `  notifications      ${notificationCount}`,
      '',
      'Done. Start the app with `npm run dev`.',
    ].join('\n'),
  );
}

main()
  .catch((error: unknown) => {
    console.error('\nSeeding failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
