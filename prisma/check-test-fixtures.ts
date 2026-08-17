import 'dotenv/config';

import { existsSync, readFileSync } from 'node:fs';
import { disconnectPrisma, getPrismaClient } from '@deal-finder/db';

/**
 * Detect test fixtures that outlived the run that created them. **Read-only.**
 *
 * ## Why this exists
 *
 * Integration-test fixtures are namespaced and removed by their own `afterAll`.
 * That is correct and sufficient right up to the moment the process dies — and on
 * a memory-fragile development database it does die, mid-suite, with
 * `Connection terminated unexpectedly`. The cleanup never runs, and two test
 * stores, a product and a watchlist row are left behind. Nothing fails; the
 * counts simply drift, and the next person to compare them against the documented
 * baseline has to work out which rows are real.
 *
 * ## Why it does not delete anything
 *
 * Deleting rows from a shared database on the strength of a name pattern is how a
 * cleanup script eventually eats real data. So this command *reports* and exits
 * non-zero. Removal stays a deliberate, reviewed act — the report gives you the
 * exact ids to act on.
 *
 * ## What counts as a test fixture
 *
 * Only the conventions the fixtures themselves establish
 * (`apps/api/tests/helpers/fixtures.ts` and `apps/api/tests/destination.test.ts`),
 * every one of which is a *prefix no seeded row uses*:
 *
 *   users      email `test-<uuid8>@dealfinder.test` and name "Test User"
 *   stores     slug `test-…`            (`test-store-…`, `test-se-fi-…`, …)
 *   products   brand `TestBrand…`, name `Test product …`, or in a test store
 *   canonicals brandKey `testbrand…`
 *   rates      `fetchedAt` not midnight UTC — the seed always truncates to the day
 *
 * Seeded stores are `gigantti`, `power`, `verkkokauppa`, `nordbyte`, `techhalle`,
 * `kanaalshop`, `maison-numerique`, `iberica-digital`, `adriatica-tech`,
 * `danske-elektro`; no seeded brand begins with `TestBrand`. A demo store is *not*
 * a test fixture — synthetic and leaked are different things, and conflating them
 * would have this command propose deleting seven of the ten stores.
 *
 * Notifications are matched only where ownership is unambiguous: a row belonging
 * to a test user or test product, or an id the end-to-end ledger recorded creating.
 * A `TEST` notification against the demo user is *not* flagged — a developer
 * clicking "Send a test alert" in the browser creates exactly that, and it is
 * theirs.
 */

const prisma = getPrismaClient();

/** Ids the E2E suite recorded creating. Kept outside `test-results/`. */
const E2E_LEDGER = '.playwright/e2e-notifications.json';

function ledgerIds(): string[] {
  try {
    if (!existsSync(E2E_LEDGER)) return [];
    const parsed: unknown = JSON.parse(readFileSync(E2E_LEDGER, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

interface Finding {
  table: string;
  rows: { id: string; label: string }[];
  /** How these rows would normally have been removed, for the report. */
  owner: string;
}

const findings: Finding[] = [];

function record(table: string, owner: string, rows: { id: string; label: string }[]): void {
  if (rows.length > 0) findings.push({ table, owner, rows });
}

// ── Users ───────────────────────────────────────────────────────────────────

const testUsers = await prisma.user.findMany({
  where: { name: 'Test User', email: { startsWith: 'test-' } },
  select: { id: true, email: true, createdAt: true },
});
record(
  'User',
  'createTestContext().cleanup()',
  testUsers.map((user) => ({
    id: user.id,
    label: `${user.email} (created ${user.createdAt.toISOString()})`,
  })),
);
const testUserIds = testUsers.map((user) => user.id);

// ── Stores ──────────────────────────────────────────────────────────────────

const testStores = await prisma.store.findMany({
  where: { slug: { startsWith: 'test-' } },
  select: { id: true, slug: true, name: true, _count: { select: { products: true } } },
});
record(
  'Store',
  'createTestContext().cleanup()',
  testStores.map((store) => ({
    id: store.id,
    label: `${store.slug} "${store.name}" (${String(store._count.products)} product(s))`,
  })),
);
const testStoreIds = testStores.map((store) => store.id);

// ── Products ────────────────────────────────────────────────────────────────

const testProducts = await prisma.product.findMany({
  where: {
    OR: [
      { brand: { startsWith: 'TestBrand' } },
      { name: { startsWith: 'Test product' } },
      ...(testStoreIds.length > 0 ? [{ storeId: { in: testStoreIds } }] : []),
    ],
  },
  select: {
    id: true,
    name: true,
    brand: true,
    externalId: true,
    store: { select: { slug: true } },
  },
});
record(
  'Product',
  'createTestContext().cleanup()',
  testProducts.map((product) => ({
    id: product.id,
    label: `${product.brand ?? '(no brand)'} · ${product.name} · store=${product.store.slug} · externalId=${product.externalId}`,
  })),
);
const testProductIds = testProducts.map((product) => product.id);

// ── Canonical products ──────────────────────────────────────────────────────

const testCanonicals = await prisma.canonicalProduct.findMany({
  where: { brandKey: { startsWith: 'testbrand' } },
  select: { id: true, name: true, brandKey: true },
});
record(
  'CanonicalProduct',
  'createTestContext().cleanup()',
  testCanonicals.map((canonical) => ({
    id: canonical.id,
    label: `${canonical.brandKey} · ${canonical.name}`,
  })),
);

// ── Rows hanging off a test product ─────────────────────────────────────────

if (testProductIds.length > 0) {
  const offers = await prisma.storeOffer.findMany({
    where: { productId: { in: testProductIds } },
    select: { id: true, countryCode: true, currency: true, productId: true },
  });
  record(
    'StoreOffer',
    'cascade from Product',
    offers.map((offer) => ({
      id: offer.id,
      label: `${offer.countryCode}/${offer.currency} for product ${offer.productId}`,
    })),
  );

  const offerHistory = await prisma.storeOfferPriceHistory.count({
    where: { storeOffer: { productId: { in: testProductIds } } },
  });
  if (offerHistory > 0) {
    record('StoreOfferPriceHistory', 'cascade from StoreOffer', [
      { id: '(aggregate)', label: `${String(offerHistory)} row(s) under test offers` },
    ]);
  }

  const priceHistory = await prisma.priceHistory.count({
    where: { productId: { in: testProductIds } },
  });
  if (priceHistory > 0) {
    record('PriceHistory', 'cascade from Product', [
      { id: '(aggregate)', label: `${String(priceHistory)} row(s) under test products` },
    ]);
  }

  const candidates = await prisma.productMatchCandidate.findMany({
    where: { sourceProductId: { in: testProductIds } },
    select: { id: true, status: true, sourceProductId: true },
  });
  record(
    'ProductMatchCandidate',
    'cascade from Product',
    candidates.map((candidate) => ({
      id: candidate.id,
      label: `${candidate.status} for product ${candidate.sourceProductId}`,
    })),
  );
}

// ── Watchlist items ─────────────────────────────────────────────────────────

const watchlistWhere = [
  ...(testProductIds.length > 0 ? [{ productId: { in: testProductIds } }] : []),
  ...(testUserIds.length > 0 ? [{ userId: { in: testUserIds } }] : []),
];
if (watchlistWhere.length > 0) {
  const items = await prisma.watchlistItem.findMany({
    where: { OR: watchlistWhere },
    select: {
      id: true,
      destinationCountry: true,
      preferredCurrency: true,
      product: { select: { name: true } },
    },
  });
  record(
    'WatchlistItem',
    'cascade from Product or User',
    items.map((item) => ({
      id: item.id,
      label: `${item.destinationCountry}/${item.preferredCurrency} · ${item.product.name}`,
    })),
  );
}

// ── Notifications ───────────────────────────────────────────────────────────

const recordedIds = ledgerIds();
const notificationWhere = [
  ...(testProductIds.length > 0 ? [{ productId: { in: testProductIds } }] : []),
  ...(testUserIds.length > 0 ? [{ userId: { in: testUserIds } }] : []),
  ...(recordedIds.length > 0 ? [{ id: { in: recordedIds } }] : []),
];
if (notificationWhere.length > 0) {
  const notifications = await prisma.notification.findMany({
    where: { OR: notificationWhere },
    select: { id: true, type: true, message: true, createdAt: true },
  });
  record(
    'Notification',
    'e2e ledger, or cascade from Product/User',
    notifications.map((notification) => ({
      id: notification.id,
      label: `${notification.type} · "${notification.message}" · ${notification.createdAt.toISOString()}${
        recordedIds.includes(notification.id) ? ' · recorded by the e2e ledger' : ''
      }`,
    })),
  );
}

// ── Exchange rates ──────────────────────────────────────────────────────────

/*
  The seed stamps every rate at midnight UTC precisely so re-seeding is
  idempotent, so anything with a time component was written by a test. That is a
  narrower rule than "recent", which would flag a genuine second observation.
*/
const rates = await prisma.exchangeRate.findMany({
  select: { id: true, baseCurrency: true, quoteCurrency: true, fetchedAt: true },
});
record(
  'ExchangeRate',
  "destination.test.ts afterAll (rows not stamped midnight UTC)",
  rates
    .filter((rate) => {
      const at = rate.fetchedAt;
      return (
        at.getUTCHours() !== 0 ||
        at.getUTCMinutes() !== 0 ||
        at.getUTCSeconds() !== 0 ||
        at.getUTCMilliseconds() !== 0
      );
    })
    .map((rate) => ({
      id: rate.id,
      label: `${rate.baseCurrency}->${rate.quoteCurrency} at ${rate.fetchedAt.toISOString()}`,
    })),
);

// ── Report ──────────────────────────────────────────────────────────────────

await disconnectPrisma();

const total = findings.reduce((sum, finding) => sum + finding.rows.length, 0);

if (total === 0) {
  console.log('No orphaned test fixtures. The database holds seeded and demo data only.');
  process.exit(0);
}

console.error(`Found ${String(total)} orphaned test-fixture row(s).\n`);
for (const finding of findings) {
  console.error(`${finding.table}  (normally removed by: ${finding.owner})`);
  for (const row of finding.rows) {
    console.error(`  ${row.id}  ${row.label}`);
  }
  console.error('');
}
console.error(
  [
    'These are left over from a test run that did not reach its cleanup — most often',
    'because the development database dropped its connection mid-suite.',
    '',
    'Nothing has been deleted. Removal is deliberate: see',
    'docs/database-environment.md → "Recovering from an interrupted test run".',
  ].join('\n'),
);
process.exit(1);
