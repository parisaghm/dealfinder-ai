import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/prisma/client';

/**
 * @deal-finder/db — the single place the database is reached from.
 *
 * Exists as its own package for two reasons: the generated Prisma client needs
 * one owned location (Prisma 7 no longer writes into node_modules), and both
 * the API and the seed script need to import the same client without one
 * depending on the other.
 *
 * Prisma 7 requires a driver adapter: `new PrismaClient()` with no adapter
 * throws at construction time. PostgreSQL goes through `@prisma/adapter-pg`
 * (node-postgres).
 */

export * from './generated/prisma/client';
export { Prisma, PrismaClient };

export * from './ingestion';
export * from './offers';
export * from './countries';
export * from './matching';

export interface CreatePrismaClientOptions {
  connectionString: string;
  /** Emit generated SQL. Useful when diagnosing a slow endpoint. */
  logQueries?: boolean;
  /** Upper bound on the connection pool. See DEFAULT_MAX_CONNECTIONS. */
  maxConnections?: number;
  /** How long an unused connection is kept. See DEFAULT_IDLE_TIMEOUT_MS. */
  idleTimeoutMillis?: number;
  /** How long to wait for a connection. See DEFAULT_CONNECT_TIMEOUT_MS. */
  connectionTimeoutMillis?: number;
}

/**
 * Pool size, deliberately 1 by default.
 *
 * The default development database is Prisma's bundled local PostgreSQL
 * (`npm run db:dev`), which is PGlite behind a socket bridge and **accepts only
 * one client connection at a time** — a second concurrent connection is reset
 * with ECONNRESET. A conventional pool of 10 therefore breaks it the moment two
 * requests overlap, and does so confusingly: a trivial health-check query still
 * succeeds while every real query fails.
 *
 * One connection is correct here (node-postgres queues acquisitions, so
 * concurrency still works, just serialised). Against a real PostgreSQL server —
 * docker-compose or production — raise it with `DATABASE_POOL_MAX`.
 */
export const DEFAULT_MAX_CONNECTIONS = 1;

/**
 * How long an unused connection is kept before it is dropped.
 *
 * Two seconds by default, and deliberately short: with the one-connection dev
 * database this is what lets another tool (`db:seed`, the test suite, Prisma
 * Studio) connect while the API is running, instead of waiting out
 * node-postgres' 10-second default.
 *
 * The cost is that the API reconnects on any request that arrives more than two
 * seconds after the last one, and reconnecting to the PGlite socket bridge is
 * occasionally slow enough to exhaust `connectionTimeoutMillis` — which surfaces
 * as an intermittent 500 on a perfectly good query. When nothing else needs the
 * database (an end-to-end run, docker-compose, production), raise this with
 * `DATABASE_IDLE_TIMEOUT_MS` so the connection is simply kept.
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 2_000;

/**
 * How long to wait for a connection from the pool before giving up.
 *
 * Ten seconds is node-postgres' own default and is generous for a healthy
 * server. It is *not* always generous for the bundled PGlite one: under sustained
 * load it slows down enough that acquisition exceeds this, and the request fails
 * with a 500 that looks like a broken query rather than a busy database. Raise it
 * with `DATABASE_CONNECT_TIMEOUT_MS` where waiting is better than failing — an
 * end-to-end run, for instance, where the alternative is a blank page and a
 * mystifying test failure.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.connectionString,
    max: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
    idleTimeoutMillis: options.idleTimeoutMillis ?? DEFAULT_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? DEFAULT_CONNECT_TIMEOUT_MS,
  });

  return new PrismaClient({
    adapter,
    log: options.logQueries
      ? [
          { emit: 'stdout', level: 'query' },
          { emit: 'stdout', level: 'warn' },
          { emit: 'stdout', level: 'error' },
        ]
      : [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }],
  });
}

let cached: PrismaClient | undefined;

/**
 * Process-wide client for scripts and for the API.
 *
 * Cached because a Prisma client owns a connection pool: constructing one per
 * request would exhaust Postgres' connection limit. `tsx watch` reloads the
 * module on change, so the cache also keeps repeated reloads from leaking
 * pools during development.
 */
export function getPrismaClient(): PrismaClient {
  if (cached) return cached;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and start the database with `npm run db:dev`.',
    );
  }

  const configuredMax = Number.parseInt(process.env.DATABASE_POOL_MAX ?? '', 10);
  const configuredIdle = Number.parseInt(process.env.DATABASE_IDLE_TIMEOUT_MS ?? '', 10);
  const configuredConnect = Number.parseInt(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? '', 10);

  cached = createPrismaClient({
    connectionString,
    logQueries: process.env.PRISMA_LOG_QUERIES === 'true',
    maxConnections:
      Number.isInteger(configuredMax) && configuredMax > 0 ? configuredMax : DEFAULT_MAX_CONNECTIONS,
    idleTimeoutMillis:
      Number.isInteger(configuredIdle) && configuredIdle > 0
        ? configuredIdle
        : DEFAULT_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis:
      Number.isInteger(configuredConnect) && configuredConnect > 0
        ? configuredConnect
        : DEFAULT_CONNECT_TIMEOUT_MS,
  });
  return cached;
}

export async function disconnectPrisma(): Promise<void> {
  if (!cached) return;
  const client = cached;
  cached = undefined;
  await client.$disconnect();
}

/**
 * Money is stored as `Decimal(10,2)` to avoid binary-float drift on prices.
 * Prisma returns those as Decimal objects, which do not survive JSON
 * serialisation intact, so every value is converted at the API boundary with
 * these helpers rather than ad hoc at each call site.
 */
export function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value == null) return null;
  const asNumber = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(asNumber) ? asNumber : null;
}

/** Same conversion, for columns that are non-nullable in the schema. */
export function requireDecimalToNumber(value: Prisma.Decimal | number): number {
  return decimalToNumber(value) ?? 0;
}
