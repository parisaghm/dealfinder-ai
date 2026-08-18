import 'dotenv/config';

import {
  disconnectPrisma,
  getPrismaClient,
  pruneOrphanedCanonicalProducts,
  recordStoreOfferSeries,
  resolveCanonicalForProduct,
  syncCountries,
  upsertProductFromSource,
  upsertStoreOfferFromSource,
  type StoreOfferObservation,
} from '@deal-finder/db';
import {
  createRateTable,
  DEFAULT_VERTICAL_ID,
  MATCHER_VERSION,
  STATIC_RATE_SOURCE,
  staticRateSnapshots,
  SUPPORTED_COUNTRY_CODES,
  type CountryCode,
  type Currency,
} from '@deal-finder/shared';
import {
  createMockProvider,
  DEMO_EUROPEAN_MOCK_DATASETS,
  FINNISH_MOCK_DATASETS,
  generatePriceHistory,
  ProviderUnsupportedDestinationError,
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

/**
 * Three real-named Finnish stores plus seven fictional European ones.
 *
 * The European seven are entirely synthetic and every one is written with
 * `isDemoStore: true`, so the API and the UI can label them. See
 * `packages/store-providers/src/mock/data/demo-catalogue.ts`.
 */
const DATASETS: readonly MockStoreDataset[] = [
  ...FINNISH_MOCK_DATASETS,
  ...DEMO_EUROPEAN_MOCK_DATASETS,
];

const prisma = getPrismaClient();

const DEV_USER_EMAIL = process.env.DEV_USER_EMAIL ?? 'demo@dealfinder.test';
const DEV_USER_NAME = process.env.DEV_USER_NAME ?? 'Demo User';

/** Fixed clock so a re-seed produces identical history. */
const SEED_NOW = new Date();

/**
 * The instant stamped on seeded exchange rates: midnight UTC today.
 *
 * Truncating to the day is what makes rate seeding idempotent. `fetchedAt` is part
 * of the unique key, so a wall-clock timestamp would insert a fresh row on every
 * run; a fixed historical constant would instead go stale and — once past
 * `FX_RATE_MAX_AGE_HOURS` — bar every converted offer from winning a
 * cheapest-delivered comparison, quietly breaking the demo it exists to support.
 *
 * Day granularity gives both: re-running today is a no-op, running tomorrow adds
 * one genuine new observation per pair, and the rate never ages past a day.
 */
const RATE_FETCHED_AT = new Date(
  Date.UTC(SEED_NOW.getUTCFullYear(), SEED_NOW.getUTCMonth(), SEED_NOW.getUTCDate()),
);

/** Currency every demo offer is compared in, for the recorded history series. */
const COMPARISON_CURRENCY: Currency = 'EUR';

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
  const currency: Currency = dataset.currency ?? 'EUR';

  /**
   * Destination metadata, taken from the dataset rather than hard-coded.
   *
   * `supportedDeliveryCountries` is written from the delivery-rule map, so the
   * declared capability cannot drift from the rules that actually produce offers.
   * It remains coarse metadata either way — deliverability of any *specific*
   * product is decided by the presence of a StoreOffer row, never by this array.
   */
  const destination = {
    countryCode: dataset.countryCode ?? 'FI',
    region: dataset.region ?? 'local',
    supportedCurrencies: [...(dataset.supportedCurrencies ?? [currency])],
    supportedDeliveryCountries: Object.keys(dataset.deliveryRules ?? { FI: {} }),
    vatRegistrationCountry: dataset.vatRegistrationCountry ?? dataset.countryCode ?? 'FI',
    /**
     * How the store *record* was obtained. Its listings and quotes carry their own
     * `dataSourceType`, and that is the one the UI gates the external link on: a
     * real retailer can hold an invented listing, which is exactly the case for
     * the three Finnish stores below.
     */
    dataSourceType: createMockProvider(dataset, { minLatencyMs: 0, maxLatencyMs: 0 }).sourceKind,
    isDemoStore: dataset.isDemoStore ?? false,
  };

  return prisma.store.upsert({
    where: { slug: dataset.slug },
    create: {
      slug: dataset.slug,
      name: dataset.name,
      websiteUrl: dataset.websiteUrl,
      logoUrl: dataset.logoUrl,
      isActive: true,
      ...destination,
    },
    update: {
      name: dataset.name,
      websiteUrl: dataset.websiteUrl,
      logoUrl: dataset.logoUrl,
      ...destination,
    },
    select: { id: true, slug: true, name: true, countryCode: true, isDemoStore: true },
  });
}

async function seedProducts(dataset: MockStoreDataset, storeId: string) {
  let count = 0;
  // The store's own currency. The three Finnish datasets omit it and default to
  // EUR, exactly as they did before this field existed.
  const currency: Currency = dataset.currency ?? 'EUR';

  /**
   * Provenance taken from the provider rather than written as a literal here.
   *
   * `productUrl` below is a synthetic id interpolated into the retailer's genuine
   * URL shape, so for Gigantti, Power and Verkkokauppa it is a well-formed 404 on
   * a real domain. Recording where the data actually came from is what stops the
   * web layer offering it as a live deal — and reading it off the provider means
   * that if the adapter ever reported a different kind, the seed would follow it
   * instead of contradicting it.
   */
  const { sourceKind } = createMockProvider(dataset, { minLatencyMs: 0, maxLatencyMs: 0 });

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
        currency,
        availability: definition.availability ?? 'IN_STOCK',
        modelNumber: definition.modelNumber ?? null,
        gtin: definition.gtin ?? null,
        ean: definition.ean ?? null,
        mpn: definition.mpn ?? null,
        attributes: definition.attributes ?? null,
        dataSourceType: sourceKind,
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
        currency,
        recordedAt: new Date(point.recordedAt),
      })),
    });

    count += 1;
  }

  return count;
}

/**
 * Seed the static demo exchange rates.
 *
 * ILLUSTRATIVE DATA, NOT MARKET RATES. No live FX API is called, and none should
 * be: the application has to work offline and deterministically, and every
 * converted price in the UI is labelled an estimate carrying the timestamp of the
 * rate that produced it.
 *
 * Only `X -> EUR` is written. `createRateTable` derives the inverse and every
 * cross-pair by inverting and triangulating through EUR, labelling each result
 * with how it was obtained — so seeding 42 directed pairs by hand would add 42
 * chances for one to disagree with the others.
 *
 * Idempotent on `(baseCurrency, quoteCurrency, fetchedAt)` with the timestamp
 * truncated to the day, so a same-day re-run updates in place instead of appending.
 */
async function seedExchangeRates() {
  const snapshots = staticRateSnapshots(RATE_FETCHED_AT);

  for (const snapshot of snapshots) {
    await prisma.exchangeRate.upsert({
      where: {
        baseCurrency_quoteCurrency_fetchedAt: {
          baseCurrency: snapshot.baseCurrency,
          quoteCurrency: snapshot.quoteCurrency,
          fetchedAt: RATE_FETCHED_AT,
        },
      },
      create: {
        baseCurrency: snapshot.baseCurrency,
        quoteCurrency: snapshot.quoteCurrency,
        rate: snapshot.rate,
        fetchedAt: RATE_FETCHED_AT,
        source: STATIC_RATE_SOURCE,
      },
      update: { rate: snapshot.rate, source: STATIC_RATE_SOURCE },
    });
  }

  return snapshots.length;
}

export interface OfferSeedTally {
  offers: number;
  historyPoints: number;
  destinationsRefused: number;
}

/**
 * Seed destination-specific offers for one store, and their synthetic history.
 *
 * Offers are obtained by calling the provider's own `getOffer`, not by reading the
 * dataset directly. That is deliberate and mirrors why products go through
 * `upsertProductFromSource`: seeding exercises the real provider contract, so the
 * per-destination rules, the product-level exclusions and the
 * unsupported-destination error are all proven by `db:seed` rather than only by
 * unit tests.
 *
 * Rows are created **only** for destinations the provider actually supports, and
 * only for products it will quote. A store declaring Finland while one listing
 * cannot get there produces no Finnish offer for that listing — which is what
 * makes StoreOffer, and not `Store.supportedDeliveryCountries`, the authority on
 * deliverability.
 */
async function seedStoreOffers(
  dataset: MockStoreDataset,
  storeId: string,
  rateTable: ReturnType<typeof createRateTable>,
): Promise<OfferSeedTally> {
  const provider = createMockProvider(dataset, { minLatencyMs: 0, maxLatencyMs: 0 });
  const storeCountry = (dataset.countryCode ?? 'FI') as CountryCode;
  const currency: Currency = dataset.currency ?? 'EUR';

  // Only destinations that are both declared by the store and selectable in the
  // application. A store may legitimately declare Belgium; we do not offer it, so
  // no offers are generated for it and it correctly reads as not deliverable.
  const destinations = SUPPORTED_COUNTRY_CODES.filter((country) =>
    provider.supportsDestination(country),
  );

  // The rate used to compare this store's prices, recorded with each history point
  // so a past observation can be re-explained later. Null for a euro store, which
  // needs no conversion and must never be penalised for the state of the FX table.
  const resolved = currency === COMPARISON_CURRENCY ? null : rateTable.resolve(currency, COMPARISON_CURRENCY);
  const exchangeRate = resolved == null ? null : Number(resolved.snapshot.rate);
  const exchangeRateTimestamp = resolved == null ? null : new Date(resolved.snapshot.fetchedAt);

  const tally: OfferSeedTally = { offers: 0, historyPoints: 0, destinationsRefused: 0 };

  for (const definition of dataset.products) {
    const product = await prisma.product.findUnique({
      where: { storeId_externalId: { storeId, externalId: definition.externalId } },
      select: { id: true },
    });
    if (!product) continue;

    const productUrl = dataset.productUrlTemplate.replace('{id}', definition.externalId);

    for (const destinationCountry of destinations) {
      let offer;
      try {
        offer = await provider.getOffer(productUrl, { destinationCountry, currency });
      } catch (error) {
        if (error instanceof ProviderUnsupportedDestinationError) {
          // Expected for a product excluded from an otherwise-served destination.
          // No offer row is written, so the product is correctly not deliverable
          // there. Counted rather than swallowed so the seed output shows it.
          tally.destinationsRefused += 1;
          continue;
        }
        throw error;
      }

      const { offerId } = await upsertStoreOfferFromSource(
        prisma,
        {
          productId: product.id,
          storeId,
          countryCode: destinationCountry,
          storeCountryCode: storeCountry,
          currency: offer.currency,
          productPrice: offer.productPrice,
          originalPrice: offer.originalPrice ?? null,
          // Null stays null all the way through. The delivered total for such an
          // offer is null too, which is what bars it from winning.
          shippingPrice: offer.shippingPrice ?? null,
          availability: offer.availability,
          deliveryMinDays: offer.deliveryMinDays ?? null,
          deliveryMaxDays: offer.deliveryMaxDays ?? null,
          // Straight from the adapter that produced this quote, so the row records
          // where the price came from rather than where we hope it came from.
          dataSourceType: provider.sourceKind,
          // Tax and duty are left to the shared route rules rather than asserted
          // by the dataset, so one implementation governs every store.
        },
        // The synthetic series below replaces any single observation.
        { now: SEED_NOW, skipHistory: true },
      );
      tally.offers += 1;

      /**
       * Synthetic destination history — SYNTHETIC, and only for demo offers.
       *
       * Nothing is fabricated for the Finnish stores. Their `PriceHistory` records
       * an item price and says nothing about what delivery cost on any past date,
       * so projecting a destination series out of it would be inventing data.
       *
       * The product-price series is the dataset's own deterministic one; shipping,
       * tax and duty are held at today's values across it, because the delivery
       * rules are static in the dataset and pretending they fluctuated would be a
       * second fabrication on top of the first.
       */
      if (dataset.isDemoStore === true) {
        const series = generatePriceHistory(
          definition.externalId,
          definition.currentPrice,
          definition.history,
          SEED_NOW,
        );

        const observations: StoreOfferObservation[] = series.map((point) => ({
          productPrice: point.price,
          shippingPrice: offer.shippingPrice ?? null,
          estimatedTax: null,
          estimatedImportFees: null,
          currency: offer.currency,
          availability: offer.availability,
          recordedAt: new Date(point.recordedAt),
          displayCurrency: COMPARISON_CURRENCY,
          exchangeRate,
          exchangeRateTimestamp,
        }));

        // Replaces the offer's series rather than appending, so re-seeding cannot
        // double it.
        tally.historyPoints += await recordStoreOfferSeries(prisma, offerId, observations);
      }
    }
  }

  return tally;
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

  // Countries first: StoreOffer.countryCode is a foreign key, so the database
  // itself enforces this ordering.
  const countryCount = await syncCountries(prisma);
  const rateCount = await seedExchangeRates();
  console.log(`  countries        ${countryCount}`);
  console.log(`  exchange rates   ${rateCount} (${STATIC_RATE_SOURCE}, illustrative)\n`);

  let productTotal = 0;
  const seededStores: Array<{ dataset: MockStoreDataset; storeId: string; name: string }> = [];
  for (const dataset of DATASETS) {
    const store = await seedStore(dataset);
    const count = await seedProducts(dataset, store.id);
    productTotal += count;
    seededStores.push({ dataset, storeId: store.id, name: store.name });
    const marker = store.isDemoStore ? ' [demo]' : '';
    console.log(`  ${store.name.padEnd(30)}${String(count).padStart(3)} products${marker}`);
  }

  // Matching runs after every store, because grouping a listing needs its
  // cross-store peers to exist first.
  await seedMatching();
  const rejectedCount = await seedRejectedCandidate();

  /**
   * Destination offers, after every product exists.
   *
   * The rate table is built once from what was just seeded and threaded down, so
   * the conversion recorded against each history point is the same rate the API
   * will resolve at read time.
   */
  const rateRows = await prisma.exchangeRate.findMany({
    select: { baseCurrency: true, quoteCurrency: true, rate: true, fetchedAt: true },
  });
  const rateTable = createRateTable(
    rateRows.map((row) => ({
      baseCurrency: row.baseCurrency as Currency,
      quoteCurrency: row.quoteCurrency as Currency,
      rate: row.rate.toString(),
      fetchedAt: row.fetchedAt.toISOString(),
    })),
  );

  const offerTally: OfferSeedTally = { offers: 0, historyPoints: 0, destinationsRefused: 0 };
  for (const entry of seededStores) {
    const tally = await seedStoreOffers(entry.dataset, entry.storeId, rateTable);
    offerTally.offers += tally.offers;
    offerTally.historyPoints += tally.historyPoints;
    offerTally.destinationsRefused += tally.destinationsRefused;
  }

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

  const offerHistoryCount = await prisma.storeOfferPriceHistory.count();
  const unknownShipping = await prisma.storeOffer.count({ where: { shippingPrice: null } });
  const nullTotals = await prisma.storeOffer.count({ where: { totalDeliveredPrice: null } });
  const demoStoreCount = await prisma.store.count({ where: { isDemoStore: true } });
  const offersByCountry = await prisma.storeOffer.groupBy({
    by: ['countryCode'],
    _count: { _all: true },
    orderBy: { countryCode: 'asc' },
  });

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
      `  demo stores        ${demoStoreCount} of ${DATASETS.length} (synthetic data)`,
      `  destination offers ${offerTally.offers}`,
      `    by country       ${offersByCountry.map((row) => `${row.countryCode}:${String(row._count._all)}`).join(' ')}`,
      `    refused          ${offerTally.destinationsRefused} (product not deliverable to a destination its store serves)`,
      `  offer history      ${offerHistoryCount} observations (demo stores only, synthetic)`,
      `  shipping unknown   ${unknownShipping} offer(s) -> ${nullTotals} null delivered total(s)`,
      '',
      'Done. Start the app with `npm run dev`.',
    ].join('\n'),
  );

  // The invariant that matters most, asserted rather than merely printed: an
  // unpublished delivery cost must yield an unknown total. If these diverge,
  // something substituted zero for "we do not know".
  if (unknownShipping !== nullTotals) {
    throw new Error(
      `Delivered-total invariant violated: ${String(unknownShipping)} offers have no published shipping cost but ${String(nullTotals)} have a null delivered total. These must match.`,
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error('\nSeeding failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
