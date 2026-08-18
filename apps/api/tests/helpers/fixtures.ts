import {
  getPrismaClient,
  recordStoreOfferSeries,
  upsertStoreOfferFromSource,
  type PrismaClient,
} from '@deal-finder/db';
import { randomUUID } from 'node:crypto';

/**
 * Test fixtures.
 *
 * These tests run against the real PostgreSQL database, because the behaviour
 * under test *is* the interaction with it — transactions, the unique constraint
 * on (userId, productId), scoped `updateMany` calls, and SQL-level sorting. A
 * mocked Prisma client would verify that the mock was called, not that the
 * feature works.
 *
 * To stay safe alongside development data, every fixture is namespaced with a
 * UUID and removed afterwards. Nothing truncates shared tables, so `db:seed`
 * data survives a test run.
 */

export const prisma: PrismaClient = getPrismaClient();

export interface TestContext {
  userId: string;
  userEmail: string;
  storeId: string;
  storeSlug: string;
  /**
   * A brand nobody else uses, so canonical products created by matching can be
   * found and removed. Canonical products are deliberately *not* store-scoped —
   * that is the whole point of them — so unlike every other fixture they cannot
   * be cleaned up by deleting the store.
   */
  brand: string;
  /** A second store, for the cross-store cases that need one. */
  secondStoreId: string;
  secondStoreSlug: string;
  /** Cleans up everything this context created. */
  cleanup: () => Promise<void>;
}

/**
 * Destination metadata for the two fixture stores.
 *
 * Every field is optional and every default reproduces the pre-expansion
 * fixture exactly: no country, no declared delivery network, not a demo store.
 * A store with no `countryCode` cannot be placed in any region, so it is invisible
 * to destination-aware search — which is precisely why the existing suites, which
 * pass no options, are unaffected by any of this.
 */
export interface CreateTestContextOptions {
  storeCountry?: string;
  storeCurrency?: string;
  storeDeliversTo?: readonly string[];
  secondStoreCountry?: string;
  secondStoreCurrency?: string;
  secondStoreDeliversTo?: readonly string[];
  secondStoreIsDemo?: boolean;
}

export async function createTestContext(
  options: CreateTestContextOptions = {},
): Promise<TestContext> {
  const id = randomUUID().slice(0, 8);
  const userEmail = `test-${id}@dealfinder.test`;
  const storeSlug = `test-store-${id}`;
  const secondStoreSlug = `test-store-b-${id}`;
  const brand = `TestBrand${id}`;

  const user = await prisma.user.create({
    data: { email: userEmail, name: 'Test User', settings: { create: {} } },
    select: { id: true },
  });

  const store = await prisma.store.create({
    data: {
      slug: storeSlug,
      name: `Test Store ${id}`,
      websiteUrl: `https://${storeSlug}.test`,
      isActive: true,
      countryCode: options.storeCountry ?? null,
      supportedCurrencies: options.storeCurrency ? [options.storeCurrency] : [],
      // Declared reach. Deliberately settable independently of the offers a test
      // creates, because "declares FI but has no FI offer" is a case that has to
      // be constructible.
      supportedDeliveryCountries: [...(options.storeDeliversTo ?? [])],
    },
    select: { id: true },
  });

  const secondStore = await prisma.store.create({
    data: {
      slug: secondStoreSlug,
      name: `Test Store B ${id}`,
      websiteUrl: `https://${secondStoreSlug}.test`,
      isActive: true,
      countryCode: options.secondStoreCountry ?? null,
      supportedCurrencies: options.secondStoreCurrency ? [options.secondStoreCurrency] : [],
      supportedDeliveryCountries: [...(options.secondStoreDeliversTo ?? [])],
      isDemoStore: options.secondStoreIsDemo ?? false,
    },
    select: { id: true },
  });

  return {
    userId: user.id,
    userEmail,
    storeId: store.id,
    storeSlug,
    brand,
    secondStoreId: secondStore.id,
    secondStoreSlug,
    async cleanup() {
      // Order matters. Products cascade to price history, watchlist items,
      // notifications *and* match candidates; canonical products must go last,
      // because a product still pointing at one would block the delete.
      await prisma.product.deleteMany({
        where: { storeId: { in: [store.id, secondStore.id] } },
      });
      await prisma.canonicalProduct.deleteMany({ where: { brandKey: brand.toLowerCase() } });
      await prisma.store.deleteMany({ where: { id: { in: [store.id, secondStore.id] } } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    },
  };
}

export interface CreateProductOptions {
  externalId?: string;
  name?: string;
  brand?: string;
  category?: string;
  currentPrice?: number;
  originalPrice?: number | null;
  shippingPrice?: number | null;
  discountPercent?: number;
  availability?: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'PREORDER' | 'DISCONTINUED' | 'UNKNOWN';
  lastCheckedAt?: Date;
  /** Price observations, oldest first, one day apart ending now. */
  history?: number[];
  /** Put the product in the context's *second* store, for cross-store cases. */
  inSecondStore?: boolean;
  /** Identifiers as a store would publish them. */
  gtin?: string | null;
  ean?: string | null;
  mpn?: string | null;
  modelNumber?: string | null;
  attributes?: Record<string, unknown> | null;
  /** The currency the store quotes in. Defaults to EUR, as it always did. */
  currency?: string;
}

export async function createTestProduct(
  context: TestContext,
  options: CreateProductOptions = {},
): Promise<string> {
  const externalId = options.externalId ?? `p-${randomUUID().slice(0, 8)}`;
  const currentPrice = options.currentPrice ?? 100;
  const storeId = options.inSecondStore ? context.secondStoreId : context.storeId;
  const storeSlug = options.inSecondStore ? context.secondStoreSlug : context.storeSlug;

  const product = await prisma.product.create({
    data: {
      externalId,
      name: options.name ?? `Test product ${externalId}`,
      brand: options.brand ?? 'TestBrand',
      category: options.category ?? 'headphones',
      vertical: 'electronics',
      productUrl: `https://${storeSlug}.test/p/${externalId}`,
      storeId,
      currentPrice,
      originalPrice: options.originalPrice ?? null,
      shippingPrice: options.shippingPrice ?? null,
      currency: options.currency ?? 'EUR',
      discountPercent: options.discountPercent ?? 0,
      availability: options.availability ?? 'IN_STOCK',
      lastCheckedAt: options.lastCheckedAt ?? new Date(),
      gtin: options.gtin ?? null,
      ean: options.ean ?? null,
      mpn: options.mpn ?? null,
      modelNumber: options.modelNumber ?? null,
      attributes: (options.attributes ?? null) as never,
    },
    select: { id: true },
  });

  if (options.history && options.history.length > 0) {
    const now = Date.now();
    const count = options.history.length;
    await prisma.priceHistory.createMany({
      data: options.history.map((price, index) => ({
        productId: product.id,
        price,
        currency: options.currency ?? 'EUR',
        recordedAt: new Date(now - (count - 1 - index) * 86_400_000),
      })),
    });
  }

  return product.id;
}

export async function trackProduct(
  context: TestContext,
  productId: string,
  options: {
    targetPrice?: number | null;
    alertsEnabled?: boolean;
    lastAlertedAt?: Date | null;
    /**
     * Destination tracking. Omitted, the row takes the column defaults `FI`/`EUR`
     * with no delivered target — which is exactly what every pre-existing
     * watchlist item means, so the existing suites see no change.
     */
    destinationCountry?: string;
    preferredCurrency?: string;
    targetDeliveredPrice?: number | null;
  } = {},
): Promise<string> {
  const item = await prisma.watchlistItem.create({
    data: {
      userId: context.userId,
      productId,
      targetPrice: options.targetPrice ?? null,
      alertsEnabled: options.alertsEnabled ?? true,
      lastAlertedAt: options.lastAlertedAt ?? null,
      ...(options.destinationCountry ? { destinationCountry: options.destinationCountry } : {}),
      ...(options.preferredCurrency ? { preferredCurrency: options.preferredCurrency } : {}),
      targetDeliveredPrice: options.targetDeliveredPrice ?? null,
    },
    select: { id: true },
  });
  return item.id;
}

export interface CreateTestOfferOptions {
  /** Where the parcel goes. Defaults to Finland. */
  countryCode?: string;
  /** Where the store trades from. Drives the tax and duty determination. */
  storeCountryCode?: string;
  currency?: string;
  productPrice?: number;
  originalPrice?: number | null;
  /** Null means the store publishes no delivery cost — never treated as zero. */
  shippingPrice?: number | null;
  availability?:
    | 'IN_STOCK'
    | 'LOW_STOCK'
    | 'OUT_OF_STOCK'
    | 'PREORDER'
    | 'DISCONTINUED'
    | 'UNKNOWN';
  deliveryMinDays?: number | null;
  deliveryMaxDays?: number | null;
  /** Recorded observations, oldest first, one day apart ending now. */
  history?: number[];
  /**
   * Offer-data provenance. Defaults to `'mock'`, which is what every fixture is,
   * so an existing test keeps the behaviour it had. A test about the external-link
   * gate opts into a verified source explicitly.
   */
  dataSourceType?: string;
}

/**
 * A destination-specific offer, written through the real single writer.
 *
 * `upsertStoreOfferFromSource` rather than a bare `create`, so a fixture cannot
 * accidentally construct a state the application can never produce — a delivered
 * total with no shipping cost, say, which is the exact invariant several of these
 * tests exist to check.
 */
export async function createTestOffer(
  productId: string,
  storeId: string,
  options: CreateTestOfferOptions = {},
): Promise<string> {
  const currency = options.currency ?? 'EUR';
  const countryCode = options.countryCode ?? 'FI';

  const result = await upsertStoreOfferFromSource(
    prisma,
    {
      productId,
      storeId,
      countryCode,
      storeCountryCode: options.storeCountryCode ?? countryCode,
      currency,
      productPrice: options.productPrice ?? 100,
      originalPrice: options.originalPrice ?? null,
      shippingPrice: options.shippingPrice,
      availability: options.availability ?? 'IN_STOCK',
      deliveryMinDays: options.deliveryMinDays ?? null,
      deliveryMaxDays: options.deliveryMaxDays ?? null,
      dataSourceType: options.dataSourceType ?? 'mock',
    },
    { skipHistory: true },
  );

  if (options.history && options.history.length > 0) {
    const now = Date.now();
    const count = options.history.length;
    await recordStoreOfferSeries(
      prisma,
      result.offerId,
      options.history.map((productPrice, index) => ({
        productPrice,
        shippingPrice: options.shippingPrice ?? null,
        currency,
        availability: options.availability ?? 'IN_STOCK',
        recordedAt: new Date(now - (count - 1 - index) * 86_400_000),
      })),
    );
  }

  return result.offerId;
}
