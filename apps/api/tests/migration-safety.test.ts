import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration safety net.
 *
 * Every migration in this repository must be additive. The one exception is the
 * `watchlist_items` uniqueness swap in `20260803120000_europe_destination_offers`,
 * which replaces a two-column constraint with a destination-aware four-column one
 * — and even that must create the replacement *before* retiring the original, so
 * the table is never left without a uniqueness constraint.
 *
 * That ordering was produced by hand: Prisma generated the `DROP INDEX` as the
 * second statement in the file, before the replacement existed. A future
 * `prisma migrate dev` run, or an innocent-looking tidy-up of the file, would
 * silently undo the fix. This test is what makes that undo fail loudly.
 *
 * It lives in `apps/api/tests` because that is a workspace `npm test` already
 * runs in a node environment. It touches no database and needs none — it reads
 * the committed SQL as text.
 *
 * Run in isolation with `npm run check:migrations`.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', '..', 'prisma', 'migrations');

/**
 * The only `DROP` any migration in this repository is permitted to contain.
 *
 * Dropping an index removes no rows. Adding anything to this list means asserting
 * that a destructive statement is intentional, which should require an argument
 * in review rather than a passing test.
 */
const ALLOWED_DROPS = [
  {
    migration: '20260803120000_europe_destination_offers',
    statement: 'DROP INDEX "watchlist_items_userId_productId_key"',
    reason:
      'Superseded by the four-column destination-aware unique index, which is created first.',
  },
] as const;

interface Migration {
  name: string;
  sql: string;
  statements: string[];
}

/**
 * Split SQL into normalised statements.
 *
 * Comments are stripped first: they legitimately mention DROP while explaining
 * why one is safe, and scanning them as statements would make the prose trip the
 * guard.
 */
export function parseStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter((statement) => statement.length > 0);
}

/**
 * The destructive-statement rules, as pure predicates over parsed statements.
 *
 * Extracted so the guard itself can be tested against synthetic SQL. A safety net
 * that has never been shown to catch anything is indistinguishable from one with
 * a typo in its regex — and the real migrations cannot be edited to prove it,
 * because Prisma records a checksum of every applied migration.
 */
export function findDestructiveStatements(statements: readonly string[]): string[] {
  return statements.filter(
    (statement) =>
      /^DROP\s+TABLE/i.test(statement) ||
      /DROP\s+COLUMN/i.test(statement) ||
      /\bTRUNCATE\b/i.test(statement) ||
      /ALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE/i.test(statement) ||
      /ALTER\s+COLUMN\s+"?\w+"?\s+DROP\s+DEFAULT/i.test(statement) ||
      (/ALTER\s+COLUMN\s+"?\w+"?\s+SET\s+NOT\s+NULL/i.test(statement) &&
        !/SET\s+DEFAULT/i.test(statement)),
  );
}

/**
 * Whether every index drop is preceded by the creation of a replacement.
 *
 * "Replacement" is matched loosely — any CREATE UNIQUE INDEX on the same table
 * earlier in the file. The point is not to prove the new constraint is equivalent
 * (it deliberately is not; it is wider) but that the table is never left with no
 * uniqueness constraint at all.
 */
export function findUnprotectedIndexDrops(statements: readonly string[]): string[] {
  const offenders: string[] = [];

  statements.forEach((statement, position) => {
    const dropped = /^DROP\s+INDEX\s+"([^"]+)"/i.exec(statement);
    if (dropped == null) return;

    const droppedName = dropped[1] ?? '';
    // Derive the table from the index name's conventional prefix.
    const table = droppedName.split('_')[0] ?? '';

    const replacedEarlier = statements
      .slice(0, position)
      .some(
        (earlier) =>
          /^CREATE\s+UNIQUE\s+INDEX/i.test(earlier) &&
          earlier.includes(table) &&
          !earlier.includes(`"${droppedName}"`),
      );

    if (!replacedEarlier) offenders.push(statement);
  });

  return offenders;
}

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((entry) => statSync(join(MIGRATIONS_DIR, entry)).isDirectory())
    .sort()
    .map((name) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
      return { name, sql, statements: parseStatements(sql) };
    });
}

const migrations = loadMigrations();

/** The initial migration creates the world; "additive" is not meaningful for it. */
const INITIAL_MIGRATION = '20260731193020_init';
const incremental = migrations.filter((migration) => migration.name !== INITIAL_MIGRATION);

describe('migration safety', () => {
  it('finds the migrations directory and every expected migration', () => {
    expect(migrations.length).toBeGreaterThanOrEqual(3);
    expect(migrations.map((migration) => migration.name)).toContain(
      '20260803120000_europe_destination_offers',
    );
  });

  it.each(incremental.map((migration) => migration.name))(
    '%s contains no DROP TABLE',
    (name) => {
      const migration = incremental.find((entry) => entry.name === name);
      const offenders = migration!.statements.filter((statement) =>
        /^DROP\s+TABLE/i.test(statement),
      );
      expect(offenders).toEqual([]);
    },
  );

  it.each(incremental.map((migration) => migration.name))(
    '%s contains no DROP COLUMN',
    (name) => {
      const migration = incremental.find((entry) => entry.name === name);
      const offenders = migration!.statements.filter((statement) =>
        /DROP\s+COLUMN/i.test(statement),
      );
      expect(offenders).toEqual([]);
    },
  );

  it.each(incremental.map((migration) => migration.name))('%s contains no TRUNCATE', (name) => {
    const migration = incremental.find((entry) => entry.name === name);
    const offenders = migration!.statements.filter((statement) => /\bTRUNCATE\b/i.test(statement));
    expect(offenders).toEqual([]);
  });

  it.each(incremental.map((migration) => migration.name))(
    '%s contains no destructive ALTER COLUMN',
    (name) => {
      const migration = incremental.find((entry) => entry.name === name);

      // Retyping a populated column can silently truncate or fail; forcing NOT
      // NULL without a default fails outright on any existing row that is null.
      const retyped = migration!.statements.filter((statement) =>
        /ALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE/i.test(statement),
      );
      expect(retyped).toEqual([]);

      const forcedNotNull = migration!.statements.filter(
        (statement) =>
          /ALTER\s+COLUMN\s+"?\w+"?\s+SET\s+NOT\s+NULL/i.test(statement) &&
          !/SET\s+DEFAULT/i.test(statement),
      );
      expect(forcedNotNull).toEqual([]);

      const droppedDefault = migration!.statements.filter((statement) =>
        /ALTER\s+COLUMN\s+"?\w+"?\s+DROP\s+DEFAULT/i.test(statement),
      );
      expect(droppedDefault).toEqual([]);
    },
  );

  it('contains no DROP anywhere except the explicitly allowed ones', () => {
    const found = migrations.flatMap((migration) =>
      migration.statements
        .filter((statement) => /\bDROP\b/i.test(statement))
        .map((statement) => ({ migration: migration.name, statement })),
    );

    const unexpected = found.filter(
      (entry) =>
        !ALLOWED_DROPS.some(
          (allowed) =>
            allowed.migration === entry.migration && entry.statement === allowed.statement,
        ),
    );

    expect(unexpected).toEqual([]);
  });

  it('has exactly one DROP in the Europe migration, and it is the watchlist index', () => {
    const migration = migrations.find(
      (entry) => entry.name === '20260803120000_europe_destination_offers',
    );
    expect(migration).toBeDefined();

    const drops = migration!.statements.filter((statement) => /\bDROP\b/i.test(statement));
    expect(drops).toEqual(['DROP INDEX "watchlist_items_userId_productId_key"']);
  });
});

describe('the watchlist uniqueness swap', () => {
  const migration = migrations.find(
    (entry) => entry.name === '20260803120000_europe_destination_offers',
  );

  function indexOfStatement(pattern: RegExp): number {
    return migration!.statements.findIndex((statement) => pattern.test(statement));
  }

  it('creates the four-column replacement index', () => {
    const created = indexOfStatement(
      /CREATE UNIQUE INDEX "watchlist_items_user_product_destination_key"/i,
    );
    expect(created).toBeGreaterThanOrEqual(0);
    expect(migration!.statements[created]).toContain('"userId", "productId"');
    expect(migration!.statements[created]).toContain('"destinationCountry", "preferredCurrency"');
  });

  it('creates the replacement BEFORE dropping the original', () => {
    // The invariant this whole file exists for. Prisma emits these the other way
    // round, which would leave a window with no uniqueness protection at all.
    const created = indexOfStatement(
      /CREATE UNIQUE INDEX "watchlist_items_user_product_destination_key"/i,
    );
    const dropped = indexOfStatement(/DROP INDEX "watchlist_items_userId_productId_key"/i);

    expect(created).toBeGreaterThanOrEqual(0);
    expect(dropped).toBeGreaterThanOrEqual(0);
    expect(created).toBeLessThan(dropped);
  });

  it('adds the two new key columns as NOT NULL with defaults, before either index', () => {
    // Without defaults the ADD COLUMN would fail on existing rows; without NOT
    // NULL, Postgres would treat NULLs as distinct and the new unique index would
    // permit two rows with no destination — destroying the guarantee it creates.
    const added = indexOfStatement(/ALTER TABLE "watchlist_items" ADD COLUMN/i);
    const created = indexOfStatement(
      /CREATE UNIQUE INDEX "watchlist_items_user_product_destination_key"/i,
    );

    expect(added).toBeGreaterThanOrEqual(0);
    expect(added).toBeLessThan(created);

    const statement = migration!.statements[added]!;
    expect(statement).toMatch(/"destinationCountry" TEXT NOT NULL DEFAULT 'FI'/);
    expect(statement).toMatch(/"preferredCurrency" TEXT NOT NULL DEFAULT 'EUR'/);
  });

  it('keeps the hand-written ordering comment, so the reason survives a refactor', () => {
    expect(migration!.sql).toMatch(/STATEMENT ORDER IS LOAD-BEARING/);
  });
});

/**
 * Proof the guard above can actually fail.
 *
 * The real migration files cannot be mutated to demonstrate this — Prisma records
 * a checksum of every applied migration, so editing one would break
 * `migrate deploy` for everybody. So the predicates are exercised directly
 * against synthetic SQL instead.
 */
describe('the guard itself', () => {
  it('ignores DROP mentioned only in a comment', () => {
    const sql = [
      '-- This migration deliberately avoids DROP TABLE and TRUNCATE.',
      'ALTER TABLE "products" ADD COLUMN "x" TEXT;',
    ].join('\n');

    expect(findDestructiveStatements(parseStatements(sql))).toEqual([]);
  });

  it.each([
    ['DROP TABLE', 'DROP TABLE "products";'],
    ['DROP COLUMN', 'ALTER TABLE "products" DROP COLUMN "currentPrice";'],
    ['TRUNCATE', 'TRUNCATE TABLE "products";'],
    ['retype', 'ALTER TABLE "products" ALTER COLUMN "currentPrice" TYPE INTEGER;'],
    ['set data type', 'ALTER TABLE "products" ALTER COLUMN "currentPrice" SET DATA TYPE INTEGER;'],
    ['forced not null', 'ALTER TABLE "products" ALTER COLUMN "brand" SET NOT NULL;'],
    ['dropped default', 'ALTER TABLE "stores" ALTER COLUMN "region" DROP DEFAULT;'],
  ])('catches %s', (_label, statement) => {
    expect(findDestructiveStatements(parseStatements(statement))).toHaveLength(1);
  });

  it('permits SET NOT NULL when a default is set in the same statement', () => {
    const sql = 'ALTER TABLE "x" ALTER COLUMN "y" SET NOT NULL, ALTER COLUMN "y" SET DEFAULT 1;';
    expect(findDestructiveStatements(parseStatements(sql))).toEqual([]);
  });

  it('catches an index drop with no replacement created first', () => {
    const sql = [
      'DROP INDEX "watchlist_items_userId_productId_key";',
      'CREATE UNIQUE INDEX "watchlist_items_user_product_destination_key" ON "watchlist_items"("userId");',
    ].join('\n');

    // This is exactly what Prisma generated, and exactly what must never ship.
    expect(findUnprotectedIndexDrops(parseStatements(sql))).toHaveLength(1);
  });

  it('accepts an index drop that follows its replacement', () => {
    const sql = [
      'CREATE UNIQUE INDEX "watchlist_items_user_product_destination_key" ON "watchlist_items"("userId");',
      'DROP INDEX "watchlist_items_userId_productId_key";',
    ].join('\n');

    expect(findUnprotectedIndexDrops(parseStatements(sql))).toEqual([]);
  });

  it('confirms the committed Europe migration passes the ordering predicate', () => {
    const europe = migrations.find(
      (entry) => entry.name === '20260803120000_europe_destination_offers',
    );
    expect(findUnprotectedIndexDrops(europe!.statements)).toEqual([]);
  });

  it('confirms every committed migration passes the destructive predicate', () => {
    for (const migration of incremental) {
      expect(findDestructiveStatements(migration.statements)).toEqual([]);
    }
  });
});
