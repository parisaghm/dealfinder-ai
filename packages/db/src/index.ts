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

export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.connectionString,
    max: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
    // Release the connection quickly when idle. With the one-connection dev
    // database this is what lets another tool (`db:seed`, the test suite,
    // Prisma Studio) connect while the API is running, instead of waiting out
    // node-postgres' 10-second default.
    idleTimeoutMillis: 2_000,
    connectionTimeoutMillis: 10_000,
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

  cached = createPrismaClient({
    connectionString,
    logQueries: process.env.PRISMA_LOG_QUERIES === 'true',
    maxConnections:
      Number.isInteger(configuredMax) && configuredMax > 0 ? configuredMax : DEFAULT_MAX_CONNECTIONS,
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
