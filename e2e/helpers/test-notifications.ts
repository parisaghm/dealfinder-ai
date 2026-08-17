import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Notification rows created by the end-to-end suite, and how they get removed.
 *
 * ## The leak this fixes
 *
 * `POST /api/alerts/test` persists a `Notification` row — deliberately, because a
 * test alert you cannot see in your alert history is not much of a test. The
 * "settings can be saved and a test alert sent" journey therefore adds one row
 * per run, against the *seeded demo user*, and nothing removed it. Six runs took
 * the seeded count from 3 to 9.
 *
 * ## Why not a broad delete
 *
 * There is no `DELETE /api/notifications/:id`, and `POST /api/settings/clear-data`
 * works by whole category — clearing "notifications" would take the three seeded
 * rows the dashboard's activity panel is built on. `deleteMany({ type: 'TEST' })`
 * would be just as wrong: a developer who clicks "Send a test alert" in the
 * browser creates a legitimate row of exactly that type, and a test suite has no
 * business deciding that someone else's data was disposable.
 *
 * So the rule here is: **delete by id, and only ids we recorded creating.** Each
 * id is checked against the row it names before the delete, and a row that is not
 * a `TEST` notification is left alone and reported.
 *
 * ## Why the ledger is a file
 *
 * A run that crashes between creating the row and its `afterAll` would otherwise
 * lose the id and leak the row silently. The ids are appended to a small JSON
 * file outside `test-results/` — Playwright empties that directory at the start of
 * every run, which is precisely when the previous run's evidence is still needed.
 * `beforeAll` sweeps whatever the file still holds, so a crashed run is cleaned up
 * by the next one rather than accumulating.
 */

/**
 * Deliberately not under `test-results/`: Playwright clears that at startup.
 * `.playwright/` is already gitignored.
 */
const NOTIFICATION_LEDGER = '.playwright/e2e-notifications.json';

/**
 * The watchlist row the "track a product" journey creates.
 *
 * It is removed through the UI as the last step of that test, which is the
 * behaviour under test and must stay. But a run that fails *before* that step
 * leaves the row behind — which is how `watchlistItems` reached 7 against a
 * seeded 6. Recorded here so the cleanup does not depend on the test reaching
 * its own end.
 */
const WATCHLIST_LEDGER = '.playwright/e2e-watchlist.json';

function readLedger(path: string): string[] {
  try {
    if (!existsSync(path)) return [];
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    // A corrupt ledger must not fail the suite; the integrity check
    // (`npm run db:check-test-fixtures`) is the backstop that would still
    // notice a leaked row.
    return [];
  }
}

function writeLedger(path: string, ids: readonly string[]): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify([...ids], null, 2)}\n`, 'utf8');
  } catch {
    // Non-fatal: worst case the row is caught by the integrity check instead.
  }
}

function appendToLedger(path: string, id: string): void {
  const ids = readLedger(path);
  if (ids.includes(id)) return;
  writeLedger(path, [...ids, id]);
}

/** Remember a notification this run created, before anything can go wrong. */
export function recordTestNotification(id: string): void {
  appendToLedger(NOTIFICATION_LEDGER, id);
}

/** Every id recorded and not yet confirmed removed, including from earlier runs. */
export function recordedTestNotifications(): string[] {
  return readLedger(NOTIFICATION_LEDGER);
}

/** Remember a watchlist row this run created. */
export function recordTestWatchlistItem(id: string): void {
  appendToLedger(WATCHLIST_LEDGER, id);
}

/** Forget a watchlist row the test removed itself, so cleanup has nothing to do. */
export function forgetTestWatchlistItem(id: string): void {
  writeLedger(
    WATCHLIST_LEDGER,
    readLedger(WATCHLIST_LEDGER).filter((entry) => entry !== id),
  );
}

export function recordedTestWatchlistItems(): string[] {
  return readLedger(WATCHLIST_LEDGER);
}

/**
 * Remove recorded watchlist rows over HTTP.
 *
 * `DELETE /api/watchlist/:id` already exists and is user-scoped, so this needs no
 * database connection at all — which makes it strictly safer than the
 * notification cleanup below, and is why the two are done differently. A `404`
 * counts as success: the row is gone, which is the outcome being asked for.
 */
export async function removeRecordedWatchlistItems(
  apiBaseUrl: string,
  userEmail: string,
  ids: readonly string[] = readLedger(WATCHLIST_LEDGER),
): Promise<{ deleted: string[]; missing: string[] }> {
  const result = { deleted: [] as string[], missing: [] as string[] };
  if (ids.length === 0) return result;

  const { request } = await import('@playwright/test');
  const context = await request.newContext({
    extraHTTPHeaders: { 'x-user-email': userEmail },
  });

  try {
    for (const id of ids) {
      const response = await context.delete(`${apiBaseUrl}/api/watchlist/${id}`);
      if (response.ok()) result.deleted.push(id);
      else if (response.status() === 404) result.missing.push(id);
    }
  } finally {
    await context.dispose();
  }

  const handled = new Set([...result.deleted, ...result.missing]);
  writeLedger(
    WATCHLIST_LEDGER,
    ids.filter((id) => !handled.has(id)),
  );
  return result;
}

export interface NotificationCleanupResult {
  /** Rows that existed, were `TEST` notifications, and are now gone. */
  deleted: string[];
  /** Ids with no matching row — already cleaned, or a reseed took them. */
  missing: string[];
  /** Rows that exist but are **not** `TEST` notifications. Left untouched. */
  refused: string[];
}

/**
 * Delete the recorded rows, one id at a time, checking each before it goes.
 *
 * The Prisma import is dynamic and the environment is loaded here rather than at
 * module scope: the Playwright process does not load `.env`, and importing the
 * client eagerly would make every spec that merely *imports* this helper pay for
 * a database connection it may not need.
 */
export async function removeRecordedTestNotifications(
  ids: readonly string[] = readLedger(NOTIFICATION_LEDGER),
): Promise<NotificationCleanupResult> {
  const result: NotificationCleanupResult = { deleted: [], missing: [], refused: [] };
  if (ids.length === 0) return result;

  try {
    process.loadEnvFile('.env');
  } catch {
    // Already loaded, or no file — `DATABASE_URL` may still come from the shell.
  }

  const { getPrismaClient, disconnectPrisma } = await import('@deal-finder/db');
  const prisma = getPrismaClient();

  try {
    for (const id of ids) {
      const row = await prisma.notification.findUnique({
        where: { id },
        select: { id: true, type: true },
      });

      if (!row) {
        result.missing.push(id);
        continue;
      }
      // The guard that makes this safe to run against a shared database.
      if (row.type !== 'TEST') {
        result.refused.push(id);
        continue;
      }

      await prisma.notification.delete({ where: { id } });
      result.deleted.push(id);
    }
  } finally {
    await disconnectPrisma();
  }

  // Only ids that are genuinely still outstanding stay in the ledger, so a
  // refused row keeps being reported rather than being forgotten.
  writeLedger(NOTIFICATION_LEDGER, result.refused);
  return result;
}
