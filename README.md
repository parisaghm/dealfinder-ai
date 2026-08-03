# DealFinder AI

**Find real discounts, not just sale labels.**

A shopping-discount discovery and price-alert platform. It searches products
across several stores, records what each product has *actually* cost over time,
and uses that history to judge whether a discount is genuine — because a
crossed-out price is a marketing claim, not evidence.

The MVP covers **electronics sold in Finland** (Gigantti, Power,
Verkkokauppa.com) and is architected so other markets — cars, cottages,
flights, hotels, courses, apartments, event tickets — can be added without
migrating core tables or touching search, scoring or alerting.

---

## Contents

- [What it does](#what-it-does)
- [The core idea: deal quality](#the-core-idea-deal-quality)
- [Technology](#technology)
- [Architecture](#architecture)
- [Project layout](#project-layout)
- [Setup](#setup)
- [Environment variables](#environment-variables)
- [Database](#database)
- [Running the app](#running-the-app)
- [How store providers work](#how-store-providers-work)
- [How scheduled monitoring works](#how-scheduled-monitoring-works)
- [Email alerts](#email-alerts)
- [Authentication](#authentication)
- [Testing](#testing)
- [Adding a new vertical](#adding-a-new-vertical)
- [Current limitations](#current-limitations)
- [Legal and ethical considerations](#legal-and-ethical-considerations)
- [Future improvements](#future-improvements)
- [Design and implementation decisions](#design-and-implementation-decisions)

---

## What it does

| Feature | Notes |
|---|---|
| **Search across stores** | One query covers every configured store. Accepts whole sentences — "Laptop under €1,000", "Philips headphones with at least 30% discount" — and shows you how it interpreted them. |
| **Filter and sort** | Maximum price, minimum discount, category, store; sort by best discount, lowest price, highest price or most recently updated. |
| **Price history** | Every observed price change is recorded and charted, with the lowest, highest and average clearly marked. |
| **Deal quality** | An explainable 0–100 score with a plain-language label, the factors behind it, and a stated confidence level. |
| **Fake-discount detection** | Flags a "sale" whose price matches what the product normally costs, or an "original price" that was never actually charged. |
| **Watchlist** | Track products, set a target price, see the gap, pause/resume monitoring. |
| **Price alerts** | A scheduled job checks tracked products and emails you when a target is reached — once, not repeatedly. |
| **Dashboard** | Tracked products, active alerts, deals found this week, estimated savings, recent price changes, alert history, saved searches. |
| **Settings** | Email address, notification preferences, check frequency, preferred stores and categories, currency, and controls to clear your data. |

## The core idea: deal quality

Most price sites repeat whatever the store says. This one weighs the claim
against recorded history and shows its working.

Six weighted factors produce a 0–100 score:

| Factor | Weight | What it measures |
|---|---:|---|
| Advertised discount | 30 | The store's claim — **scored on evidence, not taken at face value** |
| Compared to its usual price | 24 | How far below the recorded average it sits |
| Compared to its best price | 24 | How close it is to the lowest we have recorded |
| Recent price direction | 10 | Falling, rising or flat across recent checks |
| Delivery cost | 6 | Shipping as a share of the item price |
| Availability | 6 | An out-of-stock price cannot be acted on |

Labels: **Excellent deal** (≥75) · **Good deal** (≥55) · **Average price** (≥35)
· **Price increased** (a rise above the noise floor, when the deal is not
otherwise strong).

Two things make it honest rather than decorative:

1. **An unsupported claim earns nothing.** If our records contradict the
   crossed-out price, the discount factor scores **0** and the reason is shown.
   A permanent "50% off" that has never actually been cheaper therefore lands on
   *Average price*, not *Excellent deal*.
2. **Confidence is explicit.** With little history, the history-based factors
   score neutrally and the UI says the assessment is weakly supported, instead of
   implying certainty it does not have.

Every assessment travels with a disclaimer: this is an automated heuristic based
on recorded prices, **not financial advice**. See
[`docs/deal-quality.md`](docs/deal-quality.md) for the full method and worked
examples.

## Technology

React 19 · TypeScript 5.9 · Vite 8 · Tailwind CSS 4 · React Router 7 ·
React Query 5 · Recharts 3 · Node 22 · Express 5 · PostgreSQL 17 · Prisma 7 ·
Playwright 1.62 · Zod 4 · Nodemailer 9 · node-cron 4 · Vitest 4 · pino 10

## Architecture

Dependencies point one way only:

```
packages/shared          pure types, Zod schemas, pricing & scoring maths
        ▲                          (no I/O, no React, no database)
        │
packages/store-providers  store integrations behind one interface
        ▲
packages/db               Prisma client + the single price-writing path
        ▲
apps/api                  Express REST API, cron scheduler, email
        ▲
apps/web                  React client        packages/ui  presentation-only
```

Four decisions carry most of the weight:

**1. Pricing logic is pure and shared.** Discount arithmetic, history
statistics and deal-quality scoring live in `packages/shared` with no I/O. The
API and the browser import the *same* functions, so a card in the grid can never
disagree with the details page — and the logic is unit-tested without standing
anything up.

**2. One schema validates both directions.** The server validates requests with
a Zod schema and the browser re-parses the response with the *same* schema. A
contract drift fails loudly at the boundary instead of surfacing as
`undefined.toFixed()` inside a component.

**3. Scraping cannot leak.** Nothing above `packages/store-providers` knows
whether data came from a fixture, an official API, embedded JSON-LD or a
headless browser. That is what makes those choices changeable one file at a
time — and keeps the most legally sensitive code in one reviewable place.

**4. Sorting and filtering happen in SQL.** `Product.discountPercent` is a
maintained derived column, so `minimumDiscount` filtering and `best-discount`
sorting are indexed database operations applied *before* pagination. Sorting a
page in application code would silently reorder within pages and produce wrong
results. Every write goes through one helper
(`packages/db/src/ingestion.ts`), so the column cannot drift.

More detail in [`docs/architecture.md`](docs/architecture.md), and for how
listings from different stores become one product,
[`docs/product-matching.md`](docs/product-matching.md).

### Database

```
User 1─┬─* WatchlistItem *─1 Product *─1 Store
       ├─* SavedSearch                 └─* PriceHistory
       ├─* Notification *─0..1 Product
       └─1 UserSettings
```

Money is stored as `Decimal(10,2)` (no binary-float drift) and converted to
`number` in one mapper layer at the API boundary. Indexes cover every query the
app actually issues: `(storeId, externalId)` unique for idempotent ingestion,
plus `category`, `(vertical, category)`, `currentPrice`, `discountPercent`,
`lastCheckedAt`, `brand`, and `(productId, recordedAt)` on price history.

Two documented additions to the original specification:

- **`UserSettings`** as its own table rather than JSON on `User`, so the
  monitoring job can filter on `checkFrequency` and `notifyByEmail` in SQL
  instead of loading and parsing every user's preferences.
- **`Notification.priceAtAlert`**, because "do not alert twice for the same
  unchanged price" otherwise requires re-parsing the message text.

## Project layout

```
├─ apps/
│  ├─ api/                  Express API, cron scheduler, email
│  │  ├─ src/{routes,services,middleware,mappers,email,jobs}/
│  │  └─ tests/             API integration + monitoring tests
│  └─ web/                  React client
│     └─ src/{pages,components,lib,test}/
├─ packages/
│  ├─ shared/               types · Zod schemas · pricing · verticals
│  ├─ db/                   Prisma client · ingestion (the only price writer)
│  ├─ store-providers/      StoreProvider interface · mock + live adapters
│  └─ ui/                   presentation-only design system
├─ prisma/                  schema · migrations · seed
├─ e2e/                     Playwright end-to-end suite
├─ docs/                    architecture · deal-quality · providers · legal
└─ docker-compose.yml       PostgreSQL (optional — see below)
```

## Setup

Requires **Node ≥ 22.12** and npm. Docker is **optional**.

```bash
npm install
cp .env.example .env
npm run db:dev             # starts a local PostgreSQL — no Docker needed
npm run db:deploy          # applies migrations, then generates the client
npm run db:seed            # ~58 products with recorded price observations
npm run db:backfill-offers # destination-aware offers for existing products
npm run dev                # API on :4000, web on :5173
```

Open <http://localhost:5173>.

> **`npm run db:migrate` does not work in this environment.** `DATABASE_URL`
> points at `template1`, which PostgreSQL uses as the template for every new
> database, so Prisma's shadow database is created non-empty and replaying the
> initial migration into it fails. Use `db:deploy` to apply and `db:diff` to
> inspect — both avoid the shadow database. Full explanation, the migration
> workflow, and the follow-up task to move onto a dedicated `dealfinder_dev`
> database are in **[docs/database-environment.md](docs/database-environment.md)**.

### Two ways to run PostgreSQL

**A. No Docker (default).** `npm run db:dev` starts Prisma 7's bundled local
PostgreSQL 17 server. Nothing to install.

Three things about it are worth knowing, because each one produces a confusing
failure if you hit it unaware:

- **Use `127.0.0.1`, not `localhost`.** The server binds IPv4 only, and Node on
  Windows resolves `localhost` to `::1` first → `ECONNREFUSED`.
- **Keep `DATABASE_POOL_MAX=1`.** It is PGlite behind a socket bridge and
  accepts **one connection at a time**. A larger pool fails with `ECONNRESET`
  as soon as two requests overlap — and fails misleadingly, since a trivial
  health check still succeeds while every real query dies.
- **One tool at a time.** Because of the single connection, run the API *or*
  `db:seed` *or* the test suite — not several at once. The pool releases idle
  connections after 2 seconds, so switching is quick.
- On Node 22.12 the `prisma dev` helper needs `--experimental-sqlite`; the npm
  script already passes it.

**B. Docker / a real PostgreSQL server.** Removes all of the above.

```bash
docker compose up -d
# then in .env:
DATABASE_URL="postgresql://dealfinder:dealfinder@127.0.0.1:5432/dealfinder?schema=public"
DATABASE_POOL_MAX=10
npm run db:migrate && npm run db:seed
```

## Environment variables

Every variable is validated by Zod at API boot
([`apps/api/src/env.ts`](apps/api/src/env.ts)); the process exits with a list of
exactly what is wrong rather than misbehaving later. A malformed `MONITOR_CRON`
is rejected at startup instead of silently never firing.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | local dev server | PostgreSQL connection string |
| `DATABASE_POOL_MAX` | `1` | Pool size — see the note above |
| `API_PORT` / `API_HOST` | `4000` / `0.0.0.0` | API bind address |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `APP_URL` | `http://localhost:5173` | Base URL used in alert emails |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `120` | Rate limiting |
| `DEV_USER_EMAIL` / `DEV_USER_NAME` | `demo@dealfinder.test` | Development user |
| `PROVIDER_MODE` | `mock` | `mock` or `live` — read the legal notes first |
| `PROVIDER_TIMEOUT_MS` | `10000` | Per-request provider timeout |
| `PROVIDER_MAX_RETRIES` | `2` | Bounded retries (never on 4xx) |
| `PROVIDER_MAX_CONCURRENCY` | `3` | Simultaneous provider requests |
| `PROVIDER_MOCK_FAILURE_RATE` | `0` | Inject failures to exercise error paths |
| `MONITOR_ENABLED` | `true` | Master switch for the scheduler |
| `MONITOR_CRON` | `*/30 * * * *` | Check schedule (validated at boot) |
| `MONITOR_BATCH_SIZE` | `25` | Items per run |
| `ALERT_COOLDOWN_HOURS` | `12` | Minimum gap between alerts per item |
| `EMAIL_TRANSPORT` | `stream` | `stream` \| `json` \| `smtp` |
| `EMAIL_FROM`, `EMAIL_OUTPUT_DIR`, `SMTP_*` | — | Email delivery |
| `LOG_LEVEL` | `info` | pino level |
| `VITE_API_URL` | — | Empty uses the dev proxy (same-origin) |

`.env` is gitignored. No credentials are committed.

## Running the app

| Command | Description |
|---|---|
| `npm run dev` | API + web together |
| `npm run dev:api` / `npm run dev:web` | Individually |
| `npm run build` | Production build of both |
| `npm start` | Run the built API |
| `npm run typecheck` | TypeScript across every workspace |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run db:dev` / `db:dev:stop` | Start/stop the local database |
| `npm run db:deploy` / `db:diff` | Apply migrations / inspect pending SQL ([why not `db:migrate`](docs/database-environment.md)) |
| `npm run db:seed` / `db:backfill-offers` / `db:match` / `db:studio` | Database tasks |
| `npm run check:migrations` | Assert every migration is additive and safely ordered |
| ~~`npm run db:reset`~~ | **Do not run.** Drops the schema; see [docs/database-environment.md](docs/database-environment.md) |
| `npm test` | Unit + API + component suites |
| `npm run test:e2e` | Playwright end-to-end |

### API

```
GET    /api/health                     dependency-checked health
GET    /api/meta                       stores + vertical taxonomy for the filter UI
GET    /api/deals                      query maximumPrice minimumDiscount
                                       category stores sort page limit
GET    /api/products/:id
GET    /api/products/:id/history        ?days=90
GET    /api/watchlist                  POST · PATCH /:id · DELETE /:id
GET    /api/saved-searches             POST · PATCH /:id · DELETE /:id
GET    /api/dashboard
GET    /api/settings                   PATCH · POST /clear-data
POST   /api/alerts/test
```

Errors always use one envelope, including a request id that also appears in the
server logs:

```json
{ "error": { "code": "BAD_REQUEST", "message": "Invalid request query.",
             "details": { "issues": [...] }, "requestId": "…" } }
```

## How store providers work

Every integration implements one interface:

```ts
interface StoreProvider {
  name: string;
  slug: string;
  vertical: string;
  sourceKind: 'mock' | 'api' | 'structured-data' | 'browser';
  searchProducts(query: ProductSearchInput): Promise<ExternalProduct[]>;
  getProductDetails(url: string): Promise<ExternalProductDetails>;
}
```

`createProviderRegistry()` picks the implementations from `PROVIDER_MODE`, and
`searchAll()` queries stores concurrently while **isolating failures**: a store
that is down degrades the result set instead of failing the request. Provider
output is validated with Zod at the boundary, and an individual malformed row is
dropped rather than poisoning the batch.

**Mock mode (default).** Bundled catalogues for the three stores: 42 products
with deterministic synthetic price history, seeded from a hash of each product
id so `db:reset` is byte-for-byte reproducible. The dataset deliberately
includes a permanent fake "sale", a rising price, genuine all-time lows,
volatile pricing, an out-of-stock item and unpublished shipping costs — so the
scoring is visible on first run rather than every product looking alike. Latency
and failure injection are configurable.

**Live mode.** Off by default. Prefers `schema.org/Product` JSON-LD over DOM
scraping (deliberate, stable, and far lighter on the store than rendering their
site), falling back to Playwright only for client-rendered pages. robots.txt is
fetched and obeyed before every request, failing closed. **Live keyword search
is intentionally not implemented** — crawling a store's search results to build
a catalogue is the least defensible thing this system could do, and an affiliate
feed provides the same data with permission. Live mode refreshes *known*
products, which is what price tracking actually needs.

See [`docs/store-providers.md`](docs/store-providers.md).

## How scheduled monitoring works

`node-cron` runs [`price-check`](apps/api/src/services/monitoring.service.ts) on
`MONITOR_CRON`. For each active watchlist item it:

1. skips the item unless the user's `checkFrequency` interval has elapsed;
2. asks the provider for the current price;
3. updates the product and recomputes `discountPercent`;
4. writes a `PriceHistory` row **only when the price changed** — the series is a
   record of price changes, not of how often we polled;
5. compares against the target price;
6. emails an alert when the target is met;
7. suppresses a duplicate alert for the same unchanged price — while still
   alerting on a *further* drop, which is genuinely new information;
8. records failures per item and continues, so one broken store cannot stop the
   run.

A re-entrancy guard skips a tick if the previous run is still going, and the
whole run is wrapped so a crash can never kill the timer and silently end all
monitoring. Least-recently-checked items go first, so a large watchlist is
covered evenly.

All eight behaviours are covered by tests.

## Email alerts

The alert email contains the product name, previous price, current price, target
price, discount percentage, store name, a link to the product, and a
pause-alerts link (a placeholder token until production auth provides signing).
It ships as inline-styled table HTML plus a full plain-text alternative, and
every interpolated value is escaped — product names come from third parties and
must never be able to inject markup into a message we send.

`EMAIL_TRANSPORT` controls delivery:

- **`stream`** (default) — writes a real `.eml` file to `apps/api/.mail/` and
  sends nothing. You get a complete, inspectable message with no SMTP account
  and no risk of emailing a real person.
- **`json`** — logs the serialised message only.
- **`smtp`** — real delivery.

Send one from **Settings → "Send a test alert"**, or
`POST /api/alerts/test`. A notification feature you cannot verify is a
notification feature you do not trust.

## Authentication

The MVP has **no login**. Requests resolve to a single development user, taken
from an `x-user-email` header or `DEV_USER_EMAIL`.

The point is the *seam*, not the implementation. Everything downstream depends
only on `req.user` being populated by an `AuthenticationStrategy`
([`apps/api/src/middleware/auth.ts`](apps/api/src/middleware/auth.ts)). Adding
Auth.js, Clerk, Firebase or Supabase Auth means writing one more strategy that
verifies a token and looks up a user — no route, service or query changes.

Because the development strategy trusts a client-supplied header, the server
**refuses to start** with `NODE_ENV=production`. Note also that every
user-scoped query filters by `userId` in its `WHERE` clause rather than checking
ownership afterwards, so another user's id returns 404 and cannot be read or
modified — behaviour that survives the switch to real auth.

## Testing

```bash
npm test           # unit + API integration + component
npm run test:e2e   # Playwright, needs the database running
```

| Suite | Count | What it covers |
|---|---:|---|
| `packages/shared` unit | 118 | Discount maths, history statistics, deal-quality scoring (including fake-discount and price-increase cases), query parsing, formatting |
| `packages/store-providers` unit | 69 | Mock adapters, catalogue integrity, deterministic history, retry/backoff limits, robots.txt rules, JSON-LD extraction |
| `apps/api` integration | 46 | Every endpoint against the real database and the real Express app, with responses re-parsed through the published schemas; filters, sorting, pagination non-overlap, validation failures, 404s, user scoping, security headers |
| `apps/api` monitoring | 18 | All eight monitoring behaviours, with injected clock, provider and mailer |
| `apps/web` component | 34 | Target-price form, filter panel, sort select, product card — including accessibility wiring |
| `e2e` Playwright | 10 | The six required user journeys end to end, plus dashboard, settings, fake-discount surfacing and keyboard navigation |

API and monitoring tests run against real PostgreSQL, because the behaviour
under test *is* the interaction with it — transactions, unique constraints,
scoped updates, SQL-level sorting. A mocked client would only prove the mock was
called. Fixtures are namespaced per test and cleaned up, so seeded development
data survives a run.

## Adding a new vertical

Cars, cottages, flights, hotels, courses, apartments and event tickets all share
the same shape: they are priced, discounted, and worth watching over time. That
generic machinery is already vertical-agnostic, so adding one is three steps and
**no migration of core tables**:

1. Write `packages/shared/src/verticals/<name>.ts` exporting a
   `VerticalDescriptor` — its categories, a Zod schema for its extra fields, and
   its copy.
2. Register it in `verticals/registry.ts`. The filter UI picks it up
   automatically via `GET /api/meta`; nothing in the frontend is hard-coded.
3. Add store adapters for it in `packages/store-providers`.

`Product` already carries `vertical` and an `attributes Json` column validated
against the vertical's schema at ingestion.

## Current limitations

This is an MVP. Known and deliberate gaps:

- **No real authentication.** Single development user; see above.
- **Mock data by default.** Prices are realistic but synthetic. Nothing is
  fetched from a real store until you enable live mode.
- **Live mode does not build a catalogue.** It refreshes known products only,
  for the reasons above. Populating a catalogue should use an affiliate feed.
- **Cross-store matching is conservative by design.** Listings are grouped on
  published identifiers, or on brand plus model number, or on a close name match
  corroborated by a specification. Anything less certain goes to a review queue
  rather than being merged, so the catalogue under-groups rather than
  over-groups. See [docs/product-matching.md](docs/product-matching.md).
- **Candidate retrieval is linear past roughly six figures of canonical
  products.** The upgrade is `pg_trgm` plus a GIN index, isolated behind one
  function for exactly that reason.
- **`notifyOnPriceDrop` is stored but not yet acted on.** Only target-reached
  alerts are sent; the preference is persisted and respected in scoring.
- **Deal-quality thresholds are hand-calibrated**, not learned. They are
  documented constants and deliberately conservative.
- **Estimated savings is an estimate** — the sum of how far tracked products sit
  below their own recorded averages. Labelled as such everywhere it appears.
- **Single-currency in practice.** The schema and UI carry currency throughout,
  but only EUR is populated and there is no conversion.
- **Light theme only**, matching the brief's visual direction.
- **The default database accepts one connection** — see Setup.
- **No user-facing pagination beyond load-more**, and no infinite scroll.

## Legal and ethical considerations

Collecting product data from websites has real legal and ethical constraints.
This project treats them as design requirements rather than disclaimers:

- **Live collection is off by default** and must be enabled deliberately.
- **robots.txt is fetched, parsed and obeyed** before every request, failing
  closed on a disallow, with `Crawl-delay` honoured.
- **The crawler identifies itself honestly.** It never spoofs a browser
  user-agent, and contains no capability to bypass CAPTCHAs, bot protection,
  paywalls or login walls. None should be added.
- **Published structured data is preferred** over scraping rendered markup, and
  a plain HTTP GET is preferred over launching a browser — both are far lighter
  on the store's infrastructure.
- **Requests are paced and serialised per store**, with bounded retries that
  never retry a 403 or 429.
- **Official APIs and affiliate feeds are the recommended production route.**
  All three MVP stores are reachable that way.

**A permissive robots.txt is not permission.** Terms of service, the EU Database
Directive (96/9/EC) sui generis right and its national implementations,
copyright, and the GDPR all still apply, and this code checking robots.txt does
not make scraping lawful. Read
[`docs/legal-and-ethics.md`](docs/legal-and-ethics.md) before enabling live
mode; you are responsible for compliance in your jurisdiction.

Displayed prices may be stale or wrong. The UI says so, and every deal
assessment is labelled a heuristic rather than advice.

## Future improvements

Roughly in order of value:

1. **Real authentication** via Auth.js/Clerk/Supabase, plus signed unsubscribe
   tokens to replace the placeholder pause link.
2. **Affiliate/official feeds** instead of scraping, which also makes the
   product commercially viable.
3. **Saved-search alerts** — email when a *new* product matches stored criteria,
   not just when a tracked one drops.
4. **Trigram-backed match retrieval** (`pg_trgm` + a GIN index on
   `normalizedName`), which is what the current candidate lookup will need past
   roughly six figures of canonical products.
5. **A second vertical**, to prove the abstraction against reality.
6. **Per-store price normalisation** for bundles, multipacks and price-per-unit.
7. **Smarter deal quality**: seasonality, per-category baselines, and calibration
   against actual outcomes rather than hand-tuned constants.
8. **Operational hardening**: a job queue instead of in-process cron, metrics and
   tracing, `Retry-After` handling, and history partitioning as the table grows.
9. **Accessibility audit with real assistive technology** — the current pass is
   semantics, labelling, focus management and keyboard operability, verified in
   tests, not screen-reader user testing.

## Design and implementation decisions

Choices a reviewer might otherwise wonder about:

- **Prisma 7 + `prisma dev`** so the app runs with zero Docker. Prisma 7
  requires a driver adapter, generates the client into a path we own, and no
  longer chains `generate` from `migrate dev` — the npm scripts do it explicitly.
- **TypeScript 5.9, not 7.0.** The native TS 7 compiler is too new for this
  toolchain to depend on for a production MVP.
- **npm workspaces**, since pnpm is not assumed to be installed.
- **Money as `Decimal(10,2)`**, converted in one mapper layer.
- **`discountPercent` denormalised** — filtering and sorting need an indexable
  column; see Architecture.
- **A separate chart colour token.** The interface accent is tuned for WCAG text
  contrast and fails a chroma floor as a plotted line (it reads grey), so the
  chart uses a different, validated step of the same ramp.
- **Native `<select>` over a custom listbox** — the platform control is already
  accessible, keyboard-navigable, and uses the native picker on mobile.
- **Search state lives in the URL**, so results are shareable and the browser
  back button works.
- **`text-search` inputs and a `data-testid` on the price.** The E2E suite
  asserts sort ordering by reading prices; keying that off a utility class
  silently scooped up the discount badge, so the hook is explicit.
