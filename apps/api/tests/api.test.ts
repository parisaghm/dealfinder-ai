import {
  dealsResponseSchema,
  priceHistoryResponseSchema,
  productDetailsSchema,
  watchlistItemSchema,
  watchlistResponseSchema,
} from '@deal-finder/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import {
  createTestContext,
  createTestProduct,
  prisma,
  trackProduct,
  type TestContext,
} from './helpers/fixtures';

/**
 * API integration tests.
 *
 * The real Express app is mounted with supertest — same middleware, same Zod
 * validation, same error handler, same database. Responses are additionally
 * parsed with the shared schemas, so these tests assert the *published
 * contract*, not merely that a 200 came back.
 */

const app = createApp(prisma);

let context: TestContext;
/** Products created for this suite, used for deterministic assertions. */
let cheapId: string;
let expensiveId: string;
let discountedId: string;

/** Every request identifies the test user through the dev-auth header. */
const asUser = (agent: request.Test) => agent.set('x-user-email', context.userEmail);

beforeAll(async () => {
  context = await createTestContext();

  cheapId = await createTestProduct(context, {
    name: 'Zeta Test Cheap Headphones',
    brand: 'Zetaphone',
    category: 'headphones',
    currentPrice: 50,
    originalPrice: 100,
    discountPercent: 50,
    history: [100, 90, 70, 50],
  });

  expensiveId = await createTestProduct(context, {
    name: 'Zeta Test Expensive Laptop',
    brand: 'Zetaphone',
    category: 'laptops',
    currentPrice: 2000,
    shippingPrice: 0,
    history: [2000, 2000],
  });

  discountedId = await createTestProduct(context, {
    name: 'Zeta Test Discounted Monitor',
    brand: 'Zetaphone',
    category: 'monitors',
    currentPrice: 300,
    originalPrice: 500,
    discountPercent: 40,
    history: [500, 450, 300],
  });
});

afterAll(async () => {
  await context.cleanup();
});

describe('GET /api/health', () => {
  it('reports the database as up', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.checks.database.status).toBe('up');
  });
});

describe('GET /api/meta', () => {
  it('returns stores and the vertical taxonomy', async () => {
    const response = await request(app).get('/api/meta').expect(200);
    expect(Array.isArray(response.body.stores)).toBe(true);
    expect(response.body.verticals[0].id).toBe('electronics');
    expect(response.body.verticals[0].categories.length).toBeGreaterThan(5);
  });
});

describe('GET /api/deals', () => {
  it('returns a response matching the published schema', async () => {
    const response = await request(app).get('/api/deals?limit=5').expect(200);
    expect(() => dealsResponseSchema.parse(response.body)).not.toThrow();
  });

  it('filters by free-text query across name and brand', async () => {
    const response = await request(app).get('/api/deals?query=Zetaphone&limit=60').expect(200);
    const ids = response.body.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(cheapId);
    expect(ids).toContain(expensiveId);
  });

  it('requires every search term to match', async () => {
    const response = await request(app)
      .get('/api/deals?query=Zetaphone%20Monitor&limit=60')
      .expect(200);
    const ids = response.body.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(discountedId);
    expect(ids).not.toContain(cheapId);
  });

  it('filters by maximum price', async () => {
    const response = await request(app)
      .get('/api/deals?query=Zetaphone&maximumPrice=100&limit=60')
      .expect(200);
    const ids = response.body.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(cheapId);
    expect(ids).not.toContain(expensiveId);
  });

  it('filters by minimum discount', async () => {
    const response = await request(app)
      .get('/api/deals?query=Zetaphone&minimumDiscount=45&limit=60')
      .expect(200);
    const ids = response.body.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(cheapId);
    expect(ids).not.toContain(discountedId);
  });

  it('filters by category', async () => {
    const response = await request(app)
      .get('/api/deals?query=Zetaphone&category=laptops&limit=60')
      .expect(200);
    const ids = response.body.items.map((item: { id: string }) => item.id);
    expect(ids).toEqual([expensiveId]);
  });

  it('filters by store slug', async () => {
    const response = await request(app)
      .get(`/api/deals?stores=${context.storeSlug}&limit=60`)
      .expect(200);
    expect(response.body.items.length).toBe(3);
    for (const item of response.body.items) {
      expect(item.store.slug).toBe(context.storeSlug);
    }
  });

  it.each([
    { sort: 'lowest-price', expectFirst: () => cheapId },
    { sort: 'highest-price', expectFirst: () => expensiveId },
    { sort: 'best-discount', expectFirst: () => cheapId },
  ])('sorts by $sort', async ({ sort, expectFirst }) => {
    const response = await request(app)
      .get(`/api/deals?stores=${context.storeSlug}&sort=${sort}&limit=60`)
      .expect(200);
    expect(response.body.items[0].id).toBe(expectFirst());
  });

  it('paginates, and pages do not overlap', async () => {
    const first = await request(app)
      .get(`/api/deals?stores=${context.storeSlug}&sort=lowest-price&limit=2&page=1`)
      .expect(200);
    const second = await request(app)
      .get(`/api/deals?stores=${context.storeSlug}&sort=lowest-price&limit=2&page=2`)
      .expect(200);

    expect(first.body.items).toHaveLength(2);
    expect(first.body.pagination).toMatchObject({ page: 1, limit: 2, total: 3, hasMore: true });
    expect(second.body.items).toHaveLength(1);
    expect(second.body.pagination.hasMore).toBe(false);

    const firstIds = first.body.items.map((item: { id: string }) => item.id);
    const secondIds = second.body.items.map((item: { id: string }) => item.id);
    expect(firstIds.filter((id: string) => secondIds.includes(id))).toEqual([]);
  });

  it('interprets a natural-language query and reports how', async () => {
    const response = await request(app)
      .get('/api/deals?query=headphones%20under%20%E2%82%AC80')
      .expect(200);

    expect(response.body.appliedFilters.category).toBe('headphones');
    expect(response.body.appliedFilters.maximumPrice).toBe(80);
    expect(response.body.appliedFilters.interpretation.length).toBeGreaterThan(0);
  });

  it('attaches a deal-quality assessment to every result', async () => {
    const response = await request(app)
      .get(`/api/deals?stores=${context.storeSlug}&limit=60`)
      .expect(200);

    for (const item of response.body.items) {
      expect(item.dealQuality.score).toBeGreaterThanOrEqual(0);
      expect(item.dealQuality.factors.length).toBe(6);
      expect(item.dealQuality.disclaimer).toMatch(/not financial advice/i);
    }
  });

  it.each([
    '/api/deals?limit=999',
    '/api/deals?page=0',
    '/api/deals?sort=nonsense',
    '/api/deals?minimumDiscount=200',
    '/api/deals?maximumPrice=-5',
  ])('rejects %s with 400 and issue details', async (url) => {
    const response = await request(app).get(url).expect(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
    expect(response.body.error.details.issues.length).toBeGreaterThan(0);
  });
});

describe('GET /api/products/:id', () => {
  it('returns details matching the schema, with history and statistics', async () => {
    const response = await request(app).get(`/api/products/${cheapId}`).expect(200);
    expect(() => productDetailsSchema.parse(response.body)).not.toThrow();

    expect(response.body.priceHistory).toHaveLength(4);
    expect(response.body.priceStatistics).toMatchObject({
      lowest: 50,
      highest: 100,
      sampleSize: 4,
    });
    expect(response.body.trend.direction).toBe('FALLING');
  });

  it('404s for an unknown id', async () => {
    const response = await request(app).get('/api/products/does-not-exist').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('returns price history for a window', async () => {
    const response = await request(app)
      .get(`/api/products/${cheapId}/history?days=365`)
      .expect(200);
    expect(() => priceHistoryResponseSchema.parse(response.body)).not.toThrow();
    expect(response.body.points).toHaveLength(4);
  });

  it('rejects an out-of-range history window', async () => {
    await request(app).get(`/api/products/${cheapId}/history?days=99999`).expect(400);
  });
});

describe('/api/watchlist', () => {
  it('requires a resolvable user', async () => {
    const response = await request(app)
      .get('/api/watchlist')
      .set('x-user-email', 'nobody-at-all@absent.test')
      .expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('supports the full add → read → update → remove lifecycle', async () => {
    // Add
    const created = await asUser(request(app).post('/api/watchlist'))
      .send({ productId: discountedId, targetPrice: 250 })
      .expect(201);
    expect(() => watchlistItemSchema.parse(created.body)).not.toThrow();
    expect(created.body.alertStatus).toBe('WAITING');
    expect(created.body.targetComparison).toMatchObject({ difference: 50, reached: false });

    const itemId = created.body.id as string;

    // Read
    const list = await asUser(request(app).get('/api/watchlist')).expect(200);
    expect(() => watchlistResponseSchema.parse(list.body)).not.toThrow();
    expect(list.body.items.some((item: { id: string }) => item.id === itemId)).toBe(true);

    // Update the target so it is met
    const updated = await asUser(request(app).patch(`/api/watchlist/${itemId}`))
      .send({ targetPrice: 400 })
      .expect(200);
    expect(updated.body.targetPrice).toBe(400);
    expect(updated.body.alertStatus).toBe('TARGET_REACHED');

    // Pause
    const paused = await asUser(request(app).patch(`/api/watchlist/${itemId}`))
      .send({ alertsEnabled: false })
      .expect(200);
    expect(paused.body.alertStatus).toBe('PAUSED');

    // Remove
    await asUser(request(app).delete(`/api/watchlist/${itemId}`)).expect(204);
    await asUser(request(app).delete(`/api/watchlist/${itemId}`)).expect(404);
  });

  it('rejects tracking the same product twice', async () => {
    const first = await asUser(request(app).post('/api/watchlist'))
      .send({ productId: cheapId })
      .expect(201);

    const conflict = await asUser(request(app).post('/api/watchlist'))
      .send({ productId: cheapId })
      .expect(409);
    expect(conflict.body.error.code).toBe('CONFLICT');

    await asUser(request(app).delete(`/api/watchlist/${first.body.id}`)).expect(204);
  });

  it('404s when adding an unknown product', async () => {
    await asUser(request(app).post('/api/watchlist'))
      .send({ productId: 'nope' })
      .expect(404);
  });

  it.each([
    { body: {}, reason: 'missing productId' },
    { body: { productId: cheapId, targetPrice: -5 }, reason: 'negative target' },
    { body: { productId: cheapId, targetPrice: 0 }, reason: 'zero target' },
  ])('rejects an invalid create body ($reason)', async ({ body }) => {
    await asUser(request(app).post('/api/watchlist')).send(body).expect(400);
  });

  it('rejects an empty PATCH body', async () => {
    const created = await asUser(request(app).post('/api/watchlist'))
      .send({ productId: expensiveId })
      .expect(201);

    await asUser(request(app).patch(`/api/watchlist/${created.body.id}`)).send({}).expect(400);
    await asUser(request(app).delete(`/api/watchlist/${created.body.id}`)).expect(204);
  });

  // Scoping is enforced in the WHERE clause, so another user's id must look
  // like it does not exist rather than being readable or editable.
  it("cannot touch another user's watchlist item", async () => {
    const other = await createTestContext();
    try {
      const otherProduct = await createTestProduct(other, { currentPrice: 100 });
      const otherItemId = await trackProduct(other, otherProduct, { targetPrice: 50 });

      await asUser(request(app).patch(`/api/watchlist/${otherItemId}`))
        .send({ targetPrice: 10 })
        .expect(404);
      await asUser(request(app).delete(`/api/watchlist/${otherItemId}`)).expect(404);

      // Still intact for its owner.
      const stillThere = await prisma.watchlistItem.findUnique({ where: { id: otherItemId } });
      expect(Number(stillThere?.targetPrice)).toBe(50);
    } finally {
      await other.cleanup();
    }
  });

  it('marks tracked products in the deals list', async () => {
    const created = await asUser(request(app).post('/api/watchlist'))
      .send({ productId: cheapId })
      .expect(201);

    const deals = await asUser(
      request(app).get(`/api/deals?stores=${context.storeSlug}&limit=60`),
    ).expect(200);

    const tracked = deals.body.items.find((item: { id: string }) => item.id === cheapId);
    expect(tracked.isTracked).toBe(true);

    await asUser(request(app).delete(`/api/watchlist/${created.body.id}`)).expect(204);
  });
});

describe('/api/saved-searches', () => {
  it('supports create, list, update and delete', async () => {
    const created = await asUser(request(app).post('/api/saved-searches'))
      .send({ name: 'Test search', query: 'zetaphone', maximumPrice: 500 })
      .expect(201);
    expect(created.body.name).toBe('Test search');

    const list = await asUser(request(app).get('/api/saved-searches')).expect(200);
    expect(list.body.items.some((item: { id: string }) => item.id === created.body.id)).toBe(true);

    const updated = await asUser(request(app).patch(`/api/saved-searches/${created.body.id}`))
      .send({ minimumDiscount: 25 })
      .expect(200);
    expect(updated.body.minimumDiscount).toBe(25);
    // A PATCH must not blank fields it did not mention.
    expect(updated.body.name).toBe('Test search');

    await asUser(request(app).delete(`/api/saved-searches/${created.body.id}`)).expect(204);
    await asUser(request(app).delete(`/api/saved-searches/${created.body.id}`)).expect(404);
  });

  it('rejects a saved search with no criteria at all', async () => {
    await asUser(request(app).post('/api/saved-searches')).send({ name: 'Everything' }).expect(400);
  });
});

describe('GET /api/dashboard', () => {
  it('summarises the user, and counts tracked products', async () => {
    const created = await asUser(request(app).post('/api/watchlist'))
      .send({ productId: cheapId, targetPrice: 40 })
      .expect(201);

    const response = await asUser(request(app).get('/api/dashboard')).expect(200);

    expect(response.body.summary.trackedProducts).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.activeAlerts).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.currency).toBe('EUR');
    expect(Array.isArray(response.body.bestDeals)).toBe(true);

    await asUser(request(app).delete(`/api/watchlist/${created.body.id}`)).expect(204);
  });
});

describe('/api/settings', () => {
  it('reads and updates settings', async () => {
    const initial = await asUser(request(app).get('/api/settings')).expect(200);
    expect(initial.body.email).toBe(context.userEmail);

    const updated = await asUser(request(app).patch('/api/settings'))
      .send({ checkFrequency: 'DAILY', notifyOnPriceDrop: true, preferredCategories: ['laptops'] })
      .expect(200);

    expect(updated.body.checkFrequency).toBe('DAILY');
    expect(updated.body.notifyOnPriceDrop).toBe(true);
    expect(updated.body.preferredCategories).toEqual(['laptops']);
  });

  it('rejects an invalid check frequency and a malformed email', async () => {
    await asUser(request(app).patch('/api/settings')).send({ checkFrequency: 'HOURLY-ISH' }).expect(400);
    await asUser(request(app).patch('/api/settings')).send({ email: 'not-an-email' }).expect(400);
  });

  it('refuses to clear data without the confirmation string', async () => {
    await asUser(request(app).post('/api/settings/clear-data')).send({ scope: 'all' }).expect(400);
    await asUser(request(app).post('/api/settings/clear-data'))
      .send({ scope: 'all', confirm: 'yes' })
      .expect(400);
  });

  it('clears only the requested scope, and only for this user', async () => {
    await asUser(request(app).post('/api/saved-searches')).send({ query: 'to-be-deleted' }).expect(201);
    const created = await asUser(request(app).post('/api/watchlist'))
      .send({ productId: cheapId })
      .expect(201);
    expect(created.body.id).toBeTruthy();

    const cleared = await asUser(request(app).post('/api/settings/clear-data'))
      .send({ scope: 'saved-searches', confirm: 'DELETE' })
      .expect(200);

    expect(cleared.body.deleted.savedSearches).toBeGreaterThanOrEqual(1);
    expect(cleared.body.deleted.watchlistItems).toBe(0);

    // The watchlist item survived, because only saved searches were cleared.
    const list = await asUser(request(app).get('/api/watchlist')).expect(200);
    expect(list.body.items.length).toBeGreaterThanOrEqual(1);

    await asUser(request(app).post('/api/settings/clear-data'))
      .send({ scope: 'all', confirm: 'DELETE' })
      .expect(200);
  });
});

describe('POST /api/alerts/test', () => {
  it('sends a test alert and records it', async () => {
    const response = await asUser(request(app).post('/api/alerts/test'))
      .send({ productId: cheapId })
      .expect(200);

    expect(response.body.delivered).toBe(true);
    expect(response.body.recipient).toBe(context.userEmail);
    expect(response.body.notification.type).toBe('TEST');
  });
});

describe('error handling', () => {
  it('404s an unmatched route with the standard envelope', async () => {
    const response = await request(app).get('/api/not-a-real-route').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toBeTruthy();
  });

  it('rejects malformed JSON with a 400 rather than a 500', async () => {
    const response = await request(app)
      .post('/api/watchlist')
      .set('x-user-email', context.userEmail)
      .set('Content-Type', 'application/json')
      .send('{"productId": ')
      .expect(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
  });

  it('returns a request id on every response', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('sets security headers', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBeTruthy();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
