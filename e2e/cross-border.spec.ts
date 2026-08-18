import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Cross-border delivery, through the real UI against the seeded catalogue.
 *
 * A third spec alongside `main-flow.spec.ts` and `cross-store.spec.ts`, which
 * stay exactly as they are. Those two describe a Finland-only product comparing
 * shelf prices; this one describes the question the expansion added — *what does
 * it cost to get this to my door, here* — and the ways that answer can be wrong.
 *
 * ## The fixture
 *
 * The seeded `Lumenta 27" QHD 165 Hz Monitor` exists as two canonical groups,
 * and both are load-bearing:
 *
 *   **The euro group** (4 stores, all EUR)
 *     Adriatica Tech   249 € + 16,90 € = 265,90 €  ← cheapest, OUT OF STOCK
 *     TechHalle        279 € + 12,90 € = 291,90 €  ← wins to Finland
 *     Maison Numérique 265 €                        ← does not ship to Finland
 *     Ibérica Digital  289 €                        ← does not ship to Finland
 *
 *   Delivered to Germany the same four rows re-rank completely: Maison Numérique
 *   becomes reachable and wins at 272,90 €, and TechHalle's delivery drops to
 *   free. Same product, same query, different answer — which is the feature.
 *
 *   **The foreign-currency group** (2 stores, DKK and SEK)
 *     Danske Elektro  2 099 kr → 281,27 € + 13,27 € = 294,54 €
 *     Nordbyte        3 390 kr → 294,93 € + delivery UNPUBLISHED → no total
 *
 * Nothing here touches the Sony trio, the Samsung review fixture, the GoPro
 * watchlist flow or the six seeded watchlist rows. The watchlist test uses the
 * `Kestrel Action 8 Camera`, which no other spec mentions.
 *
 * ## Two conventions inherited from the existing specs
 *
 * Prices are compared as numbers read from `data-delivered`, never as formatted
 * text: `Intl` emits a non-breaking space and a comma decimal, and asserting on
 * that is how a currency test becomes a locale test.
 *
 * `useDeals` sets `placeholderData: (previous) => previous`, so the previous
 * results stay on screen while the next request is in flight. Every assertion
 * about *changed* data waits for the response that changed it.
 *
 * ## Identifiers
 *
 * Canonical ids are cuids generated at seed time, so they are resolved from the
 * API inside each test rather than pasted in. A hard-coded id passes until the
 * next reseed and then fails with a 404 that says nothing about the feature.
 */

const API = 'http://127.0.0.1:4000';
const DEMO_USER = 'demo@dealfinder.test';
const HEADERS = { 'x-user-email': DEMO_USER };

/** The key `lib/destination.tsx` remembers a chosen destination under. */
const DESTINATION_KEY = 'dealfinder.destination.v1';

/**
 * The winner badge, always matched exactly.
 *
 * The table's screen-reader caption ends "…cheapest delivered total first", so a
 * substring match counts the caption as a second winner and every
 * "exactly one badge" assertion silently becomes "exactly two".
 */
const CHEAPEST_BADGE = 'Cheapest delivered total';

/**
 * Store names as ASCII fragments.
 *
 * `Maison Numérique` and `Ibérica Digital` are matched on the part before the
 * accent. A literal `é` here has to be byte-identical to the seeded one to
 * match, and the two normalisation forms are indistinguishable on screen — which
 * makes the absence assertions the dangerous ones: `toHaveCount(0)` passes for a
 * store that is present under a differently-encoded name.
 */
const MAISON = 'Maison';
const IBERICA = 'rica Digital';

const CROSS_BORDER_QUERY = 'lumenta 27';
const CROSS_BORDER_NAME = 'Lumenta 27" QHD 165 Hz Monitor';

/** Cheapest shelf price in its group belongs to an offer with no published delivery. */
const UNPUBLISHED_DELIVERY_QUERY = 'pixmo tab';

/** The watchlist fixture. Not in the seeded six, and not used by any other spec. */
const WATCHLIST_QUERY = 'kestrel';
const WATCHLIST_NAME = 'Kestrel Action 8 Camera';

/**
 * The seeded delivery settings, restored around test 7.
 *
 * Written as constants rather than captured at the start of the run: a previous
 * run that crashed before its cleanup would otherwise have its wrong values
 * captured and faithfully restored.
 */
const SEEDED_DELIVERY_SETTINGS = {
  currency: 'EUR',
  defaultCountryCode: 'FI',
  defaultStoreRegion: 'local',
  preferredStoreCountries: [],
  includeNonEuStores: false,
  showUnknownShipping: false,
  warnAboutImportCharges: true,
  deliveryTimePreference: 'any',
} as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

async function json<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`${API}${path}`, { headers: HEADERS });
  expect(response.ok(), `${path} -> ${String(response.status())}`).toBeTruthy();
  return (await response.json()) as T;
}

/**
 * Start with no remembered destination.
 *
 * `addInitScript` runs on *every* document, so an unguarded `removeItem` would
 * also wipe the choice the test itself just made, one navigation later — which
 * would make "the destination survives navigation" impossible to test rather
 * than merely failing. The `sessionStorage` flag survives navigation within the
 * context but not into the next test's fresh context, which is exactly the
 * lifetime wanted.
 */
async function forgetStoredDestination(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    const FLAG = 'e2e.destination.cleared';
    if (sessionStorage.getItem(FLAG) === '1') return;
    sessionStorage.setItem(FLAG, '1');
    localStorage.removeItem(key);
  }, DESTINATION_KEY);
}

interface CanonicalListItem {
  id: string;
  name: string;
  offerCount: number;
}
interface CanonicalGroup {
  id: string;
  name: string;
  offers: { id: string; currency: string; store: { name: string; slug: string } }[];
}

/**
 * The two Lumenta groups, told apart by what their members are priced in rather
 * than by an offer count that a later seed could change.
 */
async function lumentaGroups(request: APIRequestContext): Promise<{
  euro: CanonicalGroup;
  foreignCurrency: CanonicalGroup;
}> {
  const list = await json<{ items: CanonicalListItem[] }>(
    request,
    `/api/canonical-products?query=${encodeURIComponent(CROSS_BORDER_QUERY)}`,
  );
  expect(list.items.length, 'expected the seeded Lumenta 27" groups').toBeGreaterThanOrEqual(2);

  const groups: CanonicalGroup[] = [];
  for (const item of list.items) {
    groups.push(await json<CanonicalGroup>(request, `/api/canonical-products/${item.id}`));
  }

  const euro = groups.find((group) => group.offers.every((offer) => offer.currency === 'EUR'));
  const foreignCurrency = groups.find((group) =>
    group.offers.every((offer) => offer.currency !== 'EUR'),
  );

  expect(euro, 'expected a euro-priced Lumenta group').toBeTruthy();
  expect(foreignCurrency, 'expected a foreign-currency Lumenta group').toBeTruthy();
  return { euro: euro!, foreignCurrency: foreignCurrency! };
}

/**
 * Open a comparison for one destination and wait for it to be there.
 *
 * The generous first-render timeout is about the development database, not about
 * the assertions that follow: `db:dev` is PGlite behind a socket bridge with a
 * single connection, and the first destination-aware query after a quiet moment
 * can take several seconds. Everything after this point uses the ordinary
 * 10-second expect timeout.
 */
async function openDeliveredComparison(
  page: Page,
  canonicalId: string,
  destination: string,
): Promise<void> {
  await page.goto(`/compare/${canonicalId}?country=${destination === 'Finland' ? 'FI' : 'DE'}&region=european`);
  await expect(
    page.getByRole('table', { name: new RegExp(`delivered to ${destination}`, 'i') }),
  ).toBeVisible({ timeout: 25_000 });
}

/** Delivered totals in render order, as numbers. `null` for a row with no total. */
async function deliveredTotals(page: Page): Promise<(number | null)[]> {
  return page.getByTestId('delivered-price').evaluateAll((nodes) =>
    nodes.map((node) => {
      const raw = (node as HTMLElement).dataset['delivered'];
      return raw == null ? null : Number(raw);
    }),
  );
}

/** How far the document scrolls sideways. Anything above zero is a layout bug. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** Whether the focused element actually looks focused. */
async function focusIsVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return false;
    const style = getComputedStyle(element);
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    const ring = style.boxShadow !== 'none' && style.boxShadow.trim().length > 0;
    return outline || ring;
  });
}

async function restoreDeliverySettings(request: APIRequestContext): Promise<void> {
  const response = await request.patch(`${API}/api/settings`, {
    headers: HEADERS,
    data: SEEDED_DELIVERY_SETTINGS,
  });
  expect(response.ok(), 'failed to restore delivery settings').toBeTruthy();
}

/**
 * Delete every watchlist row this spec could have created.
 *
 * Scoped to the fixture product by name: the six seeded rows belong to other
 * products entirely and must survive untouched.
 */
async function clearFixtureWatchlistRows(request: APIRequestContext): Promise<void> {
  const body = await json<{ items: { id: string; product: { name: string } }[] }>(
    request,
    '/api/watchlist',
  );
  for (const item of body.items) {
    if (!item.product.name.includes(WATCHLIST_NAME)) continue;
    const response = await request.delete(`${API}/api/watchlist/${item.id}`, { headers: HEADERS });
    expect(response.ok()).toBeTruthy();
  }
}

test.beforeEach(async ({ page }) => {
  /*
    Longer than the 45-second project default, because these journeys are longer
    rather than slower: a single test here changes destination two or three
    times, and every change is a fresh destination-aware query that joins offers,
    delivery rules and exchange rates across ten stores. Nothing is being waited
    out — every assertion still has its own 10-second expect timeout.
  */
  test.setTimeout(90_000);
  await page.setExtraHTTPHeaders({ 'x-user-email': DEMO_USER });
});

// ── 1. The legacy path is untouched ─────────────────────────────────────────

test('1 — a search with no destination renders exactly as it did before', async ({ page }) => {
  await forgetStoredDestination(page);
  await page.goto('/search?query=monitor');
  await expect(page.locator('article').first()).toBeVisible();

  // The legacy card's hook, on every result …
  const listed = await page
    .getByTestId('current-price')
    .evaluateAll((nodes) => nodes.map((node) => Number((node as HTMLElement).dataset['price'])));
  expect(listed.length).toBeGreaterThan(0);
  expect(listed.every((value) => Number.isFinite(value) && value > 0)).toBe(true);

  // … and none of the destination surface.
  await expect(page.getByTestId('delivered-price')).toHaveCount(0);
  await expect(page.getByTestId('destination-summary')).toHaveCount(0);
  await expect(page).toHaveURL((url) => !url.searchParams.has('country'));

  // Sorting still reorders the legacy grid.
  const sorted = page.waitForResponse(
    (response) =>
      response.url().includes('/api/deals') &&
      response.url().includes('sort=lowest-price') &&
      response.status() === 200,
  );
  await page.getByLabel('Sort by').selectOption('lowest-price');
  await sorted;
  const ascending = await page
    .getByTestId('current-price')
    .evaluateAll((nodes) => nodes.map((node) => Number((node as HTMLElement).dataset['price'])));
  expect(ascending.length).toBeGreaterThan(1);
  expect([...ascending]).toEqual([...ascending].sort((a, b) => a - b));

  // And filtering still applies, still through the URL.
  await page.getByLabel('Maximum price').fill('400');
  await page.getByRole('button', { name: /apply filters/i }).click();
  await expect(page).toHaveURL(/maximumPrice=400/);
  await expect(page.getByTestId('delivered-price')).toHaveCount(0);
});

// ── 2. Choosing a destination ───────────────────────────────────────────────

test('2 — selecting Finland, EUR and European stores narrows results to what can arrive', async ({
  page,
}) => {
  await forgetStoredDestination(page);
  await page.goto(`/search?query=${encodeURIComponent(CROSS_BORDER_QUERY)}`);
  await expect(page.locator('article').first()).toBeVisible();
  await expect(page.getByTestId('destination-summary')).toHaveCount(0);

  const countrySelect = page.getByLabel('Deliver to');
  const currencySelect = page.getByLabel('Currency');

  // Germany first, then Finland: selecting the value already displayed fires no
  // change event, so choosing "Finland" from a control that already reads
  // Finland would prove nothing about the control.
  await countrySelect.selectOption('DE');
  await expect(page).toHaveURL(/country=DE/);

  const finland = page.waitForResponse(
    (response) => response.url().includes('country=FI') && response.status() === 200,
  );
  await countrySelect.selectOption('FI');
  await finland;

  await expect(currencySelect).toHaveValue('EUR');

  // The region radio is a transparent full-size overlay, so `check()` reports
  // that clicking did not change the input. What matters is the URL and what the
  // page then shows, both asserted below.
  const european = page.waitForResponse(
    (response) => response.url().includes('region=european') && response.status() === 200,
  );
  await page.getByRole('radio', { name: 'European' }).click({ force: true });
  await european;

  // The destination is in the URL, so the link can be shared.
  await expect(page).toHaveURL(/country=FI/);
  await expect(page).toHaveURL(/region=european/);

  const summary = page.getByTestId('destination-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('Finland');
  await expect(summary).toContainText('EUR');

  // Every result now carries a delivered figure …
  await expect(page.getByTestId('delivered-price').first()).toBeVisible();

  // … and the two stores with no Finnish offer for this product are absent.
  const results = page.locator('article');
  await expect(results.filter({ hasText: MAISON })).toHaveCount(0);
  await expect(results.filter({ hasText: IBERICA })).toHaveCount(0);
  // While a store that does deliver here is present.
  await expect(results.filter({ hasText: 'TechHalle' }).first()).toBeVisible();

  // Synthetic retailers say so, in text.
  await expect(page.getByText(/demo store/i).first()).toBeVisible();
  await expect(page.getByText(/illustrative prices/i).first()).toBeVisible();

  /*
    And no result offers to send the shopper to a retailer.

    The whole seeded catalogue is sample data — including the listings attributed
    to Gigantti, Power and Verkkokauppa.com, whose synthetic product URLs sit on
    those retailers' real domains and resolve to nothing. Asserted as the absence
    of any new-tab anchor rather than by checking each card, so a future surface
    that reintroduces one fails here.
  */
  await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
});

// ── 3. What is allowed to win ───────────────────────────────────────────────

test('3 — the cheapest delivered total wins, and every skipped offer is explained', async ({
  page,
  request,
}) => {
  const { euro, foreignCurrency } = await lumentaGroups(request);

  await openDeliveredComparison(page, euro.id, 'Finland');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(CROSS_BORDER_NAME);

  // Exactly one crown, on the whole page.
  const badge = page.getByText(CHEAPEST_BADGE, { exact: true });
  await expect(badge).toHaveCount(1);

  const winner = page.getByRole('row').filter({ hasText: 'Cheapest delivered total' });
  await expect(winner).toContainText('TechHalle');

  // The winner is the cheapest among the rows that could actually be crowned —
  // asserted numerically, from the same attribute the comparison ranks on.
  const totals = (await deliveredTotals(page)).filter(
    (value): value is number => value != null,
  );
  const winnerTotal = Number(
    await winner.getByTestId('delivered-price').getAttribute('data-delivered'),
  );
  expect(totals.length).toBeGreaterThan(1);
  expect(winnerTotal).toBe(291.9);

  // A genuinely cheaper total exists and is shown rather than hidden …
  const cheapest = Math.min(...totals);
  expect(cheapest).toBeLessThan(winnerTotal);

  const skipped = page.getByRole('row').filter({ hasText: 'Adriatica Tech' });
  await expect(skipped.getByTestId('delivered-price')).toHaveAttribute('data-delivered', '265.9');
  await expect(skipped).not.toContainText('Cheapest delivered total');
  await expect(skipped).toContainText(/out of stock/i);

  // … and the reason it was passed over is named, in prose, beside the table.
  const caveat = page.getByTestId('delivered-caveat');
  await expect(caveat).toContainText('Adriatica Tech');
  await expect(caveat).toContainText('not currently available to buy');
  await expect(caveat).toContainText('do not ship to this destination');

  // ── An unpublished delivery cost is never treated as free, and never wins ──
  await openDeliveredComparison(page, foreignCurrency.id, 'Finland');

  const unpublished = page.getByRole('row').filter({ hasText: 'Nordbyte' });
  await expect(unpublished).toContainText('Not published');
  await expect(unpublished).not.toContainText('Free');
  await expect(unpublished.getByTestId('delivered-price')).toHaveCount(0);
  await expect(unpublished).not.toContainText('Cheapest delivered total');
  await expect(page.getByTestId('delivered-caveat')).toContainText('not publish a delivery cost');
});

test('3b — the cheapest shelf price cannot win on an unpublished delivery cost', async ({
  page,
  request,
}) => {
  /*
    A separate fixture because it is a separate claim, and only one seeded group
    states it cleanly: here the *lowest listed price on the page* belongs to the
    offer whose delivery is unpublished. It must not be crowned.

    ## What this test does not assert, and why

    It used to also require that *nobody* be crowned. That passed for a year for
    the wrong reason: the group's other offer is Danish, so crowning it needs a
    DKK→EUR rate no older than `FX_RATE_MAX_AGE_HOURS` (48), and on a development
    database seeded a fortnight ago there is no such rate — every converted offer
    was barred, so the page had no winner at all. Against a freshly seeded
    database the rate is hours old, Danske Elektro's delivered total is genuinely
    known, and it is *correctly* crowned. The assertion was measuring how stale
    the fixture data had become, which is the same trap
    `apps/api/tests/destination.test.ts` documents at its route-level cases.

    So the claim is pinned to the offer it is actually about — the one with no
    published delivery cost — and says nothing about how many *other* offers
    clear the bar. Whether a comparable offer wins depends on FX freshness and is
    covered where rates can be injected rather than inherited from the clock:
    `destination.test.ts` → "shows a stale rate, labels its age, and refuses to
    rank on it as if fresh".
  */
  const list = await json<{ items: CanonicalListItem[] }>(
    request,
    `/api/canonical-products?query=${encodeURIComponent(UNPUBLISHED_DELIVERY_QUERY)}`,
  );
  // The group that actually contains the offer with no published delivery,
  // rather than whichever one the query happened to return first.
  let groupId: string | undefined;
  for (const item of list.items) {
    const group = await json<CanonicalGroup>(request, `/api/canonical-products/${item.id}`);
    if (group.offers.some((offer) => offer.store.slug === 'nordbyte')) {
      groupId = item.id;
      break;
    }
  }
  expect(groupId, 'expected a seeded group with an unpublished delivery cost').toBeTruthy();

  await openDeliveredComparison(page, groupId!, 'Finland');

  const rows = page.getByRole('row');
  const unpublished = rows.filter({ hasText: 'Nordbyte' });

  // The delivery cost is named as unpublished rather than quietly treated as free.
  await expect(unpublished).toContainText('Not published');

  // And the total stays unknown, because an unknown shipping cost cannot produce
  // a known total. This is the assertion the whole feature exists to protect.
  await expect(unpublished.getByTestId('delivered-price')).toHaveCount(0);

  // The safety property: the cheapest *shelf* price does not get crowned on a
  // delivery cost nobody published, however cheap the item itself looks.
  await expect(unpublished).not.toContainText(CHEAPEST_BADGE);

  /*
    At most one winner, and it is never a row whose total is unknown.

    Stated as "no crowned row lacks a delivered total" rather than "Danske Elektro
    wins": a comparable offer is *allowed* to win, and whether one does depends on
    how fresh the FX rates are. Pinning the winner by name would reintroduce
    exactly the dependence on seed age that this test was corrected to remove,
    while this holds whether the page crowns nobody or somebody.
  */
  const crowned = rows.filter({ hasText: CHEAPEST_BADGE });
  expect(await crowned.count()).toBeLessThanOrEqual(1);
  for (const row of await crowned.all()) {
    await expect(row.getByTestId('delivered-price')).toHaveCount(1);
  }
});

// ── 4. The destination decides the answer ───────────────────────────────────

test('4 — changing Finland to Germany changes the stores, the delivery and the winner', async ({
  page,
  request,
}) => {
  const { euro } = await lumentaGroups(request);

  const url = `/search?query=${encodeURIComponent(CROSS_BORDER_QUERY)}&group=canonical&sort=lowest-delivered&country=FI&region=european`;
  await page.goto(url);
  await expect(page.getByTestId('destination-summary')).toContainText('Finland');

  const germany = page.waitForResponse(
    (response) =>
      response.url().includes('/api/deals') &&
      response.url().includes('country=DE') &&
      response.status() === 200,
  );
  await page.getByLabel('Deliver to').selectOption('DE');
  await germany;
  await expect(page.getByTestId('destination-summary')).toContainText('Germany');

  // Everything unrelated to the destination survived the change.
  await expect(page).toHaveURL(/query=lumenta/);
  await expect(page).toHaveURL(/group=canonical/);
  await expect(page).toHaveURL(/sort=lowest-delivered/);
  await expect(page).toHaveURL(/country=DE/);
  await expect(page).toHaveURL(/region=european/);

  // The comparison for the same product now has a different store set, different
  // delivery prices and a different winner.
  const finnish = await json<{
    offers: {
      store: { name: string };
      delivery: { shippingPrice: { major: number } | null; totalDeliveredPrice: { major: number } | null };
      id: string;
    }[];
    comparison: { cheapestDeliveredOfferId: string | null };
  }>(request, `/api/products/${euro.offers[0]!.id}/offers?country=FI&currency=EUR`);

  await openDeliveredComparison(page, euro.id, 'Germany');

  // A store that could not reach Finland is a real row here.
  const newcomer = page.getByRole('row').filter({ hasText: MAISON });
  await expect(newcomer.getByTestId('delivered-price')).toHaveAttribute('data-delivered', '272.9');
  await expect(newcomer).toContainText('Cheapest delivered total');

  // TechHalle delivers domestically for nothing, where it charged 12,90 € to Finland.
  const techhalleToFinland = finnish.offers.find((offer) =>
    offer.store.name.includes('TechHalle'),
  );
  expect(techhalleToFinland?.delivery.shippingPrice?.major).toBe(12.9);
  await expect(page.getByRole('row').filter({ hasText: 'TechHalle' })).toContainText('Free');

  // And the crown moved.
  const finnishWinner = finnish.offers.find(
    (offer) => offer.id === finnish.comparison.cheapestDeliveredOfferId,
  );
  expect(finnishWinner?.store.name).toContain('TechHalle');
  await expect(page.getByText(CHEAPEST_BADGE, { exact: true })).toHaveCount(1);
});

// ── 5. The destination stays chosen ─────────────────────────────────────────

test('5 — the destination survives a click-through, a chart change and a refresh', async ({
  page,
}) => {
  await forgetStoredDestination(page);

  await page.goto(`/search?query=${encodeURIComponent(CROSS_BORDER_QUERY)}&group=canonical`);
  await expect(page.locator('article').first()).toBeVisible();

  /*
    Chosen through the controls rather than handed over in the URL, because the
    two are deliberately different states: a URL destination belongs to that
    link, and only a destination the user actually picked is remembered. A test
    that arrived by URL and then expected storage to have it would be asserting
    a behaviour the app is documented not to have.
  */
  const chosen = page.waitForResponse(
    (response) => response.url().includes('region=european') && response.status() === 200,
  );
  await page.getByRole('radio', { name: 'European' }).click({ force: true });
  await chosen;
  await expect(page).toHaveURL(/country=FI/);
  await expect(page.getByTestId('destination-summary')).toContainText('Finland');

  // Following a link must carry the destination: with a shared link there is
  // nothing in storage to fall back on, so dropping it would silently answer for
  // the reader's own country.
  await page.getByRole('link', { name: /compare offers/i }).first().click();
  await expect(page).toHaveURL(/\/compare\//);
  await expect(page).toHaveURL(/country=FI/);
  await expect(page.getByRole('table', { name: /delivered to Finland/i })).toBeVisible();

  // Toggling a chart series rebuilds the comparison parameters from scratch, and
  // must not rebuild them without the destination.
  await page.getByRole('button', { name: /show values as a table/i }).click();
  const seriesToggle = page.getByRole('button', { pressed: true }).first();
  await seriesToggle.click();
  await expect(page).toHaveURL(/series=/);
  await expect(page).toHaveURL(/country=FI/);

  // Back to the results, still Finnish.
  await page.goBack();
  await expect(page).toHaveURL(/country=FI/);

  // A bare route with no parameters at all: the choice comes back from storage.
  await page.goto('/search');
  await expect(page.getByLabel('Deliver to')).toHaveValue('FI');
  await expect(page.getByTestId('destination-summary')).toContainText('Finland');
  const stored = await page.evaluate(
    (key: string) => localStorage.getItem(key),
    DESTINATION_KEY,
  );
  expect(stored).toContain('"country":"FI"');
  expect(stored).toContain('"region":"european"');
});

// ── 6. One product, several destinations ────────────────────────────────────

test.describe('6 — destination-specific watchlist targets', () => {
  /*
    Runs against the shared seeded database with `workers: 1` and never resets
    it, so the fixture rows are removed before *and* after: an `afterEach` that
    never fired because a run crashed would otherwise leave rows behind and make
    the row-count assertions fail for every later run.
  */
  test.beforeEach(async ({ request }) => {
    await clearFixtureWatchlistRows(request);
  });

  test.afterEach(async ({ request }) => {
    await clearFixtureWatchlistRows(request);
  });

  test('two destinations are two rows, and changing a currency is not a third', async ({
    page,
    request,
  }) => {
    const deals = await json<{ items: { id: string; name: string }[] }>(
      request,
      `/api/deals?query=${WATCHLIST_QUERY}&country=FI&currency=EUR&region=european&limit=5`,
    );
    const productId = deals.items.find((item) => item.name.includes(WATCHLIST_NAME))?.id;
    expect(productId, `expected the seeded ${WATCHLIST_NAME}`).toBeTruthy();

    // ── A delivered-price target for Finland ────────────────────────────────
    //
    // Below the current delivered total on purpose: the form refuses a target at
    // or above it, because such an alert would fire the moment it was saved.
    await page.goto(`/products/${productId!}?country=FI&region=european`);
    await page.getByLabel(/notify me when the delivered price to Finland is below/i).fill('300');
    await page.getByRole('button', { name: /track delivered price/i }).click();
    await expect(page.getByRole('button', { name: /update delivered target/i })).toBeVisible();

    await page.goto('/watchlist');
    const group = page
      .getByTestId('watchlist-product-group')
      .filter({ hasText: WATCHLIST_NAME });
    await expect(group).toHaveCount(1);
    await expect(group.getByTestId('watchlist-target-row')).toHaveCount(1);
    await expect(group.getByTestId('target-scope')).toHaveText('Delivered to Finland · EUR');

    // ── A second, explicitly separate target for Germany ────────────────────
    await group.getByRole('button', { name: /add another target/i }).click();
    await group.getByLabel('Deliver to').selectOption('DE');
    await group.getByLabel('Currency').selectOption('EUR');
    await group.getByLabel(/notify me when the delivered price to Germany is below/i).fill('290');
    await group.getByRole('button', { name: /^add target$/i }).click();

    await expect(group.getByTestId('watchlist-target-row')).toHaveCount(2);
    const scopes = await group.getByTestId('target-scope').allTextContents();
    expect(scopes).toEqual(['Delivered to Finland · EUR', 'Delivered to Germany · EUR']);

    // ── The same tuple again is refused, with the server's own wording ──────
    await group.getByRole('button', { name: /add another target/i }).click();
    await group.getByLabel('Deliver to').selectOption('DE');
    await group.getByLabel('Currency').selectOption('EUR');
    await group.getByRole('button', { name: /add a separate EUR target/i }).click();

    const conflict = group.getByTestId('watchlist-conflict');
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText(/already tracking/i);
    await expect(group.getByTestId('watchlist-target-row')).toHaveCount(2);

    // ── Changing a currency updates that row rather than adding another ─────
    const germanRow = group.getByTestId('watchlist-target-row').filter({ hasText: 'Germany' });
    await germanRow.getByRole('button', { name: /^edit target/i }).click();
    await germanRow.getByLabel('Currency').selectOption('SEK');
    await germanRow.getByRole('button', { name: /save target/i }).click();

    await expect(group.getByTestId('watchlist-target-row')).toHaveCount(2);
    await expect(
      group.getByTestId('target-scope').filter({ hasText: 'Germany' }),
    ).toHaveText('Delivered to Germany · SEK');
    await expect(
      group.getByTestId('target-scope').filter({ hasText: 'Finland' }),
    ).toHaveText('Delivered to Finland · EUR');

    // ── Cleanup through the UI, with the API sweep as a backstop ────────────
    //
    // One at a time, waiting for the list to shrink between clicks: two clicks
    // in a row race the refetch and the second lands on a button that is about
    // to be replaced.
    await group.getByRole('button', { name: /^remove/i }).first().click();
    await expect(group.getByTestId('watchlist-target-row')).toHaveCount(1);
    await group.getByRole('button', { name: /^remove/i }).first().click();
    await expect(
      page.getByTestId('watchlist-product-group').filter({ hasText: WATCHLIST_NAME }),
    ).toHaveCount(0);
  });
});

// ── 7. Settings ─────────────────────────────────────────────────────────────

test.describe('7 — delivery settings persist', () => {
  test.beforeEach(async ({ request }) => {
    await restoreDeliverySettings(request);
  });

  test.afterEach(async ({ request }) => {
    await restoreDeliverySettings(request);
  });

  test('a saved delivery preference is still there after a reload', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByLabel('Default delivery country')).toHaveValue('FI');

    await page.getByLabel('Default delivery country').selectOption('DE');
    await page.getByLabel('Preferred currency').selectOption('SEK');
    await page
      .getByRole('group', { name: 'Default store region' })
      .getByRole('radio', { name: 'European' })
      .click({ force: true });
    await page.getByLabel('Delivery-time preference').selectOption('under-7-days');

    await page.getByRole('button', { name: /save settings/i }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Default delivery country')).toHaveValue('DE');
    await expect(page.getByLabel('Preferred currency')).toHaveValue('SEK');
    await expect(page.getByLabel('Delivery-time preference')).toHaveValue('under-7-days');
    await expect(
      page.getByRole('group', { name: 'Default store region' }).getByRole('radio', {
        name: 'European',
      }),
    ).toBeChecked();

    // Settings unrelated to delivery were not collateral damage.
    await expect(page.getByLabel('Email address')).toHaveValue(DEMO_USER);
    await expect(page.getByLabel('How often to check prices')).toHaveValue('EVERY_6_HOURS');
  });
});

// ── 8. One layout at a time ─────────────────────────────────────────────────

test('8 — the comparison has exactly one representation at every width', async ({
  page,
  request,
}) => {
  const { euro } = await lumentaGroups(request);
  // Loaded before the first resize, or "no table at 375px" would pass on a page
  // that has not finished rendering one at any width.
  await openDeliveredComparison(page, euro.id, 'Finland');
  const table = page.getByRole('table', { name: /delivered to Finland/i });

  // Same shape as the legacy comparison's phone check: every offer card carries
  // a "Product price" row, and no table cell does.
  const offerCards = page.getByRole('listitem').filter({ hasText: /product price/i });

  // ── Phone: cards, no table ──────────────────────────────────────────────
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(table).toHaveCount(0);
  expect(await offerCards.count()).toBeGreaterThan(0);
  await expect(page.getByText(CHEAPEST_BADGE, { exact: true })).toHaveCount(1);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  // ── Tablet: the same table with the reduced column set ──────────────────
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(table).toHaveCount(1);
  await expect(offerCards).toHaveCount(0);
  const mediumColumns = await table.getByRole('columnheader').count();
  await expect(page.getByText(CHEAPEST_BADGE, { exact: true })).toHaveCount(1);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  // ── Desktop: every column ───────────────────────────────────────────────
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(table).toHaveCount(1);
  await expect(offerCards).toHaveCount(0);
  const wideColumns = await table.getByRole('columnheader').count();
  expect(wideColumns).toBeGreaterThan(mediumColumns);
  await expect(page.getByText(CHEAPEST_BADGE, { exact: true })).toHaveCount(1);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  // One copy of the destination controls, whatever the width — hidden
  // duplicates would match every locator on the page twice.
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel('Deliver to')).toHaveCount(width < 768 ? 0 : 1);
  }
});

// ── 9. Reachable and readable ───────────────────────────────────────────────

test('9 — the destination flow is usable from the keyboard and readable without colour', async ({
  page,
  request,
}) => {
  const { euro } = await lumentaGroups(request);

  await page.goto(
    `/search?query=${encodeURIComponent(CROSS_BORDER_QUERY)}&country=FI&region=european`,
  );

  // The skip link is still the first focusable thing, with the destination
  // controls added after the navigation in DOM order.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: /skip to main content/i })).toBeFocused();
  expect(await focusIsVisible(page)).toBe(true);

  // Every destination control has a name, and none of them is a bare flag.
  await expect(page.getByLabel('Deliver to')).toBeVisible();
  await expect(page.getByLabel('Currency')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Store region' })).toBeVisible();
  await expect(page.getByLabel('Deliver to')).toContainText('Finland');

  for (const control of [page.getByLabel('Deliver to'), page.getByLabel('Currency')]) {
    await control.focus();
    await expect(control).toBeFocused();
    expect(await focusIsVisible(page)).toBe(true);
  }

  // The result actions are reachable and visibly focusable.
  const firstResultLink = page.locator('article h3 a').first();
  await firstResultLink.focus();
  await expect(firstResultLink).toBeFocused();
  expect(await focusIsVisible(page)).toBe(true);

  // Comparison: the chart controls and the winner.
  await openDeliveredComparison(page, euro.id, 'Finland');

  const valuesToggle = page.getByRole('button', { name: /show values as a table/i });
  await valuesToggle.focus();
  await expect(valuesToggle).toBeFocused();
  expect(await focusIsVisible(page)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /hide values/i })).toBeVisible();

  const seriesToggle = page.getByRole('button', { pressed: true }).first();
  await seriesToggle.focus();
  expect(await focusIsVisible(page)).toBe(true);

  // The winner, the warnings and the demo disclosure are all words, not colours.
  await expect(page.getByText(CHEAPEST_BADGE, { exact: true })).toBeVisible();
  await expect(page.getByTestId('delivered-caveat')).toContainText(
    'not currently available to buy',
  );
  await expect(page.getByTestId('demo-store-footnote')).toContainText(/fictional retailer/i);
  // The delivered comparison used to link each row to the retailer's front page.
  // It links to the product now, and only when the offer was actually fetched —
  // which no seeded offer was.
  await expect(page.locator('a[target="_blank"]')).toHaveCount(0);

  // Watchlist actions are reachable too, and name their destination.
  await page.goto('/watchlist');
  const firstEdit = page.getByRole('button', { name: /^edit target/i }).first();
  await firstEdit.focus();
  await expect(firstEdit).toBeFocused();
  expect(await focusIsVisible(page)).toBe(true);
  await expect(firstEdit).toHaveAttribute('aria-label', /delivery to .+ in [A-Z]{3}/);
});
