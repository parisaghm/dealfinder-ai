import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Cross-store matching, through the real UI against the seeded catalogue.
 *
 * A separate spec from `main-flow.spec.ts`, which documents the six journeys
 * the original brief called out and should stay as it is.
 *
 * The seeded Sony trio is the fixture the whole feature turns on, and its
 * numbers are load-bearing:
 *
 *   Gigantti        329 € + free      = 329 €     ← cheapest to actually buy
 *   Verkkokauppa    319 € + 12,90 €   = 331,90 €  ← cheapest listed price
 *   Power           339 € + free      = 339 €
 *
 * Prices are asserted as bare numbers rather than formatted currency, because
 * `Intl` emits a non-breaking space — the trap already documented at
 * `main-flow.spec.ts:203`.
 */

const DEMO_USER = 'demo@dealfinder.test';
const API = 'http://127.0.0.1:4000';

/** Three stores, one product. Reserved for tests 1–5. */
const SONY_QUERY = 'wh-1000xm5';

/**
 * The review showcase, deliberately a *different* product from the one tests
 * 1–5 assert on.
 *
 * Approving grows the Samsung group; the Sony group stays at three stores. If
 * both journeys shared a product, test 2 would fail on the second run even with
 * the restore in place, because the ordering of one test's `afterEach` against
 * the next test's `beforeEach` is not something to rely on for correctness.
 */
const REVIEW_MODEL = 'QE65Q70DATXXC';

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-user-email': DEMO_USER });
});

test('1 — a product sold by three stores appears as three separate offers', async ({ page }) => {
  await page.goto(`/search?query=${SONY_QUERY}`);

  const cards = page.locator('article');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThanOrEqual(3);

  // Named stores rather than an exact count, so a later seed addition cannot
  // break this on a technicality.
  for (const store of ['Gigantti', 'Power', 'Verkkokauppa.com']) {
    await expect(page.getByText(store, { exact: true }).first()).toBeVisible();
  }
});

test('2 — grouped mode shows one product, not three duplicates', async ({ page }) => {
  await page.goto(`/search?query=${SONY_QUERY}&group=canonical`);

  const heading = page.getByRole('heading', { name: /WH-1000XM5/i });
  await expect(heading).toHaveCount(1);
  await expect(page.getByText('3 stores')).toBeVisible();

  // The flip back is the sharpest available statement of "grouped, not
  // deduplicated": the offers were never hidden, only collected.
  //
  // `click` rather than `check`: this radio is fully controlled from the URL,
  // and `check` additionally asserts the input's own `checked` property right
  // after clicking — before React has round-tripped the navigation back into
  // it. What a user actually experiences is the URL and what the page then
  // shows, and both are asserted directly below.
  await page.getByRole('radio', { name: /individual offers/i }).click();
  await expect(page).toHaveURL((url) => !url.searchParams.has('group'));
  await expect(page.getByRole('heading', { name: /WH-1000XM5/i })).toHaveCount(3);
});

test('3 — "Compare offers" opens the comparison page', async ({ page }) => {
  await page.goto(`/search?query=${SONY_QUERY}&group=canonical`);

  await page.getByRole('link', { name: /compare offers/i }).click();

  await expect(page).toHaveURL(/\/compare\//);
  await expect(page.getByRole('heading', { level: 1, name: /WH-1000XM5/i })).toBeVisible();
  await expect(page.getByRole('table', { name: /offers for/i })).toBeVisible();

  const table = page.getByRole('table', { name: /offers for/i });
  for (const store of ['Gigantti', 'Power', 'Verkkokauppa.com']) {
    await expect(table.getByRole('row', { name: new RegExp(store) })).toBeVisible();
  }
});

test('4 — the cheapest TOTAL is highlighted, not the cheapest listed price', async ({ page }) => {
  await page.goto(`/search?query=${SONY_QUERY}&group=canonical`);
  await page.getByRole('link', { name: /compare offers/i }).click();
  await expect(page.getByRole('table', { name: /offers for/i })).toBeVisible();

  // Gigantti lists 329 € with free delivery and wins on total.
  const winner = page.getByRole('row', { name: /cheapest total/i });
  await expect(winner).toContainText('Gigantti');
  await expect(winner).toContainText('329');

  // Verkkokauppa lists 319 € — the lowest number on any store's page — but
  // charges 12,90 € to deliver it, so it must not be crowned. This assertion is
  // the reason the feature exists.
  const listedLeader = page.getByRole('row', { name: /Verkkokauppa\.com/i });
  await expect(listedLeader).toContainText('319');
  await expect(listedLeader).toContainText('331,90');
  await expect(listedLeader).not.toContainText(/cheapest total/i);

  // Scoped to the summary paragraph: the winning table row says much the same
  // thing, and an unscoped match would be ambiguous.
  await expect(
    page.locator('p').filter({ hasText: /^Cheapest total/ }),
  ).toContainText('Gigantti');
});

test.describe('4b — the comparison on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('renders one card per store instead of a nine-column table', async ({ page }) => {
    await page.goto(`/search?query=${SONY_QUERY}&group=canonical`);
    await page.getByRole('link', { name: /compare offers/i }).click();
    await expect(page.getByRole('heading', { level: 1, name: /WH-1000XM5/i })).toBeVisible();

    await expect(page.getByRole('table', { name: /offers for/i })).toHaveCount(0);

    const offers = page.getByRole('listitem').filter({ hasText: /product price/i });
    await expect(offers).toHaveCount(3);

    // The list is in the default sort order, so cheapest-total reads first.
    await expect(offers.first()).toContainText('Gigantti');
    await expect(offers.first()).toContainText(/cheapest total/i);
  });
});

test('5 — the historical chart can be filtered by store', async ({ page }) => {
  await page.goto(`/search?query=${SONY_QUERY}&group=canonical`);
  await page.getByRole('link', { name: /compare offers/i }).click();

  await page.getByRole('button', { name: /show values as a table/i }).click();
  const values = page.getByRole('table', { name: /recorded prices by store/i });
  await expect(values.getByRole('columnheader', { name: 'Power' })).toBeVisible();

  const powerToggle = page.getByRole('button', { name: /^Power/ });
  await expect(powerToggle).toHaveAttribute('aria-pressed', 'true');

  // No waitForResponse here, deliberately: the filter runs over history that
  // has already been fetched, so there is no request to race.
  await powerToggle.click();

  await expect(powerToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(values.getByRole('columnheader', { name: 'Power' })).toHaveCount(0);
  await expect(values.getByRole('columnheader', { name: 'Gigantti' })).toBeVisible();
  await expect(page).toHaveURL(/series=/);
});

test.describe('6 — reviewing a medium-confidence candidate', () => {
  /**
   * Approving writes `Product.canonicalProductId` and flips the candidate out
   * of `PENDING`. This suite runs with `workers: 1` against the shared seeded
   * database and never resets it, so the test has to put its own fixture back
   * or it passes exactly once.
   *
   * `rematch { force: true }` is the only operation that can. Rejecting would
   * leave the row `REJECTED`, which is just as unrunnable as `APPROVED`; force
   * deletes this listing's candidates whatever their status, clears the
   * canonical link, and recomputes them as `PENDING`.
   *
   * It runs before *and* after: an `afterEach` that never fired because an
   * earlier run crashed would otherwise poison every later run.
   */
  async function restorePendingCandidate(request: APIRequestContext): Promise<void> {
    const search = await request.get(`${API}/api/deals?query=${REVIEW_MODEL}`, {
      headers: { 'x-user-email': DEMO_USER },
    });
    expect(search.ok()).toBeTruthy();

    const body = (await search.json()) as { items: { id: string }[] };
    const productId = body.items[0]?.id;
    expect(productId, `expected the seeded ${REVIEW_MODEL} listing to exist`).toBeTruthy();

    const reset = await request.post(`${API}/api/products/${String(productId)}/rematch`, {
      headers: { 'x-user-email': DEMO_USER },
      data: { force: true },
    });
    expect(reset.ok()).toBeTruthy();
  }

  test.beforeEach(async ({ request }) => {
    await restorePendingCandidate(request);
  });

  test.afterEach(async ({ request }) => {
    await restorePendingCandidate(request);
  });

  test('an ambiguous match can be reviewed and approved', async ({ page }) => {
    await page.goto('/admin/match-review?status=PENDING&confidence=MEDIUM');

    // Nobody should be able to mistake this for a shipped feature.
    await expect(page.getByText(/internal mvp tool/i)).toBeVisible();

    const row = page
      .getByRole('listitem')
      .filter({ hasText: new RegExp(REVIEW_MODEL, 'i') })
      .first();
    await expect(row).toBeVisible();

    // Both sides, and the evidence in both directions.
    await expect(row.getByRole('heading', { name: /source listing/i })).toBeVisible();
    await expect(row.getByRole('heading', { name: /candidate match/i })).toBeVisible();
    await expect(row.getByText(/medium confidence/i)).toBeVisible();
    await expect(row.getByText(/points against/i)).toBeVisible();
    await expect(row.getByText(/points for/i)).toBeVisible();

    await row.getByRole('button', { name: /^approve$/i }).click();

    // It leaves the queue …
    await expect(
      page.getByRole('listitem').filter({ hasText: new RegExp(REVIEW_MODEL, 'i') }),
    ).toHaveCount(0);

    // … and the decision is visible to users: the group gains a store.
    await page.goto('/search?query=q70d&group=canonical');
    await expect(page.getByText('2 stores')).toBeVisible();
  });
});
