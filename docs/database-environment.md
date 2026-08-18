# Database environment

## The `template1` problem

**`prisma migrate dev` does not work in this project as currently configured.** It
fails with:

```
Error: P3006
Migration `20260731193020_init` failed to apply cleanly to the shadow database.
Database error code: 42710
Database error: ERROR: type "Availability" already exists
```

### Why

`.env` points the datasource at PostgreSQL's `template1` database:

```
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:51214/template1?sslmode=disable"
```

`template1` is not an ordinary database. PostgreSQL uses it as the **template for
every `CREATE DATABASE`**. Because the application schema was applied *into*
`template1`, every database created on that server inherits the application's
tables and enum types.

`prisma migrate dev` works by creating a temporary *shadow database*, replaying
every migration into it from empty, and diffing the result against
`schema.prisma`. On this server the shadow database is created from `template1`,
so it is **not empty** — it already contains `Availability`, `products`, and
everything else. Replaying `..._init` into it therefore fails on the first
`CREATE TYPE`.

This is a property of the environment, not of any migration. It predates the
Europe feature work.

### What to use instead

Both of these avoid the shadow database entirely and are the commands the Europe
migration was actually produced and applied with:

```bash
# Inspect: what SQL would bring the live database up to schema.prisma?
npm run db:diff                 # read-only; writes nothing, connects read-only

# Apply: run pending migration folders against the live database
npm run db:deploy               # prisma migrate deploy && prisma generate
```

The workflow for a new migration is therefore:

1. Edit `prisma/schema.prisma`.
2. `npm run db:diff > /tmp/next.sql` and **read the SQL in full**.
3. Create `prisma/migrations/<timestamp>_<name>/migration.sql` and paste the SQL,
   reordering by hand if a `DROP` precedes its replacement.
4. `npm run check:migrations` — the automated safety guard (see below).
5. `npm run db:deploy`.
6. Run the data pass, if the feature needs one (e.g. `npm run db:backfill-offers`).

### What NOT to do

- **Do not run `npm run db:reset`.** It calls `prisma migrate reset --force`,
  which drops and recreates the schema. Against `template1` the consequences are
  worse than usual.
- **Do not change `DATABASE_URL` casually to make `migrate dev` work.** Pointing
  at a fresh database silently gives you an *empty* application — the API starts,
  the health check passes, and every search returns nothing. See the follow-up
  task below for how to do it properly.
- **Do not edit an already-applied `migration.sql`.** Prisma records a checksum of
  every applied migration in `_prisma_migrations`; editing one makes
  `migrate deploy` refuse to run.

### Single connection

Unrelated to `template1` but equally load-bearing: the bundled `prisma dev`
database is PGlite behind a socket bridge and **accepts one connection at a
time**, which is why `DATABASE_POOL_MAX=1`. Run the API **or** `db:seed` **or**
the test suite **or** a backfill — never two at once. A second connection is reset
with `ECONNRESET`, and confusingly a trivial health-check query still succeeds
while every real query fails.

### `DATABASE_IDLE_TIMEOUT_MS`

How long the pool keeps an unused connection. **Default 2 000 ms**, deliberately
short: with one connection available, releasing it quickly is what lets another
tool (`db:seed`, the test suite, Prisma Studio, `db:counts`) connect while the API
is running, instead of waiting out node-postgres' 10-second default.

The cost is a reconnect on any request arriving more than two seconds after the
last one. Reconnecting to the socket bridge is normally instant, but under load it
is occasionally slow enough to exhaust `connectionTimeoutMillis` (10 s), which
surfaces as an **intermittent 500 on a perfectly good query** — and, in a browser,
as a blank page.

So raise it whenever nothing else needs the database:

```bash
DATABASE_IDLE_TIMEOUT_MS=120000   # keep the connection instead of reconnecting
```

`playwright.config.ts` sets exactly that for the API it starts, which is why the
end-to-end suite is stable. The API integration tests deliberately run on the
default, so the short-timeout path stays exercised.

---

## Memory fragility under long runs

**Known limitation.** The local Prisma/PGlite development database becomes
unreliable during long test or end-to-end workloads. It has been observed to drop
its connection or disappear entirely part-way through a session, with symptoms
including:

```
prisma:error Connection terminated unexpectedly
Error: Can't reach database server at 127.0.0.1:51214   (code P1001)
DriverAdapterError: DatabaseNotReachable
```

Downstream, the same failure looks like:

- a whole vitest project failing at *suite* level rather than on assertions;
- an API request taking ~10 s and returning 500;
- `webServer` timing out in Playwright, because the API's health check cannot
  reach the database;
- a page that renders its shell with an empty `<main>`.

None of this indicates data loss, and none of it is a reason to reset anything.

### Verified recovery procedure

Run these three, in order, and nothing else concurrently:

```bash
npx prisma dev stop default     # stop the (possibly wedged) server
npm run db:dev                  # start it again, detached
npm run db:counts               # confirm the data and every invariant
```

Notes from having done this several times:

- `prisma dev stop default` may report **"No prisma dev servers found to stop"**.
  That is fine — it means the process had already gone.
- `npm run db:dev` occasionally prints the connection string without the server
  actually staying up. Check with `npm run db:counts`, or look for a listener on
  port 51214; if there is none, run `db:dev` again.
- `db:counts` is the acceptance test, not the connection string. It reports every
  table count plus nine invariants, so it distinguishes "reachable" from "intact".
- `prisma dev status` fails with `No such built-in module: node:sqlite` unless
  `NODE_OPTIONS=--experimental-sqlite` is set; the `db:dev` script passes it, that
  subcommand does not. Use `db:counts` instead.

Every recovery so far has preserved the data exactly: 10 stores, 115 products, 319
offers, 23 548 offer-history rows, 10 320 price-history rows, 71 canonical
products, 6 watchlist items and 12 exchange rates, with all nine invariants OK.

### Recovering from an interrupted test run

A suite killed mid-run never reaches its `afterAll`, so its fixtures stay behind.
Nothing fails — the counts simply drift, and later they no longer match the
documented baseline. Three commands, in order:

```bash
# 1. Restart the database, if it needs it
npx prisma dev stop default
npm run db:dev

# 2. Confirm the data and the invariants
npm run db:counts

# 3. Detect fixtures the crashed run left behind
npm run db:check-test-fixtures
```

`db:check-test-fixtures` is **read-only**. It exits `0` when the database holds
only seeded and demo data, and non-zero with the exact ids when it does not:

```
Found 7 orphaned test-fixture row(s).

Store  (normally removed by: createTestContext().cleanup())
  cmsx07bsv0002w8wt8p0ps11u  test-store-verify99 "Test Store verify99" (1 product(s))
Product  (normally removed by: createTestContext().cleanup())
  cmsx07bxm0004w8wtvj4l5tmf  TestBrandverify99 · Test product p-verify99 · store=test-store-verify99
…
```

It checks `Store`, `Product`, `CanonicalProduct`, `StoreOffer`,
`StoreOfferPriceHistory`, `PriceHistory`, `ProductMatchCandidate`,
`WatchlistItem`, `Notification`, `User` and `ExchangeRate`, using only the
prefixes the fixtures themselves establish — `test-…` slugs, `TestBrand…` brands,
`testbrand…` canonical keys, `test-<uuid8>@dealfinder.test` users, and exchange
rates not stamped midnight UTC (the seed always truncates to the day).

Two things it deliberately does not do:

- **It never deletes.** Removing rows from a shared database on the strength of a
  name pattern is how a cleanup script eventually eats real data. The report gives
  you the ids; the removal is yours, and is auditable.
- **It never treats demo data as a test fixture.** Seven of the ten stores are
  synthetic, and *synthetic* is not *leaked*. Confusing the two would have this
  command propose deleting most of the catalogue.

Removing what it reports: delete the `Product` rows first (price history, offers,
offer history, watchlist items, notifications and match candidates cascade from
them), then the `CanonicalProduct`, then the `Store`, then the `User` — the order
`createTestContext().cleanup()` uses, and for the same reason: a product still
pointing at a canonical record blocks its delete.

**Never `db:reset`.** It destroys the seeded catalogue the report is trying to
protect.

### Reducing the chance of hitting it

- **One database consumer at a time.** Do not run `npm test` and `npm run test:e2e`
  together, and do not seed while either is running.
- **Run the heavy suites separately.** `npm test -w @deal-finder/api` and
  `npm run test:e2e` are the two that stress it.
- **Raise `DATABASE_IDLE_TIMEOUT_MS`** for long runs, so the connection is held
  rather than re-established hundreds of times.
- **Do not seed to "fix" it.** A reseed is neither necessary nor sufficient; the
  three commands above are the fix.
- **Run `db:check-test-fixtures` after any interrupted run**, so a leak is found
  while its cause is still obvious rather than weeks later as a puzzling count.

### What not to do

**Never use `db:reset` as a recovery step.** It calls
`prisma migrate reset --force`, which drops and recreates the schema — it destroys
the data that the recovery procedure above preserves, and against `template1` the
consequences are worse than usual. The same applies to `prisma migrate reset` and
`prisma db push --force-reset` in any form.

---

## The end-to-end database is a separate instance

`npm run test:e2e` does **not** use the development database. It uses a dedicated
`prisma dev` instance called `dealfinder-e2e`, with its own storage, its own
query-insights stream and its own process.

```bash
npm run db:e2e:prepare     # create/start it, apply migrations, seed, verify
npm run test:e2e           # picks it up automatically via .env.e2e
npm run db:e2e:stop        # stop it (the development instance keeps running)
```

### Why

The shared instance degraded under sustained end-to-end load. Observed directly:
after a full suite the daemon began accepting a connection and immediately
resetting it, then refusing connections altogether, and finally exited — while
`prisma dev ls` still reported `running` and the ports still showed as listening.
Downstream that looked like `Connection terminated unexpectedly`, a page that
rendered its shell with an empty `<main>`, and
`Timed out waiting 120000ms from config.webServer`. None of it is an assertion
failure, and all of it reads like one.

Running the suite against its own instance removed the whole class of failure:
three consecutive 27-test runs with the daemon holding one PID throughout, no
refused connection, no stalled request and no `webServer` timeout.

### This database is disposable

Treat it as test infrastructure, not as data. It is *meant* to be thrown away:

```bash
npx prisma dev rm dealfinder-e2e --force && npm run db:e2e:prepare
```

That is the point of the split. The development database cannot be reset without
destroying the seeded catalogue, so recovering it means the careful non-destructive
procedure above. This one can be rebuilt in a minute, which is also how its
query-insights store is kept small — the shared instance's had reached 6.4 GB
against 219 MB of actual data, and recreating an instance sidesteps any question
of whether deleting Prisma's internal files by hand is supported.

**It must never share state with the development database.** No suite writes to
`.env`'s database, and nothing seeds both from one command.

### The port cannot be written down

`prisma dev` **ignores** `--port`, `--db-port` and `--shadow-db-port` in the
installed version (v0.16.27). It auto-allocates the next free block per instance,
so the database port depends on what was already running when the instance was
created — asking for 51314 and getting 51218 is normal, and the numbers differ
between machines.

`db:e2e:prepare` therefore *discovers* the port from the instance's own
`server.json` after starting it, and generates `.env.e2e` from that.
**No committed file hard-codes the port.** To read it by hand:

```bash
npx prisma dev ls
```

### How Playwright resolves the database

`playwright.config.ts`, in order:

1. `E2E_DATABASE_URL`, if set — redirects a single run without editing anything.
2. `DATABASE_URL` from `.env.e2e`, if that file exists (it is gitignored; commit
   nothing but `.env.e2e.example`).
3. Neither: the API inherits `.env` exactly as before, so a checkout with no E2E
   instance still works.

When a URL is found it is applied in **two** places, which matters more than it
looks. The API `webServer` gets it, and so does the Playwright worker process —
because the notification ledger cleanup in `e2e/main-flow.spec.ts` reaches the
database directly rather than through the API. Setting only the `webServer` env
left that sweep talking to `.env`'s database, where the recorded id does not
exist: it reported nothing to delete, cleared the ledger, and the `TEST` row
survived in the E2E database. Cleanup that silently targets the wrong database is
worse than no cleanup, because the ledger then claims to be done.

`workers: 1`, `MONITOR_ENABLED=false` and `DATABASE_POOL_MAX=1` are unchanged and
still required: PGlite accepts one active connection at a time and queues the rest.

---

## Migration safety guard

`apps/api/tests/migration-safety.test.ts` reads every committed `migration.sql`
as text and asserts:

- no `DROP TABLE`
- no `DROP COLUMN`
- no `TRUNCATE`
- no destructive `ALTER COLUMN` — no retype, no `DROP DEFAULT`, no `SET NOT NULL`
  without a default
- the **only** permitted `DROP` in the repository is
  `DROP INDEX "watchlist_items_userId_productId_key"`, listed explicitly with its
  justification
- in the Europe migration, the four-column replacement index is created **before**
  that drop, so `watchlist_items` is never left without a uniqueness constraint

Run it alone with `npm run check:migrations`; it also runs as part of `npm test`.

The guard's own predicates are tested against synthetic SQL, including the exact
drop-before-create ordering Prisma originally generated. A safety net that has
never been shown to catch anything is indistinguishable from one with a typo in
its regex — and the real migrations cannot be mutated to prove it, because of the
checksum.

### Why the ordering was hand-edited

Prisma generated the `DROP INDEX` as the **second** statement in the Europe
migration, before the replacement index existed. That would leave a window,
however brief, in which no uniqueness constraint protected `watchlist_items`. The
statements were reordered so the new index is created first and the old one
dropped last; between those points both are enforced.

The new constraint is **destination-aware, not stricter**. It deliberately admits
several rows for one `(userId, productId)` so Finland and Germany can be tracked
independently. Every row valid under the old constraint stays valid, because the
two new key columns are `NOT NULL DEFAULT 'FI'` / `'EUR'`.

---

## Follow-up task: move off `template1`

**Not part of the Europe feature. Do this as its own change, with its own
verification.**

### Goal

Run the application against a dedicated database (`dealfinder_dev`) with a
separate clean shadow database, so `prisma migrate dev` works normally and the
shadow database stops inheriting the application schema.

### Why it is deferred

Mixing a datasource migration into a feature branch means that if anything goes
wrong, it is ambiguous whether the feature or the move broke it. The two need
independent verification, and the move needs a backup step that a feature branch
has no reason to include.

### Sketch

1. **Back up first.** `pg_dump` the current schema and data to a file, and record
   the row counts you expect to see afterwards:
   `products`, `stores`, `price_history`, `canonical_products`, `watchlist_items`,
   `saved_searches`, `notifications`, `store_offers`, `store_offer_price_history`,
   `countries`, `exchange_rates`.
2. Create `dealfinder_dev` **from `template0`**, not `template1` — that is the
   whole point, and using `template1` would reproduce the problem.
3. Restore the dump into `dealfinder_dev`.
4. Point `DATABASE_URL` at `dealfinder_dev` and set `SHADOW_DATABASE_URL` to a
   separate database, also created from `template0`.
5. Verify **every** row count matches step 1 before doing anything else. A
   restore that silently dropped a table looks exactly like a working application
   until someone searches for the missing data.
6. Confirm `prisma migrate dev` now succeeds against a scratch no-op migration,
   then delete that migration.
7. Consider cleaning the application's tables and types out of `template1`, so
   future databases on this server start genuinely empty. Only after steps 1–6
   have been verified.

### Acceptance

- `npm run typecheck`, `npx eslint .`, `npm test`, `npm run test:e2e`,
  `npm run build` all pass.
- Row counts match the pre-move record exactly.
- `prisma migrate dev` creates and applies a scratch migration without a shadow
  database error.
- `npm run db:diff` reports no drift between the schema and the database.
