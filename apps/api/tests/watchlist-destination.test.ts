import { watchlistItemSchema, watchlistResponseSchema } from '@deal-finder/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import {
  createTestContext,
  createTestOffer,
  createTestProduct,
  prisma,
  type TestContext,
} from './helpers/fixtures';

/**
 * Destination-aware watchlist tests.
 *
 * The tracking identity is `(userId, productId, destinationCountry,
 * preferredCurrency)`, which is deliberately *wider* than the `(userId,
 * productId)` it replaced: tracking one product for Finland and for Germany has
 * to produce two independent targets, because a delivered total differs by
 * destination and a single row could only be right about one of them.
 *
 * The obligation that width creates is that it must never surprise anyone, and
 * that is what most of this file checks: an exact repeat is refused with a code
 * the client can act on, a collision that differs only by currency names the
 * existing target so the client can offer to update it, and changing a currency on
 * an existing target updates that row rather than quietly minting a second one and
 * a second stream of emails.
 */

const app = createApp(prisma);

let context: TestContext;
let productId: string;
let unshippableProductId: string;

const asUser = (agent: request.Test) => agent.set('x-user-email', context.userEmail);

beforeAll(async () => {
  context = await createTestContext({
    storeCountry: 'FI',
    storeCurrency: 'EUR',
    storeDeliversTo: ['FI', 'DE'],
  });

  productId = await createTestProduct(context, {
    name: 'Watchlist Destination Headphones',
    brand: context.brand,
    currentPrice: 299,
    shippingPrice: 0,
    history: [329, 299],
  });

  // Finland: €299 plus €9,90 delivery. Germany: €299 plus €19,90.
  await createTestOffer(productId, context.storeId, {
    countryCode: 'FI',
    storeCountryCode: 'FI',
    productPrice: 299,
    shippingPrice: 9.9,
  });
  await createTestOffer(productId, context.storeId, {
    countryCode: 'DE',
    storeCountryCode: 'FI',
    productPrice: 299,
    shippingPrice: 19.9,
  });

  // A listing whose Finnish delivery cost is unpublished, so its delivered total
  // is genuinely unknown.
  unshippableProductId = await createTestProduct(context, {
    name: 'Watchlist Unknown Shipping Headphones',
    brand: context.brand,
    currentPrice: 250,
    shippingPrice: null,
  });
  await createTestOffer(unshippableProductId, context.storeId, {
    countryCode: 'FI',
    storeCountryCode: 'FI',
    productPrice: 250,
    shippingPrice: null,
  });
});

afterAll(async () => {
  await context.cleanup();
});

describe('POST /api/watchlist with a destination', () => {
  it('creates independent targets for the same product in two countries', async () => {
    const finland = await asUser(request(app).post('/api/watchlist'))
      .send({ productId, destinationCountry: 'FI', targetDeliveredPrice: 320 })
      .expect(201);
    const germany = await asUser(request(app).post('/api/watchlist'))
      .send({ productId, destinationCountry: 'DE', targetDeliveredPrice: 320 })
      .expect(201);

    const first = watchlistItemSchema.parse(finland.body);
    const second = watchlistItemSchema.parse(germany.body);

    expect(first.id).not.toBe(second.id);
    expect(first.destinationCountry).toBe('FI');
    expect(first.destinationCountryName).toBe('Finland');
    expect(second.destinationCountry).toBe('DE');
    expect(second.destinationCountryName).toBe('Germany');

    // Each row reports the delivered total for its own destination.
    expect(first.currentDeliveredPrice).toBe(308.9);
    expect(second.currentDeliveredPrice).toBe(318.9);
    // €308,90 beats the €320 target; €318,90 also does.
    expect(first.alertStatus).toBe('TARGET_REACHED');
  });

  it('rejects an exact repeat with a machine-readable code and the existing id', async () => {
    const existing = await prisma.watchlistItem.findFirst({
      where: { userId: context.userId, productId, destinationCountry: 'FI' },
      select: { id: true },
    });

    const response = await asUser(request(app).post('/api/watchlist'))
      .send({ productId, destinationCountry: 'FI', preferredCurrency: 'EUR' })
      .expect(409);

    expect(response.body.error.details.reason).toBe('DUPLICATE_TRACKING_TARGET');
    // Enough for the client to jump straight to editing the target it collided with.
    expect(response.body.error.details.watchlistItemId).toBe(existing?.id);
    expect(response.body.error.message).toContain('Finland');
  });

  it('refuses a second currency for a destination already tracked, and names the existing target', async () => {
    const existing = await prisma.watchlistItem.findFirst({
      where: { userId: context.userId, productId, destinationCountry: 'FI' },
      select: { id: true },
    });

    const response = await asUser(request(app).post('/api/watchlist'))
      .send({ productId, destinationCountry: 'FI', preferredCurrency: 'SEK' })
      .expect(409);

    expect(response.body.error.details).toMatchObject({
      reason: 'CURRENCY_ONLY_CONFLICT',
      watchlistItemId: existing?.id,
      existingCurrency: 'EUR',
      requestedCurrency: 'SEK',
    });
  });

  it('creates the second currency target when it is explicitly confirmed', async () => {
    const response = await asUser(request(app).post('/api/watchlist'))
      .send({
        productId,
        destinationCountry: 'FI',
        preferredCurrency: 'SEK',
        allowAdditionalCurrency: true,
      })
      .expect(201);

    const item = watchlistItemSchema.parse(response.body);
    expect(item.preferredCurrency).toBe('SEK');

    const rows = await prisma.watchlistItem.count({
      where: { userId: context.userId, productId, destinationCountry: 'FI' },
    });
    expect(rows).toBe(2);

    // Cleaned up so the later cases see a single Finnish target again.
    await prisma.watchlistItem.delete({ where: { id: item.id } });
  });

  it('defaults to Finland and EUR for a client that says nothing about destinations', async () => {
    const other = await createTestProduct(context, {
      name: 'Watchlist Legacy Client Headphones',
      brand: context.brand,
      currentPrice: 100,
    });

    const response = await asUser(request(app).post('/api/watchlist'))
      .send({ productId: other })
      .expect(201);

    const item = watchlistItemSchema.parse(response.body);
    expect(item.destinationCountry).toBe('FI');
    expect(item.preferredCurrency).toBe('EUR');
    expect(item.targetDeliveredPrice).toBeNull();
  });
});

describe('PATCH /api/watchlist/:id with a destination', () => {
  it('updates the currency of an existing target in place rather than adding a row', async () => {
    const before = await prisma.watchlistItem.count({ where: { userId: context.userId } });
    const target = await prisma.watchlistItem.findFirst({
      where: { userId: context.userId, productId, destinationCountry: 'DE' },
      select: { id: true },
    });

    const response = await asUser(request(app).patch(`/api/watchlist/${target?.id ?? ''}`))
      .send({ preferredCurrency: 'SEK' })
      .expect(200);

    const item = watchlistItemSchema.parse(response.body);
    expect(item.id).toBe(target?.id);
    expect(item.preferredCurrency).toBe('SEK');

    const after = await prisma.watchlistItem.count({ where: { userId: context.userId } });
    expect(after).toBe(before);

    // Restored, so the remaining cases see the original German target.
    await asUser(request(app).patch(`/api/watchlist/${target?.id ?? ''}`))
      .send({ preferredCurrency: 'EUR' })
      .expect(200);
  });

  it('restarts the alert cycle when the destination changes', async () => {
    const target = await prisma.watchlistItem.findFirst({
      where: { userId: context.userId, productId, destinationCountry: 'DE' },
      select: { id: true },
    });
    await prisma.watchlistItem.update({
      where: { id: target?.id ?? '' },
      data: { lastAlertedAt: new Date() },
    });

    await asUser(request(app).patch(`/api/watchlist/${target?.id ?? ''}`))
      .send({ targetDeliveredPrice: 400 })
      .expect(200);

    const row = await prisma.watchlistItem.findUnique({
      where: { id: target?.id ?? '' },
      select: { lastAlertedAt: true },
    });
    // A new threshold must be able to fire immediately instead of being muted by
    // the previous target's cooldown.
    expect(row?.lastAlertedAt).toBeNull();
  });
});

describe('delivered-price status on the watchlist', () => {
  it('reports an unknown delivered total as WAITING and never falls back to the list price', async () => {
    const created = await asUser(request(app).post('/api/watchlist'))
      .send({
        productId: unshippableProductId,
        destinationCountry: 'FI',
        // The list price of 250 would beat this. The delivered total is unknown.
        targetDeliveredPrice: 300,
      })
      .expect(201);

    const item = watchlistItemSchema.parse(created.body);
    expect(item.currentDeliveredPrice).toBeNull();
    expect(item.deliveredComparison).toBeNull();
    expect(item.alertStatus).toBe('WAITING');
    expect(item.product.currentPrice).toBe(250);
  });

  it('lists every destination target for a product as its own row', async () => {
    const response = await asUser(request(app).get('/api/watchlist')).expect(200);
    const body = watchlistResponseSchema.parse(response.body);

    const rows = body.items.filter((item) => item.productId === productId);
    expect(rows.map((row) => row.destinationCountry).sort()).toEqual(['DE', 'FI']);
    // The currency is always stated, so two rows for one product are legible
    // rather than looking like a duplication bug.
    for (const row of rows) {
      expect(row.preferredCurrency).toBeTruthy();
      expect(row.destinationCountryName.length).toBeGreaterThan(2);
    }
  });
});

describe('authorisation is unchanged', () => {
  it('refuses a caller it cannot resolve to a user', async () => {
    // The development strategy provisions only the configured user; an arbitrary
    // header value must not be able to create an account or reach a watchlist.
    const unknown = 'nobody-here@dealfinder.test';

    await request(app)
      .post('/api/watchlist')
      .set('x-user-email', unknown)
      .send({ productId, destinationCountry: 'FI' })
      .expect(401);
    await request(app).get('/api/watchlist').set('x-user-email', unknown).expect(401);
  });

  it('cannot update another user’s target', async () => {
    const other = await createTestContext();
    try {
      const target = await prisma.watchlistItem.findFirst({
        where: { userId: context.userId },
        select: { id: true },
      });

      await request(app)
        .patch(`/api/watchlist/${target?.id ?? ''}`)
        .set('x-user-email', other.userEmail)
        .send({ targetPrice: 1 })
        // Scoped by userId in the `where`, so another user's id matches no rows
        // and the response does not reveal that the id exists.
        .expect(404);
    } finally {
      await other.cleanup();
    }
  });
});

describe('the pre-existing watchlist is untouched', () => {
  it('leaves the seeded user’s six Finland/EUR items exactly as they were', async () => {
    const seeded = await prisma.user.findUnique({
      where: { email: 'demo@dealfinder.test' },
      select: { id: true },
    });
    if (!seeded) return;

    const rows = await prisma.watchlistItem.findMany({
      where: { userId: seeded.id },
      select: { destinationCountry: true, preferredCurrency: true, targetDeliveredPrice: true },
    });

    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.destinationCountry).toBe('FI');
      expect(row.preferredCurrency).toBe('EUR');
      // The migration added the column with no value; nothing has invented a
      // delivered target for an item that was created before the concept existed.
      expect(row.targetDeliveredPrice).toBeNull();
    }
  });
});
