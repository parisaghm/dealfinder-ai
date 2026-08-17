import { expect, test, type Page } from '@playwright/test';
import {
  forgetTestWatchlistItem,
  recordTestNotification,
  recordTestWatchlistItem,
  recordedTestNotifications,
  recordedTestWatchlistItems,
  removeRecordedTestNotifications,
  removeRecordedWatchlistItems,
} from './helpers/test-notifications';

const API = 'http://127.0.0.1:4000';
const DEMO_USER = 'demo@dealfinder.test';

/**
 * The main user flow, end to end.
 *
 * Covers the six journeys the brief calls out, in order:
 *   1. search for a product,
 *   2. apply filters,
 *   3. open product details,
 *   4. add a product to the watchlist,
 *   5. set a target price,
 *   6. update and remove the watchlist item.
 *
 * Runs against the real API, the real database and the seeded catalogue.
 *
 * Each test uses its own user via the `x-user-email` dev-auth header, so
 * watchlist state cannot leak between tests or clash with the demo user's
 * seeded watchlist.
 */

/**
 * Route every request through a dedicated user.
 *
 * Note the API only auto-provisions the configured DEV_USER_EMAIL, so an
 * unknown address would 401. These tests therefore share the demo user but
 * clean up after themselves.
 */
async function useDemoUser(page: Page) {
  await page.setExtraHTTPHeaders({ 'x-user-email': DEMO_USER });
}

test.beforeEach(async ({ page }) => {
  await useDemoUser(page);
});

/**
 * The test-alert journey persists a real `Notification` row against the seeded
 * demo user, so this file cleans up after itself by id.
 *
 * `beforeAll` sweeps anything a *previous* run recorded and did not manage to
 * delete — a run killed between the click and its `afterAll` would otherwise leak
 * the row silently, and the leak only becomes visible much later as a drifting
 * count. See `helpers/test-notifications.ts` for why this is by id rather than by
 * `type: 'TEST'`.
 */
/**
 * Best-effort on purpose.
 *
 * A failure to reach the database must not fail a suite that is otherwise green:
 * the ids stay in the ledger, so the next run's `beforeAll` tries again, and
 * `npm run db:check-test-fixtures` reports the row in the meantime. Cleanup that
 * can turn a passing run red is a worse trade than cleanup that can be late.
 */
async function sweepRecordedNotifications(when: string): Promise<void> {
  const outstanding = recordedTestNotifications();
  if (outstanding.length === 0) return;

  try {
    const result = await removeRecordedTestNotifications(outstanding);
    if (result.deleted.length > 0) {
      console.log(
        `[e2e ${when}] removed ${String(result.deleted.length)} test notification row(s): ${result.deleted.join(', ')}`,
      );
    }
    if (result.refused.length > 0) {
      console.warn(
        `[e2e ${when}] left ${String(result.refused.length)} row(s) alone — not TEST notifications: ${result.refused.join(', ')}`,
      );
    }
  } catch (error) {
    console.warn(
      `[e2e ${when}] could not reach the database to clean up ${String(outstanding.length)} recorded row(s); ` +
        `they stay in the ledger for the next run. ${String(error).slice(0, 140)}`,
    );
  }
}

/**
 * The watchlist row the tracking journey creates.
 *
 * That test removes it through the UI as its final step — that *is* the
 * behaviour under test and stays exactly as it was. This is the safety net for
 * the run that fails earlier and never gets there, which is how the seeded six
 * rows quietly became seven.
 */
async function sweepRecordedWatchlistItems(when: string): Promise<void> {
  const outstanding = recordedTestWatchlistItems();
  if (outstanding.length === 0) return;

  try {
    const result = await removeRecordedWatchlistItems(API, DEMO_USER, outstanding);
    if (result.deleted.length > 0) {
      console.log(
        `[e2e ${when}] removed ${String(result.deleted.length)} watchlist row(s) a test did not get to: ${result.deleted.join(', ')}`,
      );
    }
  } catch (error) {
    console.warn(
      `[e2e ${when}] could not remove ${String(outstanding.length)} recorded watchlist row(s); ` +
        `they stay in the ledger for the next run. ${String(error).slice(0, 140)}`,
    );
  }
}

test.beforeAll(async () => {
  await sweepRecordedNotifications('beforeAll');
  await sweepRecordedWatchlistItems('beforeAll');
});

test.afterAll(async () => {
  await sweepRecordedNotifications('afterAll');
  await sweepRecordedWatchlistItems('afterAll');
});

test('1 — search for a product from the home page', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: /find real discounts, not just sale labels/i }),
  ).toBeVisible();

  await page.getByRole('searchbox').first().fill('wireless headphones');
  await page.getByRole('button', { name: /find deals/i }).click();

  await expect(page).toHaveURL(/\/search\?query=wireless\+headphones/);
  await expect(page.locator('article').first()).toBeVisible();

  // Results are headphones, because the parser lifted the category out.
  const summary = page.getByText(/deals? found/i);
  await expect(summary).toBeVisible();
});

test('1b — a natural-language query is interpreted and explained', async ({ page }) => {
  await page.goto('/search?query=Philips%20headphones%20with%20at%20least%2030%25%20discount');

  // The interpretation is shown back to the user so an inferred filter is never
  // invisible.
  await expect(page.getByText('Minimum discount 30%')).toBeVisible();
  await expect(page.getByText('Category Headphones')).toBeVisible();

  const cards = page.locator('article');
  await expect(cards.first()).toBeVisible();

  // Every result really is a Philips product at 30% off or more.
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    await expect(cards.nth(index).getByRole('heading')).toContainText(/philips/i);
  }
});

test('2 — apply filters and sort, with state kept in the URL', async ({ page }) => {
  await page.goto('/search');
  await expect(page.locator('article').first()).toBeVisible();

  // Filter to laptops under €1,200.
  await page.getByLabel('Maximum price').fill('1200');
  await page.getByLabel('Category').selectOption('laptops');
  await page.getByRole('button', { name: /apply filters/i }).click();

  await expect(page).toHaveURL(/maximumPrice=1200/);
  await expect(page).toHaveURL(/category=laptops/);

  await expect(page.locator('article').first()).toBeVisible();

  /**
   * Change the sort and wait for the response that reorders the grid.
   *
   * Reading the DOM straight after `selectOption` returns the *previous* order:
   * React Query intentionally keeps the old page visible while the next loads,
   * so "an article is visible" is true before the new data arrives.
   */
  const sortBy = async (option: string) => {
    const response = page.waitForResponse(
      (candidate) =>
        candidate.url().includes('/api/deals') &&
        candidate.url().includes(`sort=${option}`) &&
        candidate.status() === 200,
    );
    await page.getByLabel('Sort by').selectOption(option);
    await response;
    await expect(page.locator('article').first()).toBeVisible();
  };

  /** Prices as numbers, in render order. */
  const renderedPrices = async (): Promise<number[]> => {
    // Read the card's explicit test hook. Keying this off the `tabular` utility
    // class silently scooped up the discount badge too, so "8" and "21" landed
    // in the middle of a list of euro prices.
    const values = await page
      .getByTestId('current-price')
      .evaluateAll((nodes) => nodes.map((node) => Number((node as HTMLElement).dataset.price)));
    return values.filter((value) => Number.isFinite(value) && value > 0);
  };

  // Assert the ordering property itself rather than comparing one name, which
  // says nothing about whether the sort is actually applied.
  await sortBy('lowest-price');
  const ascending = await renderedPrices();
  expect(ascending.length).toBeGreaterThan(1);
  expect([...ascending]).toEqual([...ascending].sort((a, b) => a - b));

  await sortBy('highest-price');
  const descending = await renderedPrices();
  expect([...descending]).toEqual([...descending].sort((a, b) => b - a));
  expect(descending[0]).toBeGreaterThan(ascending[0]!);

  // The browser back button restores the previous sort — search state lives in
  // the URL precisely so this works.
  await page.goBack();
  await expect(page).toHaveURL(/sort=lowest-price/);
});

test('2b — an impossible filter combination shows the empty state', async ({ page }) => {
  await page.goto('/search?category=laptops&maximumPrice=5');

  await expect(page.getByText(/no deals match these filters/i)).toBeVisible();
  await page.getByRole('button', { name: /clear filters/i }).click();
  await expect(page.locator('article').first()).toBeVisible();
});

test('3 — open product details and read the price history', async ({ page }) => {
  await page.goto('/search?sort=best-discount');
  await expect(page.locator('article').first()).toBeVisible();

  const productName = await page.locator('article h3 a').first().textContent();
  await page.locator('article h3 a').first().click();

  await expect(page).toHaveURL(/\/products\//);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(productName!.trim());

  // The evidence: statistics, a chart, and the scoring breakdown.
  await expect(page.getByText('Lowest recorded')).toBeVisible();
  await expect(page.getByText('Average recorded')).toBeVisible();
  await expect(page.getByText('Highest recorded')).toBeVisible();
  await expect(page.locator('svg.recharts-surface')).toBeVisible();

  await expect(page.getByRole('heading', { name: /is this actually a good deal/i })).toBeVisible();
  await expect(page.getByText(/not financial advice/i).first()).toBeVisible();

  // Chart values are also reachable without hovering.
  await page.getByRole('button', { name: /show values as a table/i }).click();
  await expect(page.getByRole('table')).toBeVisible();
});

test('4, 5, 6 — track a product, set a target, update it, then remove it', async ({ page }) => {
  // Pick a product that is not part of the seeded watchlist.
  await page.goto('/search?query=gopro');
  await expect(page.locator('article').first()).toBeVisible();

  const productName = (await page.locator('article h3 a').first().textContent())!.trim();
  await page.goto('/search?query=gopro');
  await page.locator('article h3 a').first().click();
  await expect(page).toHaveURL(/\/products\//);

  // Start from a known state: a previous run may have left this product
  // tracked, which changes the form's button label.
  //
  // Wait for the sidebar to settle first. `isVisible()` does not wait, so
  // checking it before the watchlist query resolves reports "not tracked" for
  // a product that is in fact tracked.
  const submitButton = page.getByRole('button', {
    name: /track this price|update target price/i,
  });
  await expect(submitButton).toBeVisible();

  const stopTracking = page.getByRole('button', { name: /stop tracking/i });
  if (await stopTracking.isVisible()) {
    await stopTracking.click();
    await expect(stopTracking).toBeHidden();
  }
  await expect(page.getByRole('button', { name: /track this price/i })).toBeVisible();

  // ── 5. Set a target price ────────────────────────────────────────────────
  const targetInput = page.getByLabel(/alert me when the price drops to/i);
  await targetInput.fill('300');

  // Record the row before anything downstream can fail. The test removes it
  // itself at step 6c — this only matters when the run does not get that far.
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/watchlist') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /track this price/i }).click();

  const createdBody = (await (await created).json()) as { id?: unknown };
  if (typeof createdBody.id === 'string') recordTestWatchlistItem(createdBody.id);

  // ── 4. It is now tracked ─────────────────────────────────────────────────
  await expect(page.getByRole('button', { name: /update target price/i })).toBeVisible();

  // Assert the gap-to-target note in two steps. A single regex containing
  // "300 €" cannot match, because Intl formats currency with a non-breaking
  // space — an invisible difference that makes such assertions quietly brittle.
  const targetNote = page.getByText(/above your/i);
  await expect(targetNote).toBeVisible();
  await expect(targetNote).toContainText('300');

  // The target is drawn on the chart.
  await expect(page.locator('svg.recharts-surface')).toContainText('Target');

  await page.goto('/watchlist');
  const row = page.locator('li', { has: page.getByRole('heading', { name: productName }) }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText('Waiting for target')).toBeVisible();
  // Same non-breaking-space caveat as above: assert the number, not the format.
  await expect(row).toContainText('300');

  // ── 6a. Update the target inline ─────────────────────────────────────────
  //
  // The two locators below follow a rename, not a change of behaviour: a row can
  // now hold a list-price target and a delivered-price target at once, so the
  // field that used to be "Target price" says which price it means, and "Save"
  // says which target it saves. What is typed, and what the row must then show,
  // are exactly as before.
  await row.getByRole('button', { name: /edit target/i }).click();
  await row.getByLabel(/notify me when the list price is below/i).fill('250');
  await row.getByRole('button', { name: /^save target$/i }).click();
  await expect(row).toContainText('250');

  // ── 6b. Pause and resume monitoring ──────────────────────────────────────
  await row.getByRole('button', { name: /pause/i }).click();
  await expect(row.getByText('Alerts paused')).toBeVisible();
  await row.getByRole('button', { name: /resume/i }).click();
  await expect(row.getByText('Waiting for target')).toBeVisible();

  // ── 6c. Remove it ────────────────────────────────────────────────────────
  await row.getByRole('button', { name: /remove/i }).click();
  await expect(
    page.locator('li', { has: page.getByRole('heading', { name: productName }) }),
  ).toHaveCount(0);

  // Removed through the UI, as the test intends, so the safety net has nothing
  // left to do. Dropped from the ledger here rather than left for `afterAll` to
  // discover as an already-deleted id.
  if (typeof createdBody.id === 'string') forgetTestWatchlistItem(createdBody.id);
});

test('the dashboard summarises tracked products and alert activity', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();

  // exact:true because the same words appear in surrounding prose, and
  // Playwright's strict mode (rightly) refuses an ambiguous locator.
  for (const tile of [
    'Tracked products',
    'Active price alerts',
    'Deals found this week',
    'Estimated savings',
  ]) {
    await expect(page.getByText(tile, { exact: true }).first()).toBeVisible();
  }

  await expect(page.getByRole('heading', { name: /best current deals/i })).toBeVisible();
  await expect(page.locator('article').first()).toBeVisible();
});

test('settings can be saved and a test alert sent', async ({ page }) => {
  await page.goto('/settings');

  await expect(page.getByLabel('Email address')).toHaveValue('demo@dealfinder.test');

  await page.getByLabel('How often to check prices').selectOption('DAILY');
  await page.getByRole('button', { name: /save settings/i }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();

  // Proves the notification path works end to end.
  //
  // The response carries the id of the row it just wrote, so the id is recorded
  // before anything else can fail. Reading it from the response is what makes the
  // cleanup exact: no guessing from a timestamp, no deleting by type.
  const alertResponse = page.waitForResponse(
    (response) => response.url().includes('/api/alerts/test') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /send a test alert/i }).click();

  const body = (await (await alertResponse).json()) as {
    notification?: { id?: unknown; type?: unknown };
  };
  const notificationId = body.notification?.id;
  expect(typeof notificationId, 'the test alert should report the row it created').toBe('string');
  expect(body.notification?.type).toBe('TEST');
  recordTestNotification(notificationId as string);

  await expect(page.getByText(/sent via/i)).toBeVisible({ timeout: 20_000 });

  // Restore the seeded default so re-runs start from the same state.
  await page.getByLabel('How often to check prices').selectOption('EVERY_6_HOURS');
  await page.getByRole('button', { name: /save settings/i }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
});

test('a fake discount is called out rather than celebrated', async ({ page }) => {
  // The seeded Roborock is a permanent "sale": its recorded average equals the
  // discounted price, so the claimed saving is not real.
  await page.goto('/search?query=roborock');
  await expect(page.locator('article').first()).toBeVisible();

  await expect(
    page.getByText(/discount does not match our price records/i).first(),
  ).toBeVisible();

  await page.locator('article h3 a').first().click();
  await expect(page.getByText(/what the product normally costs/i)).toBeVisible();
  await expect(page.getByText(/does not support that claim/i)).toBeVisible();
});

test('keyboard navigation reaches the main actions', async ({ page }) => {
  await page.goto('/');

  // The skip link is the first focusable element on every page.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: /skip to main content/i })).toBeFocused();

  // The search field is reachable and focus is visible.
  await page.getByRole('searchbox').first().focus();
  await expect(page.getByRole('searchbox').first()).toBeFocused();
});
