import type { PrismaClient } from '@deal-finder/db';
import {
  STATIC_RATE_SOURCE,
  createRateTable,
  staticRateSnapshots,
  type Currency,
  type ExchangeRateSnapshot,
  type RateTable,
} from '@deal-finder/shared';
import { env } from '../env';
import { logger } from '../logger';

/**
 * The exchange-rate table, resolved once per request.
 *
 * "Once per request" is the whole design constraint. A destination search returns
 * up to sixty offers and each one may need a conversion; asking the database for
 * a rate inside the mapper would turn one query into sixty. So the table is
 * loaded here, threaded down as an argument, and every conversion in the request
 * reads the same snapshot — which also means two offers in the same currency can
 * never be converted at two different rates within one response.
 *
 * Two further rules, both inherited from the money module:
 *
 *  - **A rate is never used without its timestamp.** `RateContext` carries the
 *    freshness bound so callers cannot forget to apply it.
 *  - **The application works with no live FX feed.** When `exchange_rates` is
 *    empty the shared static table stands in, so a fresh clone still produces
 *    honest, labelled totals rather than none at all.
 */

/** Rows to load. Seven currencies give 42 directed pairs; this is generous. */
const RATE_ROW_LIMIT = 200;

/**
 * How long a loaded table is reused across requests.
 *
 * Short on purpose. This is a read cache for a value that changes at most a few
 * times a day, and its only job is to stop a burst of searches re-reading the
 * same handful of rows. Long enough to matter, far shorter than
 * `FX_RATE_MAX_AGE_HOURS`, so caching can never be the reason a rate looks
 * fresher than it is — the age shown to the user is computed from `fetchedAt`,
 * not from when we read the row.
 */
const CACHE_TTL_MS = 60_000;

export interface RateContext {
  readonly table: RateTable;
  /** From `FX_RATE_MAX_AGE_HOURS`. Passed to every conversion. */
  readonly maxAgeHours: number;
  /** Fixed for the whole request, so ages within one response agree. */
  readonly now: number;
  /** True when the static fallback stood in for an empty `exchange_rates`. */
  readonly isFallback: boolean;
}

interface CacheEntry {
  snapshots: readonly ExchangeRateSnapshot[];
  isFallback: boolean;
  loadedAt: number;
}

let cache: CacheEntry | null = null;

/** Drops the process-level cache. Exported for tests, which control the clock. */
export function resetRateCache(): void {
  cache = null;
}

/**
 * Midnight UTC today, for the static fallback's `fetchedAt`.
 *
 * The same value the seed uses, and for the same reason: a wall-clock timestamp
 * would claim a rate was fetched this instant when nothing was fetched at all,
 * while a fixed historical constant would age past `FX_RATE_MAX_AGE_HOURS` and
 * silently bar every cross-border offer from ranking. Day granularity is the
 * honest middle — these are today's built-in demo rates, dated to today.
 */
function staticFallbackFetchedAt(now: number): Date {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function loadSnapshots(
  prisma: PrismaClient,
  now: number,
): Promise<{ snapshots: readonly ExchangeRateSnapshot[]; isFallback: boolean }> {
  const rows = await prisma.exchangeRate.findMany({
    // Newest first: `createRateTable` keeps the freshest observation per pair, and
    // this bounds the read to recent history rather than the whole audit trail.
    orderBy: { fetchedAt: 'desc' },
    take: RATE_ROW_LIMIT,
    select: { baseCurrency: true, quoteCurrency: true, rate: true, fetchedAt: true },
  });

  if (rows.length === 0) {
    logger.debug(
      { source: STATIC_RATE_SOURCE },
      'No exchange rates recorded; using the built-in static table',
    );
    return { snapshots: staticRateSnapshots(staticFallbackFetchedAt(now)), isFallback: true };
  }

  return {
    snapshots: rows.map((row) => ({
      baseCurrency: row.baseCurrency as Currency,
      quoteCurrency: row.quoteCurrency as Currency,
      // `String(...)` and not `Number(...)`: the column is Decimal(18, 8) and the
      // money module parses the exact decimal. Routing it through a float first
      // would discard precision before it had been used for anything.
      rate: String(row.rate),
      fetchedAt: row.fetchedAt.toISOString(),
    })),
    isFallback: false,
  };
}

export interface LoadRateContextOptions {
  /** Overrides the clock. Tests set it; request handlers do not. */
  now?: number;
  /** Overrides `FX_RATE_MAX_AGE_HOURS`. */
  maxAgeHours?: number;
  /** Bypass the process cache — used by the monitor, which runs rarely. */
  fresh?: boolean;
}

/**
 * One rate table for one request.
 *
 * Call this at the top of a service, never inside a loop or a mapper.
 */
export async function loadRateContext(
  prisma: PrismaClient,
  options: LoadRateContextOptions = {},
): Promise<RateContext> {
  const now = options.now ?? Date.now();
  const maxAgeHours = options.maxAgeHours ?? env.FX_RATE_MAX_AGE_HOURS;

  const usable =
    !options.fresh && cache != null && now - cache.loadedAt < CACHE_TTL_MS ? cache : null;

  const loaded = usable ?? { ...(await loadSnapshots(prisma, now)), loadedAt: now };
  cache = loaded;

  return {
    table: createRateTable(loaded.snapshots),
    maxAgeHours,
    now,
    isFallback: loaded.isFallback,
  };
}

/**
 * A context that consults no rates at all.
 *
 * For same-currency work and for tests that must prove a code path never needed
 * a conversion: any cross-currency lookup against it resolves to nothing, which
 * surfaces as `rate-missing` rather than as a quiet wrong number.
 */
export function emptyRateContext(options: LoadRateContextOptions = {}): RateContext {
  return {
    table: createRateTable([]),
    maxAgeHours: options.maxAgeHours ?? env.FX_RATE_MAX_AGE_HOURS,
    now: options.now ?? Date.now(),
    isFallback: false,
  };
}
