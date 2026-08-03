import { resolveCanonicalForProduct } from '@deal-finder/db';
import {
  canonicalHistoryResponseSchema,
  canonicalOffersResponseSchema,
  canonicalProductDetailsSchema,
  canonicalProductsResponseSchema,
  dealsResponseSchema,
  matchCandidatesResponseSchema,
  rematchResponseSchema,
} from '@deal-finder/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTestContext, createTestProduct, prisma, type TestContext } from './helpers/fixtures';

/**
 * Cross-store matching, end to end through the real app and the real database.
 *
 * The engine's rules are unit-tested in `packages/shared`; what this file
 * checks is everything those tests cannot reach — that the rules survive being
 * written to Postgres and read back, that the endpoints publish the contract
 * they claim to, and that the two safety properties hold *in practice*: a
 * low-confidence pair is never persisted, and the cheapest total is not the
 * cheapest listed price.
 */

const app = createApp(prisma);

/**
 * Test-only identifiers with real GS1 check digits.
 *
 * Deliberately not any code used by the seeded catalogue: `canonical_products`
 * enforces one record per GTIN globally, so borrowing a seeded EAN would make
 * these tests fight the development data for ownership of it — and pass or fail
 * depending on whether `db:seed` had been run.
 */
const EAN_A = '9000000000018';
const EAN_B = '9000000000025';

let context: TestContext;
const asUser = (agent: request.Test) => agent.set('x-user-email', context.userEmail);

beforeEach(async () => {
  context = await createTestContext();
});

afterEach(async () => {
  await context.cleanup();
});

/** Match one product and return what the engine decided. */
async function match(productId: string, force = false) {
  return resolveCanonicalForProduct(prisma, productId, { force });
}

describe('canonical product creation', () => {
  it('creates a canonical product for a listing with a valid identifier', async () => {
    const productId = await createTestProduct(context, {
      name: `${context.brand} Alpha Headphones`,
      brand: context.brand,
      ean: EAN_A,
    });

    const outcome = await match(productId);

    expect(outcome.action).toBe('CANONICAL_CREATED');
    expect(outcome.canonicalProductId).not.toBeNull();
  });

  it('leaves a listing unmatched when it knows nothing identifying about itself', async () => {
    const productId = await createTestProduct(context, { name: 'Widget', brand: null as never });
    const outcome = await match(productId);
    expect(outcome.action).toBe('UNMATCHED');
    expect(outcome.canonicalProductId).toBeNull();
  });
});

describe('automatic high-confidence matching', () => {
  it('attaches a second store publishing the same identifier', async () => {
    const first = await createTestProduct(context, {
      name: `${context.brand} Alpha Headphones`,
      brand: context.brand,
      ean: EAN_A,
      currentPrice: 329,
    });
    const second = await createTestProduct(context, {
      inSecondStore: true,
      // A deliberately different title, in a different word order: the whole
      // point of an identifier is that the names need not agree.
      name: `Kuulokkeet ${context.brand} Alpha, Musta`,
      brand: context.brand,
      ean: EAN_A,
      currentPrice: 339,
    });

    await match(first);
    const outcome = await match(second);

    expect(outcome.action).toBe('ATTACHED');
    expect(outcome.best?.method).toBe('IDENTIFIER');
    expect(outcome.best?.autoAttachable).toBe(true);

    const canonical = await prisma.canonicalProduct.findFirstOrThrow({
      where: { brandKey: context.brand.toLowerCase() },
      select: { _count: { select: { offers: true } } },
    });
    expect(canonical._count.offers).toBe(2);
  });
});

describe('medium-confidence candidates', () => {
  it('queues an ambiguous pair for review instead of merging it', async () => {
    const first = await createTestProduct(context, {
      name: `${context.brand} Zeta Q900 65 inch QLED Smart TV`,
      brand: context.brand,
      category: 'televisions',
      modelNumber: 'Q900',
      attributes: { screenInches: 65 },
    });
    const second = await createTestProduct(context, {
      inSecondStore: true,
      name: `${context.brand} ZQ65Q900ATXXC Zeta 65 inch QLED Smart TV`,
      brand: context.brand,
      category: 'televisions',
      modelNumber: 'ZQ65Q900ATXXC',
      attributes: { screenInches: 65 },
    });

    await match(first);
    const outcome = await match(second);

    expect(outcome.action).toBe('CANDIDATES_RECORDED');
    expect(outcome.candidateIds.length).toBeGreaterThan(0);

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: second },
      select: { canonicalProductId: true },
    });
    expect(product.canonicalProductId).toBeNull();
  });

  // "Never silently merge a low-confidence match" is enforced by refusing to
  // write the row at all, which is stronger than writing one and filtering it.
  it('does not even record a candidate when a variant conflicts', async () => {
    const first = await createTestProduct(context, {
      name: `${context.brand} Phone 16 128 GB`,
      brand: context.brand,
      category: 'phones',
      attributes: { storageGb: 128 },
    });
    const second = await createTestProduct(context, {
      inSecondStore: true,
      name: `${context.brand} Phone 16 256 GB`,
      brand: context.brand,
      category: 'phones',
      attributes: { storageGb: 256 },
    });

    await match(first);
    const outcome = await match(second);

    expect(outcome.action).not.toBe('ATTACHED');
    expect(outcome.candidateIds).toHaveLength(0);

    const candidates = await prisma.productMatchCandidate.count({
      where: { sourceProductId: second },
    });
    expect(candidates).toBe(0);
  });
});

describe('candidate approval and rejection', () => {
  async function seedCandidate() {
    const first = await createTestProduct(context, {
      name: `${context.brand} Zeta Q900 65 inch QLED Smart TV`,
      brand: context.brand,
      category: 'televisions',
      modelNumber: 'Q900',
      attributes: { screenInches: 65 },
    });
    const second = await createTestProduct(context, {
      inSecondStore: true,
      name: `${context.brand} ZQ65Q900ATXXC Zeta 65 inch QLED Smart TV`,
      brand: context.brand,
      category: 'televisions',
      modelNumber: 'ZQ65Q900ATXXC',
      attributes: { screenInches: 65 },
    });
    await match(first);
    const outcome = await match(second);
    const candidateId = outcome.candidateIds[0];
    if (!candidateId) throw new Error('expected the ambiguous pair to produce a candidate');
    return { first, second, candidateId };
  }

  it('attaches the listing on approval and records who decided', async () => {
    const { second, candidateId } = await seedCandidate();

    const response = await asUser(
      request(app).post(`/api/match-candidates/${candidateId}/approve`).send({ note: 'Same set.' }),
    ).expect(200);

    expect(response.body.candidate.status).toBe('APPROVED');
    expect(response.body.candidate.reviewedBy).toBe(context.userEmail);

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: second },
      select: { canonicalProductId: true, canonicalMatchMethod: true },
    });
    expect(product.canonicalProductId).toBe(response.body.canonicalProductId);
    // MANUAL is sticky: a later machine pass must not silently undo a person.
    expect(product.canonicalMatchMethod).toBe('MANUAL');
  });

  it('refuses to review the same candidate twice', async () => {
    const { candidateId } = await seedCandidate();
    await asUser(request(app).post(`/api/match-candidates/${candidateId}/approve`).send({})).expect(
      200,
    );
    await asUser(request(app).post(`/api/match-candidates/${candidateId}/approve`).send({})).expect(
      409,
    );
  });

  it('leaves the listing unattached on rejection', async () => {
    const { second, candidateId } = await seedCandidate();

    await asUser(request(app).post(`/api/match-candidates/${candidateId}/reject`).send({})).expect(
      200,
    );

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: second },
      select: { canonicalProductId: true },
    });
    expect(product.canonicalProductId).toBeNull();
  });

  // The rejected row is the memory that stops the same bad pair coming back.
  it('does not resurrect a rejected pair on the next matching run', async () => {
    const { second, candidateId } = await seedCandidate();
    await asUser(request(app).post(`/api/match-candidates/${candidateId}/reject`).send({})).expect(
      200,
    );

    await match(second);

    const pending = await prisma.productMatchCandidate.count({
      where: { sourceProductId: second, status: 'PENDING' },
    });
    expect(pending).toBe(0);
  });

  it('requires a user for every decision', async () => {
    const { candidateId } = await seedCandidate();
    await request(app)
      .post(`/api/match-candidates/${candidateId}/approve`)
      .set('x-user-email', 'nobody@example.test')
      .send({})
      .expect(401);
  });

  it('404s for an unknown candidate', async () => {
    await asUser(
      request(app).post('/api/match-candidates/does-not-exist/approve').send({}),
    ).expect(404);
  });
});

describe('POST /api/products/:id/rematch', () => {
  it('is a no-op for a manual attachment unless forced', async () => {
    const first = await createTestProduct(context, {
      name: `${context.brand} Zeta Q900 65 inch QLED Smart TV`,
      brand: context.brand,
      category: 'televisions',
      modelNumber: 'Q900',
      attributes: { screenInches: 65 },
    });
    const second = await createTestProduct(context, {
      inSecondStore: true,
      name: `${context.brand} ZQ65Q900ATXXC Zeta 65 inch QLED Smart TV`,
      brand: context.brand,
      category: 'televisions',
      modelNumber: 'ZQ65Q900ATXXC',
      attributes: { screenInches: 65 },
    });
    await match(first);
    const outcome = await match(second);
    const candidateId = outcome.candidateIds[0];
    if (!candidateId) throw new Error('expected a candidate');

    await asUser(request(app).post(`/api/match-candidates/${candidateId}/approve`).send({}));

    const plain = await asUser(
      request(app).post(`/api/products/${second}/rematch`).send({}),
    ).expect(200);
    expect(rematchResponseSchema.parse(plain.body).action).toBe('ALREADY_ATTACHED');
  });

  // This is what makes the end-to-end review journey re-runnable without a
  // database reset: force restores the listing to its pre-decision state.
  it('force restores a reviewed listing to a pending candidate', async () => {
    const first = await createTestProduct(context, {
      name: `${context.brand} Zeta Q900 65 inch QLED Smart TV`,
      brand: context.brand,
      category: 'televisions',
      modelNumber: 'Q900',
      attributes: { screenInches: 65 },
    });
    const second = await createTestProduct(context, {
      inSecondStore: true,
      name: `${context.brand} ZQ65Q900ATXXC Zeta 65 inch QLED Smart TV`,
      brand: context.brand,
      category: 'televisions',
      modelNumber: 'ZQ65Q900ATXXC',
      attributes: { screenInches: 65 },
    });
    await match(first);
    const candidateId = (await match(second)).candidateIds[0];
    if (!candidateId) throw new Error('expected a candidate');

    await asUser(request(app).post(`/api/match-candidates/${candidateId}/approve`).send({}));

    const forced = await asUser(
      request(app).post(`/api/products/${second}/rematch`).send({ force: true }),
    ).expect(200);
    expect(rematchResponseSchema.parse(forced.body).action).toBe('CANDIDATES_RECORDED');

    const pending = await prisma.productMatchCandidate.count({
      where: { sourceProductId: second, status: 'PENDING' },
    });
    expect(pending).toBe(1);

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: second },
      select: { canonicalProductId: true },
    });
    expect(product.canonicalProductId).toBeNull();
  });

  it('404s for an unknown product', async () => {
    await asUser(request(app).post('/api/products/does-not-exist/rematch').send({})).expect(404);
  });
});

describe('GET /api/canonical-products', () => {
  it('reports offer counts and prices matching the published contract', async () => {
    const first = await createTestProduct(context, {
      name: `${context.brand} Alpha Headphones`,
      brand: context.brand,
      ean: EAN_A,
      currentPrice: 329,
      history: [400, 380, 329],
    });
    const second = await createTestProduct(context, {
      inSecondStore: true,
      name: `${context.brand} Alpha Headphones Black`,
      brand: context.brand,
      ean: EAN_A,
      currentPrice: 339,
      history: [400, 339],
    });
    await match(first);
    await match(second);

    const response = await request(app)
      .get(`/api/canonical-products?brand=${encodeURIComponent(context.brand)}&minOffers=2`)
      .expect(200);

    const parsed = canonicalProductsResponseSchema.parse(response.body);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.offerCount).toBe(2);
    expect(parsed.items[0]?.storeCount).toBe(2);
    expect(parsed.items[0]?.lowestPrice).toBe(329);
    expect(parsed.items[0]?.highestPrice).toBe(339);
  });
});

describe('GET /api/canonical-products/:id/offers', () => {
  /**
   * The scenario the whole feature exists for: the store with the lowest listed
   * price is not the store that costs least to buy from.
   *
   *   Store A  329 + 0     = 329  ← cheapest total
   *   Store B  319 + 12.90 = 331.90  ← cheapest listed
   */
  async function seedShippingDivergence() {
    const cheapestTotal = await createTestProduct(context, {
      name: `${context.brand} Alpha Headphones`,
      brand: context.brand,
      ean: EAN_A,
      currentPrice: 329,
      shippingPrice: 0,
      history: [400, 329],
    });
    const cheapestListed = await createTestProduct(context, {
      inSecondStore: true,
      name: `${context.brand} Alpha Headphones Black`,
      brand: context.brand,
      ean: EAN_A,
      currentPrice: 319,
      shippingPrice: 12.9,
      history: [400, 319],
    });
    await match(cheapestTotal);
    await match(cheapestListed);

    const canonical = await prisma.canonicalProduct.findFirstOrThrow({
      where: { brandKey: context.brand.toLowerCase() },
      select: { id: true },
    });
    return { canonicalId: canonical.id, cheapestTotal, cheapestListed };
  }

  it('orders by shipping-inclusive total under lowest-total', async () => {
    const { canonicalId, cheapestTotal } = await seedShippingDivergence();

    const response = await request(app)
      .get(`/api/canonical-products/${canonicalId}/offers?sort=lowest-total`)
      .expect(200);

    const parsed = canonicalOffersResponseSchema.parse(response.body);
    expect(parsed.offers[0]?.id).toBe(cheapestTotal);
    expect(parsed.offers[0]?.totalPrice).toBe(329);
    expect(parsed.comparison.cheapestTotalOfferId).toBe(cheapestTotal);
  });

  it('orders by listed price under lowest-price, naming the other store', async () => {
    const { canonicalId, cheapestListed } = await seedShippingDivergence();

    const response = await request(app)
      .get(`/api/canonical-products/${canonicalId}/offers?sort=lowest-price`)
      .expect(200);

    const parsed = canonicalOffersResponseSchema.parse(response.body);
    expect(parsed.offers[0]?.id).toBe(cheapestListed);
    // …and it is still not the one the comparison recommends.
    expect(parsed.comparison.cheapestTotalOfferId).not.toBe(cheapestListed);
  });

  it('is ordered by deal quality under best-deal-quality, and repeatably so', async () => {
    const { canonicalId } = await seedShippingDivergence();

    const first = await request(app)
      .get(`/api/canonical-products/${canonicalId}/offers?sort=best-deal-quality`)
      .expect(200);
    const second = await request(app)
      .get(`/api/canonical-products/${canonicalId}/offers?sort=best-deal-quality`)
      .expect(200);

    const scores = first.body.offers.map((offer: { dealQuality: { score: number } }) => offer.dealQuality.score);
    expect([...scores].sort((a: number, b: number) => b - a)).toEqual(scores);
    expect(second.body.offers.map((offer: { id: string }) => offer.id)).toEqual(
      first.body.offers.map((offer: { id: string }) => offer.id),
    );
  });

  it('never recommends an offer that cannot be bought', async () => {
    const inStock = await createTestProduct(context, {
      name: `${context.brand} Alpha Headphones`,
      brand: context.brand,
      ean: EAN_A,
      currentPrice: 329,
      shippingPrice: 0,
    });
    const soldOut = await createTestProduct(context, {
      inSecondStore: true,
      name: `${context.brand} Alpha Headphones Black`,
      brand: context.brand,
      ean: EAN_A,
      currentPrice: 249,
      shippingPrice: 0,
      availability: 'OUT_OF_STOCK',
    });
    await match(inStock);
    await match(soldOut);

    const canonical = await prisma.canonicalProduct.findFirstOrThrow({
      where: { brandKey: context.brand.toLowerCase() },
      select: { id: true },
    });
    const response = await request(app)
      .get(`/api/canonical-products/${canonical.id}/offers`)
      .expect(200);

    const parsed = canonicalOffersResponseSchema.parse(response.body);
    expect(parsed.comparison.cheapestTotalOfferId).toBe(inStock);
    // Passing over a cheaper offer silently would be the same dishonesty as an
    // unsupported discount badge, so it has to be stated.
    expect(parsed.comparison.cheapestTotalCaveat).toBeTruthy();
  });

  it('404s for an unknown canonical product', async () => {
    await request(app).get('/api/canonical-products/does-not-exist/offers').expect(404);
  });
});

describe('GET /api/canonical-products/:id', () => {
  it('returns the full comparison payload', async () => {
    const first = await createTestProduct(context, {
      name: `${context.brand} Alpha Headphones`,
      brand: context.brand,
      ean: EAN_A,
      currentPrice: 329,
      history: [400, 329],
      attributes: { colour: 'Black', batteryHours: 30 },
    });
    await match(first);

    const canonical = await prisma.canonicalProduct.findFirstOrThrow({
      where: { brandKey: context.brand.toLowerCase() },
      select: { id: true },
    });
    const response = await request(app)
      .get(`/api/canonical-products/${canonical.id}`)
      .expect(200);

    const parsed = canonicalProductDetailsSchema.parse(response.body);
    expect(parsed.offers).toHaveLength(1);
    expect(parsed.specifications).toMatchObject({ Colour: 'Black' });
    // Matcher bookkeeping must never leak into a user-facing specification list.
    expect(Object.keys(parsed.specifications)).not.toContain('__matcherVersion');
    expect(parsed.offers[0]?.match.explanation).toBeTruthy();
  });
});

describe('GET /api/canonical-products/:id/history', () => {
  it('returns one series per store plus a cheapest-anywhere line', async () => {
    const first = await createTestProduct(context, {
      name: `${context.brand} Alpha Headphones`,
      brand: context.brand,
      ean: EAN_A,
      currentPrice: 329,
      history: [400, 380, 329],
    });
    const second = await createTestProduct(context, {
      inSecondStore: true,
      name: `${context.brand} Alpha Headphones Black`,
      brand: context.brand,
      ean: EAN_A,
      currentPrice: 339,
      history: [420, 339],
    });
    await match(first);
    await match(second);

    const canonical = await prisma.canonicalProduct.findFirstOrThrow({
      where: { brandKey: context.brand.toLowerCase() },
      select: { id: true },
    });
    const response = await request(app)
      .get(`/api/canonical-products/${canonical.id}/history?days=30`)
      .expect(200);

    const parsed = canonicalHistoryResponseSchema.parse(response.body);
    expect(parsed.series).toHaveLength(2);
    expect(parsed.series.map((entry) => entry.storeSlug).sort()).toEqual(
      [context.storeSlug, context.secondStoreSlug].sort(),
    );
    expect(parsed.best.points.length).toBeGreaterThan(0);
    expect(parsed.crossStoreLow?.price).toBe(329);
  });
});

describe('GET /api/match-candidates', () => {
  it('lists the queue with status counts', async () => {
    const first = await createTestProduct(context, {
      name: `${context.brand} Zeta Q900 65 inch QLED Smart TV`,
      brand: context.brand,
      category: 'televisions',
      modelNumber: 'Q900',
      attributes: { screenInches: 65 },
    });
    const second = await createTestProduct(context, {
      inSecondStore: true,
      name: `${context.brand} ZQ65Q900ATXXC Zeta 65 inch QLED Smart TV`,
      brand: context.brand,
      category: 'televisions',
      modelNumber: 'ZQ65Q900ATXXC',
      attributes: { screenInches: 65 },
    });
    await match(first);
    await match(second);

    const response = await request(app)
      .get(`/api/match-candidates?status=PENDING&store=${context.secondStoreSlug}`)
      .expect(200);

    const parsed = matchCandidatesResponseSchema.parse(response.body);
    expect(parsed.items).toHaveLength(1);

    const candidate = parsed.items[0];
    expect(candidate?.sourceProduct.storeSlug).toBe(context.secondStoreSlug);
    // The review page has to be able to argue with the decision, so both the
    // supporting reasons and whatever weighed against it must be present.
    expect(candidate?.explanation.reasons.length).toBeGreaterThan(0);
    expect(candidate?.explanation.conflicts.length).toBeGreaterThan(0);
    expect(candidate?.candidateCanonicalProduct.offerCount).toBe(1);
  });
});

describe('GET /api/deals — the additive grouping contract', () => {
  it('omits `groups` entirely unless it is asked for', async () => {
    await createTestProduct(context, { name: `${context.brand} Alpha`, brand: context.brand });

    const response = await request(app)
      .get(`/api/deals?stores=${context.storeSlug}`)
      .expect(200);

    // Still parses as the published contract, and gained no new key.
    expect(dealsResponseSchema.parse(response.body)).toBeTruthy();
    expect(response.body).not.toHaveProperty('groups');
  });

  it('decorates the page with groups without changing which products are on it', async () => {
    const first = await createTestProduct(context, {
      name: `${context.brand} Alpha Headphones`,
      brand: context.brand,
      ean: EAN_A,
      currentPrice: 329,
    });
    const second = await createTestProduct(context, {
      inSecondStore: true,
      name: `${context.brand} Alpha Headphones Black`,
      brand: context.brand,
      ean: EAN_A,
      currentPrice: 339,
    });
    const unrelated = await createTestProduct(context, {
      name: `${context.brand} Beta Speaker`,
      brand: context.brand,
      category: 'speakers',
      ean: EAN_B,
    });
    await match(first);
    await match(second);
    await match(unrelated);

    const stores = `${context.storeSlug},${context.secondStoreSlug}`;
    const ungrouped = await request(app).get(`/api/deals?stores=${stores}`).expect(200);
    const grouped = await request(app)
      .get(`/api/deals?stores=${stores}&group=canonical`)
      .expect(200);

    const parsed = dealsResponseSchema.parse(grouped.body);

    // Identical page, identical pagination — grouping is a decoration.
    expect(grouped.body.items.map((item: { id: string }) => item.id)).toEqual(
      ungrouped.body.items.map((item: { id: string }) => item.id),
    );
    expect(grouped.body.pagination).toEqual(ungrouped.body.pagination);

    const headphoneGroup = parsed.groups?.find((group) => group.productIds.length === 2);
    expect(headphoneGroup).toBeDefined();
    expect(headphoneGroup?.productIds.sort()).toEqual([first, second].sort());
    expect(headphoneGroup?.canonical.storeCount).toBe(2);
  });
});
