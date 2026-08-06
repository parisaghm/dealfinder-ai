import {
  countriesResponseSchema,
  createRateTable,
  dealsQuerySchema,
  dealsResponseSchema,
  deliveredHistoryResponseSchema,
  formatDeliveredCaveats,
  priceHistoryResponseSchema,
  productOffersResponseSchema,
  storesResponseSchema,
  type CountryCode,
  type DealsQuery,
} from '@deal-finder/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { emptyRateContext, type RateContext } from '../src/services/exchange-rate.service';
import { searchDealsByDestination } from '../src/services/destination-search.service';
import {
  createTestContext,
  createTestOffer,
  createTestProduct,
  prisma,
  type TestContext,
} from './helpers/fixtures';

/**
 * Destination-aware API tests.
 *
 * Against the real database and the real Express app, for the same reason the
 * existing suite is: the behaviour under test *is* the interaction with SQL —
 * currency-normalised ordering applied before `LIMIT`, deliverability read from
 * `store_offers` rather than from store metadata, and a `FILTER`ed count that has
 * to agree with the rows actually returned. A mocked client would confirm the mock.
 *
 * The exchange-rate cases inject a `RateContext` and call the service directly,
 * because "a rate ten days old must not decide the winner" cannot be exercised
 * through HTTP without waiting ten days.
 *
 * Five fixture stores, in five countries, quoting three currencies:
 *
 *   Test Store   FI  EUR  329,00  + free            = 329,00   deliverable
 *   Test Store B DE  EUR  299,00  + 12,90           = 311,90   deliverable, demo store
 *   SE store     SE  SEK  2 990   + not published   = unknown  deliverable, cannot win
 *   DK store     DK  DKK  1 990   + 99              = 2 089    deliverable, cheapest delivered
 *   FR store     FR  EUR  289,00  (declares FI, has no FI offer)  NOT deliverable
 *
 * At the seeded rates that makes the cheapest *listed* offer the Swedish one
 * (260,13 €) and the cheapest *delivered* offer the Danish one (279,93 €) — the
 * disagreement the whole feature exists to surface.
 */

const app = createApp(prisma);

let context: TestContext;
let seStoreId: string;
let dkStoreId: string;
let frStoreId: string;
let extraStoreIds: string[] = [];
let canonicalId: string;

let fiProductId: string;
let deProductId: string;
let seProductId: string;
let dkProductId: string;
let frProductId: string;

let fiOfferId: string;
let deOfferId: string;
let seOfferId: string;
let dkOfferId: string;

/** The rates the seed records, as the shared table states them. */
const SEK_TO_EUR = '0.08700000';
const DKK_TO_EUR = '0.13400000';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 7, 4, 12, 0, 0);

/** Fresh rates for both foreign currencies. */
function freshRates(): RateContext {
  return {
    table: createRateTable([
      { baseCurrency: 'SEK', quoteCurrency: 'EUR', rate: SEK_TO_EUR, fetchedAt: new Date(NOW - HOUR).toISOString() },
      { baseCurrency: 'DKK', quoteCurrency: 'EUR', rate: DKK_TO_EUR, fetchedAt: new Date(NOW - HOUR).toISOString() },
    ]),
    maxAgeHours: 48,
    now: NOW,
    isFallback: false,
  };
}

/** The Danish rate is ten days old; the Swedish one is current. */
function staleDanishRate(): RateContext {
  return {
    table: createRateTable([
      { baseCurrency: 'SEK', quoteCurrency: 'EUR', rate: SEK_TO_EUR, fetchedAt: new Date(NOW - HOUR).toISOString() },
      {
        baseCurrency: 'DKK',
        quoteCurrency: 'EUR',
        rate: DKK_TO_EUR,
        fetchedAt: new Date(NOW - 10 * 24 * HOUR).toISOString(),
      },
    ]),
    maxAgeHours: 48,
    now: NOW,
    isFallback: false,
  };
}

function destinationQuery(overrides: Partial<DealsQuery> & { country: CountryCode }): DealsQuery & {
  country: CountryCode;
} {
  const parsed = dealsQuerySchema.parse({
    query: context.brand,
    region: 'european',
    currency: 'EUR',
    ...overrides,
  });
  return { ...parsed, country: overrides.country };
}

async function createStore(suffix: string, countryCode: string, declares: string[], currency: string) {
  const store = await prisma.store.create({
    data: {
      slug: `test-${suffix}-${countryCode.toLowerCase()}-${Date.now().toString(36)}${Math.trunc(performance.now())}`,
      name: `Test ${suffix} ${countryCode} ${Date.now().toString(36)}${Math.trunc(performance.now())}`,
      websiteUrl: `https://test-${suffix}.test`,
      isActive: true,
      countryCode,
      region: 'european',
      supportedCurrencies: [currency],
      supportedDeliveryCountries: declares,
    },
    select: { id: true },
  });
  extraStoreIds.push(store.id);
  return store.id;
}

beforeAll(async () => {
  context = await createTestContext({
    storeCountry: 'FI',
    storeCurrency: 'EUR',
    storeDeliversTo: ['FI'],
    secondStoreCountry: 'DE',
    secondStoreCurrency: 'EUR',
    secondStoreDeliversTo: ['DE', 'FI'],
    // The fictional retailer, so demo-store disclosure has something to disclose.
    secondStoreIsDemo: true,
  });

  seStoreId = await createStore('se', 'SE', ['SE', 'FI'], 'SEK');
  dkStoreId = await createStore('dk', 'DK', ['DK', 'FI'], 'DKK');
  /**
   * Declares Finland and has no Finnish offer.
   *
   * The inconsistent-metadata fixture: `supportedDeliveryCountries` says FI, and
   * nothing anywhere may take that as proof that this product can be delivered.
   */
  frStoreId = await createStore('fr', 'FR', ['FR', 'FI'], 'EUR');

  const canonical = await prisma.canonicalProduct.create({
    data: {
      name: `${context.brand} Reference Headphones`,
      brand: context.brand,
      brandKey: context.brand.toLowerCase(),
      category: 'headphones',
      vertical: 'electronics',
      normalizedName: `${context.brand.toLowerCase()} reference headphones`,
    },
    select: { id: true },
  });
  canonicalId = canonical.id;

  fiProductId = await createTestProduct(context, {
    name: `${context.brand} Reference Headphones`,
    brand: context.brand,
    currentPrice: 329,
    shippingPrice: 0,
    history: [349, 339, 329],
  });
  deProductId = await createTestProduct(context, {
    name: `${context.brand} Reference Headphones`,
    brand: context.brand,
    currentPrice: 299,
    shippingPrice: 12.9,
    inSecondStore: true,
  });

  seProductId = await createProductInStore(seStoreId, 2990, 'SEK');
  dkProductId = await createProductInStore(dkStoreId, 1990, 'DKK');
  frProductId = await createProductInStore(frStoreId, 289, 'EUR');

  await prisma.product.updateMany({
    where: { id: { in: [fiProductId, deProductId, seProductId, dkProductId, frProductId] } },
    data: { canonicalProductId: canonicalId },
  });

  fiOfferId = await createTestOffer(fiProductId, context.storeId, {
    countryCode: 'FI',
    storeCountryCode: 'FI',
    currency: 'EUR',
    productPrice: 329,
    shippingPrice: 0,
    deliveryMinDays: 1,
    deliveryMaxDays: 3,
    // Two observations, so the destination series is distinguishable from the
    // product's three-point list-price series.
    history: [339, 329],
  });
  deOfferId = await createTestOffer(deProductId, context.secondStoreId, {
    countryCode: 'FI',
    storeCountryCode: 'DE',
    currency: 'EUR',
    productPrice: 299,
    shippingPrice: 12.9,
    deliveryMinDays: 3,
    deliveryMaxDays: 6,
  });
  seOfferId = await createTestOffer(seProductId, seStoreId, {
    countryCode: 'FI',
    storeCountryCode: 'SE',
    currency: 'SEK',
    productPrice: 2990,
    // Unpublished. Not zero, not free.
    shippingPrice: null,
  });
  dkOfferId = await createTestOffer(dkProductId, dkStoreId, {
    countryCode: 'FI',
    storeCountryCode: 'DK',
    currency: 'DKK',
    productPrice: 1990,
    shippingPrice: 99,
    deliveryMinDays: 2,
    deliveryMaxDays: 5,
  });
  // French store: a domestic offer only, despite declaring Finland.
  await createTestOffer(frProductId, frStoreId, {
    countryCode: 'FR',
    storeCountryCode: 'FR',
    currency: 'EUR',
    productPrice: 289,
    shippingPrice: 0,
  });
});

async function createProductInStore(
  storeId: string,
  currentPrice: number,
  currency: string,
): Promise<string> {
  const externalId = `p-${Math.trunc(performance.now())}-${currentPrice}`;
  const product = await prisma.product.create({
    data: {
      externalId,
      name: `${context.brand} Reference Headphones`,
      brand: context.brand,
      category: 'headphones',
      vertical: 'electronics',
      productUrl: `https://test.test/p/${externalId}`,
      storeId,
      currentPrice,
      currency,
      discountPercent: 0,
      availability: 'IN_STOCK',
      lastCheckedAt: new Date(),
    },
    select: { id: true },
  });
  return product.id;
}

afterAll(async () => {
  await prisma.product.deleteMany({ where: { storeId: { in: extraStoreIds } } });
  await context.cleanup();
  await prisma.store.deleteMany({ where: { id: { in: extraStoreIds } } });
  extraStoreIds = [];
});

// ── GET /api/countries ──────────────────────────────────────────────────────

describe('GET /api/countries', () => {
  it('returns all 14 modelled countries and identifies the 8 selectable ones', async () => {
    const response = await request(app).get('/api/countries').expect(200);
    const body = countriesResponseSchema.parse(response.body);

    expect(body.items).toHaveLength(14);
    expect(body.items.filter((country) => country.isSupported)).toHaveLength(8);
    expect(body.defaultCountry).toBe('FI');
  });

  it('names every country rather than relying on a code or a flag', async () => {
    const response = await request(app).get('/api/countries').expect(200);
    const body = countriesResponseSchema.parse(response.body);

    for (const country of body.items) {
      expect(country.name.length).toBeGreaterThan(country.code.length);
    }
    expect(body.items.find((country) => country.code === 'NO')?.isEuMember).toBe(false);
  });

  it('is public — no authentication required', async () => {
    await request(app).get('/api/countries').expect(200);
  });
});

// ── GET /api/stores ─────────────────────────────────────────────────────────

describe('GET /api/stores', () => {
  it('returns only stores that have at least one offer to the requested country', async () => {
    const response = await request(app).get('/api/stores?country=FI').expect(200);
    const body = storesResponseSchema.parse(response.body);

    const ids = body.items.map((store) => store.id);
    expect(ids).toContain(context.storeId);
    expect(ids).toContain(context.secondStoreId);
    expect(ids).toContain(seStoreId);
    expect(ids).toContain(dkStoreId);
    // Declares FI. Has no FI offer. Therefore absent.
    expect(ids).not.toContain(frStoreId);
    expect(body.country).toBe('FI');
  });

  it('keeps the declared delivery list separate from the counted offers', async () => {
    const response = await request(app).get('/api/stores').expect(200);
    const body = storesResponseSchema.parse(response.body);

    const french = body.items.find((store) => store.id === frStoreId);
    expect(french?.declaredDeliveryCountries).toContain('FI');
    // No country was asked about, so nothing was counted — null, not zero.
    expect(french?.offersToCountry).toBeNull();
  });

  it('counts Finnish offers per store when a country is given', async () => {
    const response = await request(app).get('/api/stores?country=FI').expect(200);
    const body = storesResponseSchema.parse(response.body);

    expect(body.items.find((store) => store.id === context.storeId)?.offersToCountry).toBe(1);
  });

  it('discloses a demo store as a demo store', async () => {
    const response = await request(app).get('/api/stores?country=FI').expect(200);
    const body = storesResponseSchema.parse(response.body);

    expect(body.items.find((store) => store.id === context.secondStoreId)?.isDemoStore).toBe(true);
    expect(body.items.find((store) => store.id === context.storeId)?.isDemoStore).toBe(false);
  });

  it('applies the region filter from the destination, not from Store.region', async () => {
    const response = await request(app).get('/api/stores?country=FI&region=local').expect(200);
    const body = storesResponseSchema.parse(response.body);

    const ids = body.items.map((store) => store.id);
    expect(ids).toContain(context.storeId);
    // Local to a Finnish shopper means Finnish stores, whatever a German store's
    // own `region` column says about the breadth of its network.
    expect(ids).not.toContain(context.secondStoreId);
  });
});

// ── The legacy path is untouched ────────────────────────────────────────────

describe('GET /api/deals without a country', () => {
  it('returns the pre-expansion payload with no destination fields at all', async () => {
    const response = await request(app)
      .get(`/api/deals?query=${encodeURIComponent(context.brand)}&limit=10`)
      .expect(200);
    const body = dealsResponseSchema.parse(response.body);

    expect(body.appliedFilters).not.toHaveProperty('destination');
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item).not.toHaveProperty('destinationOffer');
      expect(item).not.toHaveProperty('isDemoStore');
    }
  });

  it('still finds every listing regardless of deliverability', async () => {
    const response = await request(app)
      .get(`/api/deals?query=${encodeURIComponent(context.brand)}&limit=10`)
      .expect(200);
    const body = dealsResponseSchema.parse(response.body);

    // Including the French listing, which cannot be delivered to Finland — the
    // legacy path has no destination and so has no opinion about that.
    expect(body.items.map((item) => item.id)).toContain(frProductId);
    expect(body.pagination.total).toBe(5);
  });
});

// ── Destination-aware search ───────────────────────────────────────────────

describe('GET /api/deals with a country', () => {
  it('returns only offers that prove delivery to the destination', async () => {
    const response = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI' }),
      { rates: freshRates() },
    );

    const productIds = response.items.map((item) => item.id);
    expect(productIds).toHaveLength(4);
    expect(productIds).toContain(fiProductId);
    expect(productIds).toContain(deProductId);
    expect(productIds).toContain(seProductId);
    expect(productIds).toContain(dkProductId);
    // The store declares Finland. Without a Finnish offer, that claim is not ours
    // to repeat.
    expect(productIds).not.toContain(frProductId);
  });

  it('changes the catalogue when the destination changes', async () => {
    const toFrance = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FR' }),
      { rates: freshRates() },
    );

    const productIds = toFrance.items.map((item) => item.id);
    expect(productIds).toEqual([frProductId]);
    expect(toFrance.appliedFilters.destination?.countryName).toBe('France');
  });

  it('reports how many stores could not deliver, rather than dropping them silently', async () => {
    const response = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI' }),
      { rates: freshRates() },
    );

    expect(response.appliedFilters.destination?.excludedNotShipping).toBe(1);
  });

  it('ranks by delivered total, not by listed price', async () => {
    const byDelivered = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI', sort: 'lowest-delivered' }),
      { rates: freshRates() },
    );
    const byListed = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI', sort: 'lowest-price' }),
      { rates: freshRates() },
    );

    // Denmark is cheapest once 99 kr of delivery is counted; Sweden is cheapest
    // on the shelf and has no publishable total at all.
    expect(byDelivered.items[0]?.id).toBe(dkProductId);
    expect(byListed.items[0]?.id).toBe(seProductId);
    expect(byDelivered.items[0]?.id).not.toBe(byListed.items[0]?.id);
  });

  it('normalises currencies before ordering, so a krona offer is not ranked as a euro one', async () => {
    const response = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI', sort: 'lowest-price' }),
      { rates: freshRates() },
    );

    const listed = response.items.map(
      (item) => item.destinationOffer?.productPrice.converted?.major ?? null,
    );
    // 2 990 kr sorts before €299 because it is worth less, not after it because
    // 2 990 is a larger number.
    expect(listed).toEqual([...listed].sort((a, b) => (a ?? Infinity) - (b ?? Infinity)));
    expect(listed[0]).toBeCloseTo(260.13, 2);
  });

  it('sorts an unknown delivered total last and reports it as unknown', async () => {
    const response = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI', sort: 'lowest-delivered' }),
      { rates: freshRates() },
    );

    expect(response.items.at(-1)?.id).toBe(seProductId);
    const swedish = response.items.find((item) => item.id === seProductId);
    expect(swedish?.destinationOffer?.shippingPrice).toBeNull();
    expect(swedish?.destinationOffer?.totalDeliveredPrice).toBeNull();
    // Unpublished, and specifically not free.
    expect(swedish?.destinationOffer?.shipsToDestination).toBe(true);
  });

  it('sorts in SQL before pagination, so pages do not overlap or reorder', async () => {
    const first = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI', sort: 'lowest-delivered', limit: 2, page: 1 }),
      { rates: freshRates() },
    );
    const second = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI', sort: 'lowest-delivered', limit: 2, page: 2 }),
      { rates: freshRates() },
    );

    expect(first.items.map((item) => item.id)).toEqual([dkProductId, deProductId]);
    expect(second.items.map((item) => item.id)).toEqual([fiProductId, seProductId]);
    expect(first.pagination.total).toBe(4);
    expect(first.pagination.hasMore).toBe(true);
  });

  it('excludes unknown shipping when a delivered-price bound is set, and says how many', async () => {
    const response = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI', maximumDeliveredPrice: 400 }),
      { rates: freshRates() },
    );

    expect(response.items.map((item) => item.id)).not.toContain(seProductId);
    expect(response.appliedFilters.destination?.excludedUnknownShipping).toBe(1);
    expect(response.appliedFilters.destination?.maximumDeliveredPrice).toBe(400);
  });

  it('applies a delivered-price bound in the display currency', async () => {
    const response = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI', maximumDeliveredPrice: 300 }),
      { rates: freshRates() },
    );

    // €279,93 is admitted; €311,90 and €329 are not. A bound of 300 compared
    // against the raw 2 089 DKK column would have excluded Denmark instead.
    expect(response.items.map((item) => item.id)).toEqual([dkProductId]);
  });

  it('bounds delivery time only where the store publishes an estimate', async () => {
    const response = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI', maxDeliveryDays: 3 }),
      { rates: freshRates() },
    );

    // Finland promises 3 days. Sweden publishes nothing, which is not "fast".
    expect(response.items.map((item) => item.id)).toEqual([fiProductId]);
  });

  it('includes stores that cannot deliver when explicitly asked, marked as such', async () => {
    const response = await searchDealsByDestination(
      prisma,
      // `stringbool`, because this arrives as a query-string value.
      destinationQuery({ country: 'FI', shipsToCountryOnly: 'false' as never }),
      { rates: freshRates() },
    );

    const french = response.items.find((item) => item.id === frProductId);
    expect(french).toBeDefined();
    expect(french?.destinationOffer?.shipsToDestination).toBe(false);
    // Its French delivery cost and delivery estimate describe a different
    // destination and are not reused here.
    expect(french?.destinationOffer?.totalDeliveredPrice).toBeNull();
    expect(french?.destinationOffer?.shippingPrice).toBeNull();
    expect(french?.destinationOffer?.deliveryMaxDays).toBeNull();
    // It still sorts after every offer that can actually arrive.
    expect(response.items.at(-1)?.id).toBe(frProductId);
  });

  it('restricts the local region to the shopper’s own country', async () => {
    const response = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI', region: 'local' }),
      { rates: freshRates() },
    );

    expect(response.items.map((item) => item.id)).toEqual([fiProductId]);
    expect(response.appliedFilters.destination?.storeCountries).toEqual(['FI']);
  });

  it('discloses a demo store on every destination-aware item', async () => {
    const response = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI' }),
      { rates: freshRates() },
    );

    expect(response.items.find((item) => item.id === deProductId)?.isDemoStore).toBe(true);
    expect(response.items.find((item) => item.id === fiProductId)?.isDemoStore).toBe(false);
  });

  it('states the destination on the response, so a results page can name it', async () => {
    const response = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI' }),
      { rates: freshRates() },
    );

    expect(response.appliedFilters.destination).toMatchObject({
      country: 'FI',
      countryName: 'Finland',
      currency: 'EUR',
      region: 'european',
    });
    for (const item of response.items) {
      expect(item.destinationOffer?.destinationCountryName).toBe('Finland');
    }
  });

  it('is reachable over HTTP and validates against the published schema', async () => {
    const response = await request(app)
      .get(
        `/api/deals?query=${encodeURIComponent(context.brand)}&country=FI&region=european&currency=EUR&sort=lowest-delivered`,
      )
      .expect(200);

    const body = dealsResponseSchema.parse(response.body);
    expect(body.appliedFilters.destination?.country).toBe('FI');
    expect(body.items[0]?.destinationOffer?.totalDeliveredPrice?.major).toBeCloseTo(279.93, 2);
  });
});

// ── Currency conversion ────────────────────────────────────────────────────

describe('destination-aware currency conversion', () => {
  it('carries the rate and its timestamp with every converted amount', async () => {
    const response = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI' }),
      { rates: freshRates() },
    );

    const danish = response.items.find((item) => item.id === dkProductId);
    const price = danish?.destinationOffer?.productPrice;
    expect(price?.status).toBe('converted');
    expect(price?.exchangeRate).toBeCloseTo(0.134, 8);
    expect(price?.exchangeRateTimestamp).toBe(new Date(NOW - HOUR).toISOString());
    expect(price?.rateAgeHours).toBeCloseTo(1, 2);
    expect(price?.isEstimate).toBe(true);
    expect(price?.original.currency).toBe('DKK');
    expect(price?.converted?.currency).toBe('EUR');
  });

  it('needs no rate for a same-currency offer', async () => {
    const response = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI' }),
      { rates: emptyRateContext({ now: NOW }) },
    );

    const finnish = response.items.find((item) => item.id === fiProductId);
    const price = finnish?.destinationOffer?.productPrice;
    expect(price?.status).toBe('same-currency');
    expect(price?.exchangeRate).toBeNull();
    expect(price?.isEstimate).toBe(false);
    expect(price?.blocksCheapestClaim).toBe(false);
    // An empty FX table cannot touch a domestic offer.
    expect(finnish?.destinationOffer?.totalDeliveredPrice?.major).toBe(329);
  });

  it('produces no delivered total when the rate is missing, and cannot rank on one', async () => {
    const response = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI', sort: 'lowest-delivered' }),
      { rates: emptyRateContext({ now: NOW }) },
    );

    const danish = response.items.find((item) => item.id === dkProductId);
    expect(danish?.destinationOffer?.productPrice.status).toBe('rate-missing');
    expect(danish?.destinationOffer?.productPrice.converted).toBeNull();
    expect(danish?.destinationOffer?.totalDeliveredPrice).toBeNull();
    expect(danish?.destinationOffer?.blocksCheapestClaim).toBe(true);

    // With no rate, the cheapest offer that can be compared at all is the German
    // one — the Danish offer does not silently win on its raw krone figure.
    expect(response.items[0]?.id).toBe(deProductId);
  });

  it('shows a stale rate, labels its age, and refuses to rank on it as if fresh', async () => {
    const response = await searchDealsByDestination(
      prisma,
      destinationQuery({ country: 'FI' }),
      { rates: staleDanishRate() },
    );

    const danish = response.items.find((item) => item.id === dkProductId);
    const price = danish?.destinationOffer?.productPrice;
    expect(price?.status).toBe('converted-stale');
    // Still converted and still shown — hiding it would conceal a real offer.
    expect(price?.converted?.major).toBeCloseTo(266.66, 2);
    expect(price?.rateAgeHours).toBeCloseTo(240, 0);
    expect(danish?.destinationOffer?.blocksCheapestClaim).toBe(true);

    const swedish = response.items.find((item) => item.id === seProductId);
    // The Swedish rate is current, so it is unaffected.
    expect(swedish?.destinationOffer?.productPrice.status).toBe('converted');
    expect(swedish?.destinationOffer?.blocksCheapestClaim).toBe(false);
  });
});

// ── GET /api/products/:id/offers ───────────────────────────────────────────

describe('GET /api/products/:id/offers', () => {
  it('states source, destination, shipping, tax, duty, total, stock and delivery time', async () => {
    const response = await request(app)
      .get(`/api/products/${dkProductId}/offers?country=FI&currency=EUR`)
      .expect(200);
    const body = productOffersResponseSchema.parse(response.body);

    const danish = body.offers.find((offer) => offer.id === dkOfferId);
    expect(danish?.delivery).toMatchObject({
      destinationCountry: 'FI',
      destinationCountryName: 'Finland',
      sourceCountry: 'DK',
      sourceCountryName: 'Denmark',
      shipsToDestination: true,
      // Denmark and Finland are both in the EU customs union.
      taxesIncluded: true,
      importDutyStatus: 'NONE',
      availability: 'IN_STOCK',
      deliveryMinDays: 2,
      deliveryMaxDays: 5,
    });
    expect(danish?.delivery.shippingPrice?.major).toBeCloseTo(13.27, 2);
    expect(danish?.delivery.totalDeliveredPrice?.major).toBeCloseTo(279.93, 2);
  });

  it('crowns the cheapest delivered offer, not the cheapest listed one', async () => {
    const response = await request(app)
      .get(`/api/products/${fiProductId}/offers?country=FI&currency=EUR`)
      .expect(200);
    const body = productOffersResponseSchema.parse(response.body);

    expect(body.comparison.cheapestDeliveredOfferId).toBe(dkOfferId);
    expect(body.comparison.lowestDeliveredPrice?.major).toBeCloseTo(279.93, 2);
    // Sweden is cheaper on the shelf and is reported as such.
    expect(body.comparison.lowestListedPrice?.major).toBeCloseTo(260.13, 2);
  });

  it('never lets an offer with unpublished shipping win, and explains why', async () => {
    const response = await request(app)
      .get(`/api/products/${fiProductId}/offers?country=FI&currency=EUR`)
      .expect(200);
    const body = productOffersResponseSchema.parse(response.body);

    expect(body.comparison.cheapestDeliveredOfferId).not.toBe(seOfferId);
    expect(body.comparison.offersWithUnknownShipping).toBe(1);
    // The caveat travels as data; the sentence is written where the locale is known.
    expect(body.comparison.cheapestDeliveredCaveats).toContainEqual({
      kind: 'unknown-shipping',
      count: 1,
    });
    expect(formatDeliveredCaveats(body.comparison.cheapestDeliveredCaveats, 'EUR')).toContain(
      'delivery cost',
    );
  });

  it('lists a store that cannot deliver here separately, rather than omitting it', async () => {
    const response = await request(app)
      .get(`/api/products/${fiProductId}/offers?country=FI&currency=EUR`)
      .expect(200);
    const body = productOffersResponseSchema.parse(response.body);

    expect(body.offers.map((offer) => offer.id)).not.toContain(frProductId);
    expect(body.unavailableHere).toHaveLength(1);
    expect(body.unavailableHere[0]?.delivery.shipsToDestination).toBe(false);
    expect(body.unavailableHere[0]?.delivery.sourceCountryName).toBe('France');
    expect(body.comparison.offersNotShippingToDestination).toBe(1);
    expect(body.comparison.storesShippingToDestination).toBe(4);
  });

  it('discloses the demo store among the offers', async () => {
    const response = await request(app)
      .get(`/api/products/${fiProductId}/offers?country=FI&currency=EUR`)
      .expect(200);
    const body = productOffersResponseSchema.parse(response.body);

    expect(body.offers.find((offer) => offer.id === deOfferId)?.isDemoStore).toBe(true);
    expect(body.offers.find((offer) => offer.id === fiOfferId)?.isDemoStore).toBe(false);
  });

  it('404s for a product that does not exist', async () => {
    await request(app).get('/api/products/does-not-exist/offers?country=FI').expect(404);
  });
});

// ── GET /api/products/:id/history ──────────────────────────────────────────

describe('GET /api/products/:id/history', () => {
  it('reads the destination series from StoreOfferPriceHistory', async () => {
    const response = await request(app)
      .get(`/api/products/${fiProductId}/history?country=FI&currency=EUR`)
      .expect(200);
    const body = deliveredHistoryResponseSchema.parse(response.body);

    expect(body.hasDestinationOffer).toBe(true);
    expect(body.storeOfferId).toBe(fiOfferId);
    // Two offer observations, not the product's three list-price ones.
    expect(body.points).toHaveLength(2);
    expect(body.points[0]?.totalDeliveredPrice?.major).toBe(339);
    expect(body.points[1]?.totalDeliveredPrice?.major).toBe(329);
    expect(body.destinationCountryName).toBe('Finland');
  });

  it('reports the absence of a destination series instead of substituting the product’s', async () => {
    const response = await request(app)
      .get(`/api/products/${frProductId}/history?country=FI&currency=EUR`)
      .expect(200);
    const body = deliveredHistoryResponseSchema.parse(response.body);

    expect(body.hasDestinationOffer).toBe(false);
    expect(body.points).toEqual([]);
    expect(body.storeOfferId).toBeNull();
  });

  it('keeps the legacy list-price series when no country is given', async () => {
    const response = await request(app)
      .get(`/api/products/${fiProductId}/history?days=90`)
      .expect(200);
    const body = priceHistoryResponseSchema.parse(response.body);

    expect(body.points).toHaveLength(3);
    expect(body).not.toHaveProperty('hasDestinationOffer');
  });

  it('records amounts in the store’s own currency, with no read-time reconversion', async () => {
    const response = await request(app)
      .get(`/api/products/${dkProductId}/history?country=FI&currency=EUR`)
      .expect(200);
    const body = deliveredHistoryResponseSchema.parse(response.body);

    expect(body.storeOfferId).toBe(dkOfferId);
    expect(body.currency).toBe('DKK');
  });
});
