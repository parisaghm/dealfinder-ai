# DealFinder AI

**Find real discounts, not just sale labels.**

**Compare selected European retailers that deliver to your destination.**

A shopping-discount discovery and price-alert platform. It compares offers on
**total delivered price** — the shelf price plus delivery to the country you
actually live in, with tax treatment and possible import charges stated — and it
records what each product has *actually* cost over time, so it can judge whether
a discount is genuine. A crossed-out price is a marketing claim, not evidence,
and a low shelf price is not a low price if delivery doubles it.

"Selected retailers" is precise, not modest. Each store is integrated
individually through an official API, an affiliate or merchant feed, published
structured data, or another explicitly permitted source. DealFinder does **not**
search every European website, and it does not crawl catalogues.

The current build covers **electronics delivered to eight European countries**
and is architected so other markets — cars, cottages, flights, hotels, courses,
apartments, event tickets — can be added without migrating core tables or
touching search, scoring or alerting.

> **Demo data.** Ten store providers ship with the project. Three model real
> Finnish retailers; **seven are synthetic European demo stores**, clearly
> labelled as such in the UI, the API and the seed. Their catalogues, prices,
> delivery rules and history are illustrative fixtures, not observations of any
> real shop.

---

## Contents

- [What it does](#what-it-does)
- [Why this project is interesting](#why-this-project-is-interesting)
- [The core idea: deal quality](#the-core-idea-deal-quality)
- [Delivered price: destinations, currency and charges](#delivered-price-destinations-currency-and-charges)
- [Stores and delivery destinations](#stores-and-delivery-destinations)
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
- [Responsive UI and accessibility](#responsive-ui-and-accessibility)
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
| **Destination-aware comparison** | Pick a delivery country, a display currency and how far afield to look (local, Nordic, European). Results then answer "what does this cost delivered *here*". |
| **Total delivered price** | Shelf price + delivery to your destination + tax treatment + any import-charge warning. The cheapest *delivered* total is highlighted, which is routinely a different store from the cheapest shelf price. |
| **Deliverability from real offers** | A store appears for a destination only when it has an actual offer that ships that product there — never because its metadata mentions the country. |
| **Currency conversion** | Foreign-currency offers are converted, labelled as estimates, and show the rate and when it was recorded. A missing or stale rate bars an offer from being called cheapest. |
| **Filter and sort** | Maximum shelf price, maximum delivered price, maximum delivery cost, delivery time, minimum discount, category, store, store region; sort by cheapest delivered total, best discount, lowest/highest price or most recently updated. |
| **Cross-store product matching** | Listings from different retailers become one product on published identifiers, or brand plus model, or a corroborated close name match — with anything less certain sent to a review queue instead of merged. |
| **Price history** | Every observed price change is recorded and charted — per store, and per destination including delivery, tax and the exchange rate in force on each date. |
| **Deal quality** | An explainable 0–100 score with a plain-language label, the factors behind it, and a stated confidence level. |
| **Fake-discount detection** | Flags a "sale" whose price matches what the product normally costs, or an "original price" that was never actually charged. |
| **Destination-aware watchlist** | Track one product for several destinations at once. Each destination-and-currency target is its own row, naming both, with its own delivered-price threshold. |
| **Delivered-price alerts** | A scheduled job checks tracked products and emails you when a *delivered* target is reached — once, not repeatedly, and never on an unreliable total. |
| **Match review** | An internal queue for medium-confidence matches, showing the evidence for and against, so a human decides rather than a threshold. |
| **Dashboard** | Tracked products, active alerts, deals found this week, estimated savings, recent price changes, alert history, saved searches. |
| **Settings** | Email address, notification preferences, check frequency, preferred stores and categories, and a **Delivery and currency** card: default destination, preferred currency, default store region, preferred store countries, non-EU stores, unknown-shipping offers, delivery-time preference and import-charge warnings. |

## Why this project is interesting

The user-facing feature is simple to describe. The problems underneath it are
the reason the code looks the way it does.

**Identifying the same product across retailers.** Three shops list the same
headphones under three different names, and one of them omits the model number.
Matching runs on published identifiers first, then brand plus model, then a close
name match that must be corroborated by a specification — see
[docs/product-matching.md](docs/product-matching.md).

**Not merging things that only look alike.** A weighted average of similarity
signals is good at ranking plausible pairs and bad at rejecting implausible ones:
95 % name agreement out-votes a storage-size mismatch every time. So conflicts
*cap* the score rather than subtracting from it, and anything below the threshold
is never written at all — the catalogue under-groups rather than over-groups.

**Telling a real discount from a sale label.** The advertised discount is scored
against our own recorded history, and an unsupported claim earns zero with the
reason shown, so a permanent "50 % off" lands on *Average price*.

**Working out what something actually costs to your door.** Delivery depends on
the destination, tax treatment depends on the route, and import charges may
apply and cannot be computed as a guarantee. All money arithmetic happens in
integer minor units, because floating-point cents in a chain of
convert-add-add-add is how a comparison table develops a stable-looking wrong
answer.

**Being honest when the answer is unknown.** Unpublished delivery makes the
delivered total `null`, never `0`. A null total is shown as unknown, sorted last,
and can never win the comparison — the least informative offer must not win by
having admitted the least.

**Being honest when the exchange rate is old.** A converted total is always
labelled an estimate with its rate and date. If the rate is missing the offer
cannot be compared; if it is stale the total is still shown, but the offer is
barred from being presented as the cheapest, and delivered-price alerts are
suppressed rather than fired on a number we do not trust.

**Expanding the product without breaking the old one.** `country` is opt-in on
the wire: absent, the API runs its original code path and returns its original
payload byte for byte. Every destination-aware component takes a nullable prop
and renders exactly as before when it is null. That is what let a Finland-only
product become a Europe-wide one with the existing suites still passing rather
than re-baselined.

**Making the end-to-end suite mean something.** 27 Playwright tests run against
the real API and the real database with no request interception, each one
independently re-runnable: fixtures resolved from the API rather than hard-coded
ids, watchlist rows and settings restored in `beforeEach` *and* `afterEach` so a
crashed run cannot poison the next one, and prices compared as numbers from
`data-` attributes rather than locale-formatted text.

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

## Delivered price: destinations, currency and charges

Pick a destination and the question changes from "who lists this cheapest" to
"who can actually get this to me, and for how much in total".

```
total delivered price = product price
                      + delivery to the destination
                      + estimated tax        (when the route makes it payable)
                      + estimated import fees (when the route can attract them)
```

Four rules make that number trustworthy rather than merely plausible:

**1. Unknown delivery makes the total unknown.** A store that publishes no
delivery cost for your country is a different thing from one that delivers free.
The total becomes `null`, the UI says *"Shipping cost unknown — delivered total
cannot be calculated"*, the offer sorts last, and it can never be crowned
cheapest. Excluded offers are **counted and reported**, not quietly dropped.

**2. Deliverability comes from offers, never from store metadata.** A `StoreOffer`
row for `(product, country, currency)` is the only proof that this product can
reach that country. A store listing Finland in its declared coverage while having
no Finnish offer for the item is **not** shown as deliverable — there are tests
for exactly that inconsistency.

**3. Conversion is disclosed, and freshness is enforced.** A foreign-currency
offer shows *"Converted from 3 190 kr at 1 SEK = 0,0870 EUR (2 Aug 2026) — the
store charges in SEK"* and is tagged `Converted`. Then:

| Rate state | Behaviour |
|---|---|
| Same currency | No rate involved; never affected |
| Fresh (within `FX_RATE_MAX_AGE_HOURS`, default 48) | Converted, labelled an estimate, eligible to win |
| **Stale** | Total still shown with a staleness warning, but the offer **cannot be presented as the cheapest**, and delivered-price alerts are suppressed |
| **Missing** | No total at all: *"No exchange rate available for SEK → EUR, so this offer cannot be compared"* |

Historical charts convert each point at the rate recorded **on that date**, not
today's — otherwise a currency movement would be indistinguishable from a price
change. Where no rate was recorded, the series shows a gap rather than a guess.

**4. Tax and duty are stated, never invented.** EU→EU is `NONE`. Any route
crossing the customs border is `POSSIBLE`, which produces a visible *"Import
charges may apply"* warning and means the total is **never** described as final.
Where a store does not publish its tax treatment, the UI says so. An estimate is
always labelled an estimate.

Money arithmetic lives in `packages/shared/src/money/` and works in **integer
minor units** throughout, converting to a decimal exactly once, in the mapper, for
display.

## Stores and delivery destinations

### Destinations

Fourteen countries are modelled; **eight are selectable destinations** today. The
rest exist so that delivery rules naming them are valid and so the UI can say
"not available yet" instead of leaving a country mysteriously absent.

| Selectable | Currency | | Modelled, not yet selectable | Currency |
|---|---|---|---|---|
| Finland | EUR | | Belgium | EUR |
| Sweden | SEK | | Portugal | EUR |
| Germany | EUR | | Austria | EUR |
| Netherlands | EUR | | Norway *(EEA, non-EU)* | NOK |
| France | EUR | | Switzerland *(non-EU)* | CHF |
| Spain | EUR | | United Kingdom *(non-EU)* | GBP |
| Italy | EUR | | | |
| Denmark | DKK | | | |

### The ten store providers

Three model real Finnish retailers. **Seven are synthetic demo stores** — invented
retailers with invented catalogues, prices, delivery rules and history, marked
`isDemoStore` in the database, disclosed in the UI as *"Demo store — a fictional
retailer with synthetic prices, for demonstration only"*, and never presented as
observations of a real shop.

| Store | Country | Region | Currency | Kind |
|---|---|---|---|---|
| Gigantti | 🇫🇮 Finland | local | EUR | Models a real retailer (mock data) |
| Power | 🇫🇮 Finland | local | EUR | Models a real retailer (mock data) |
| Verkkokauppa.com | 🇫🇮 Finland | local | EUR | Models a real retailer (mock data) |
| Nordbyte AB | 🇸🇪 Sweden | nordic | **SEK** | **Synthetic demo store** |
| Danske Elektro A/S | 🇩🇰 Denmark | nordic | **DKK** | **Synthetic demo store** |
| TechHalle GmbH | 🇩🇪 Germany | european | EUR | **Synthetic demo store** |
| Kanaalshop B.V. | 🇳🇱 Netherlands | european | EUR | **Synthetic demo store** |
| Maison Numérique SAS | 🇫🇷 France | european | EUR | **Synthetic demo store** |
| Ibérica Digital S.L. | 🇪🇸 Spain | european | EUR | **Synthetic demo store** |
| Adriatica Tech S.r.l. | 🇮🇹 Italy | european | EUR | **Synthetic demo store** |

None of the three Finnish datasets is scraped: in the default `mock` mode every
price in the system is a fixture. The Finnish catalogues keep their original
numbers because the end-to-end suite asserts them.

The demo stores exist to make destination behaviour *visible*: two of them quote
in a foreign currency so conversion is exercised, one publishes no delivery cost
for some items so the unknown-total path is real, one does not ship to Finland at
all, and one declares a country it has no offer for — the fixture for the
"metadata is not proof" rule.

### Seeded catalogue

| | Count |
|---|---:|
| Stores | **10** (3 Finnish + 7 synthetic demo) |
| Products (retailer listings) | **115** |
| Canonical products (cross-store identities) | **71** |
| Destination offers (`StoreOffer`) | **319** |
| Destination offer-history records | **23 548** |
| Exchange-rate observations | 12 |

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
(`packages/db/src/ingestion.ts`), so the column cannot drift. The same reasoning
gives `StoreOffer` a `(countryCode, totalDeliveredPrice)` index, so
`lowest-delivered` is also an indexed `ORDER BY` before `LIMIT`.

**5. Deliverability has exactly one source of truth.** `StoreOffer` decides
whether a product can reach a country. `Store.supportedDeliveryCountries` is
coarse *declared* capability, used for the region filter and the store listing and
**never** as a per-product claim.

More detail in [`docs/architecture.md`](docs/architecture.md); for how listings
from different stores become one product,
[`docs/product-matching.md`](docs/product-matching.md); and for the destination
provider contract, [`docs/store-providers.md`](docs/store-providers.md).

### Database

```
Store 1─* Product *─0..1 CanonicalProduct        Country       ExchangeRate
            │  │
            │  └─* PriceHistory                 (the store's own list price)
            │
            └─* StoreOffer ─* StoreOfferPriceHistory
                  (one row per destination country + currency:
                   delivery, tax, duty, delivered total, FX)

User 1─┬─* WatchlistItem *─1 Product      identity: (user, product,
       ├─* SavedSearch                              destination, currency)
       ├─* Notification *─0..1 Product
       └─1 UserSettings
```

The five-layer product model, and why each layer exists:

| Layer | Means |
|---|---|
| `Store` | A retailer, with its country, region, declared coverage and `isDemoStore` |
| `Product` | **One retailer's listing** — its own price, history, URL and watchlist entries |
| `CanonicalProduct` | **Cross-store identity** — the real-world product several listings are offers for. Listings *point at* it rather than being merged into it, so an incorrect match is undone by nulling one column |
| `StoreOffer` | **A destination-specific commercial offer** — what this listing costs delivered to one country in one currency, and the sole authority on whether it can be delivered there |
| `StoreOfferPriceHistory` | **Destination-aware history** — product price, delivery, tax, duty, delivered total and the exchange rate in force, per observation |

Money is stored as `Decimal(10,2)` (no binary-float drift) and converted to
`number` in one mapper layer at the API boundary; all *new* delivered-price
arithmetic happens in integer minor units before that conversion. Indexes cover
every query the app actually issues: `(storeId, externalId)` unique for idempotent
ingestion, plus `category`, `(vertical, category)`, `currentPrice`,
`discountPercent`, `lastCheckedAt`, `brand`, `(productId, recordedAt)` on price
history, and `(countryCode, totalDeliveredPrice)` on offers — the last is what
makes destination-aware sorting an indexed operation *before* pagination.

Documented additions to the original specification:

- **`UserSettings`** as its own table rather than JSON on `User`, so the
  monitoring job can filter on `checkFrequency` and `notifyByEmail` in SQL
  instead of loading and parsing every user's preferences.
- **`Notification.priceAtAlert`**, because "do not alert twice for the same
  unchanged price" otherwise requires re-parsing the message text.
- **`Product.shippingPrice` is kept**, even though `StoreOffer` now carries
  per-destination delivery. It is what the legacy no-destination path reads, it is
  what the Finnish offers were backfilled *from*, and removing it would change a
  response that is deliberately unchanged.
- **`WatchlistItem` identity is four columns** — `(userId, productId,
  destinationCountry, preferredCurrency)` — so Finland and Germany are two
  independent targets. The replacement index was created *before* the old
  two-column one was dropped, so uniqueness was never unprotected; see
  [docs/database-environment.md](docs/database-environment.md).

## Project layout

```
├─ apps/
│  ├─ api/                  Express API, cron scheduler, email
│  │  ├─ src/{routes,services,middleware,mappers,email,jobs}/
│  │  └─ tests/             API integration + monitoring tests
│  └─ web/                  React client
│     └─ src/{pages,components,lib,test}/
├─ packages/
│  ├─ shared/               types · Zod schemas · pricing · matching ·
│  │                        money (integer minor units) · countries · verticals
│  ├─ db/                   Prisma client · ingestion (the only price writer) ·
│  │                        offers · matching · countries
│  ├─ store-providers/      StoreProvider interface · 10 mock datasets ·
│  │                        delivery rules · live adapters
│  └─ ui/                   presentation-only design system
├─ prisma/                  schema · migrations · seed · offer backfill
├─ e2e/                     main-flow · cross-store · cross-border
├─ docs/                    architecture · deal-quality · product-matching ·
│                           store-providers · legal-and-ethics ·
│                           database-environment
└─ docker-compose.yml       PostgreSQL (optional — see below)
```

## Setup

Requires **Node ≥ 22.12** and npm. Docker is **optional**.

```bash
npm install
cp .env.example .env
npm run db:dev             # starts a local PostgreSQL — no Docker needed
npm run db:deploy          # applies migrations, then generates the client
npm run db:seed            # 10 stores · 115 products · 319 destination offers
npm run db:backfill-offers # Finnish offers for pre-expansion products
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
  connections after 2 seconds (`DATABASE_IDLE_TIMEOUT_MS`), so switching is quick.
- **It is memory-fragile under long runs.** A lengthy test or end-to-end session
  can end with `Connection terminated unexpectedly` or `P1001`. Recovery is
  `npx prisma dev stop default` → `npm run db:dev` → `npm run db:counts`; no data
  is lost. **Never** use `db:reset` for this. Full procedure in
  [docs/database-environment.md](docs/database-environment.md).
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
| `DATABASE_IDLE_TIMEOUT_MS` | `2000` | How long an unused connection is kept. Short by default so another tool can reach the single-connection dev database; raise it when nothing else needs it (the E2E config sets 120 000) |
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
| `FX_RATE_MAX_AGE_HOURS` | `48` | Past this, a converted total is flagged stale: still shown, but barred from being called cheapest, and delivered-price alerts are suppressed |
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
GET    /api/countries                  14 modelled, 8 selectable
GET    /api/stores                     ?country= — stores with ≥1 offer there
GET    /api/deals                      query maximumPrice minimumDiscount
                                       category stores sort group page limit
                                       + country currency region shipsToCountryOnly
                                         maximumDeliveredPrice maximumShippingPrice
                                         maxDeliveryDays includeUnknownShipping
GET    /api/products/:id
GET    /api/products/:id/offers        ?country=&currency= — every store's
                                       delivered total, plus the ones that cannot
                                       reach the destination, listed separately
GET    /api/products/:id/history       ?days=90 [&country=&currency=]
GET    /api/canonical-products         cross-store groups · GET /:id · /:id/offers
GET    /api/match-candidates           review queue · POST approve/reject
GET    /api/watchlist                  POST · PATCH /:id · DELETE /:id
GET    /api/saved-searches             POST · PATCH /:id · DELETE /:id
GET    /api/dashboard
GET    /api/settings                   PATCH · POST /clear-data
POST   /api/alerts/test
```

**`country` is opt-in, and that is load-bearing.** Omit it and `/api/deals` runs
the original code path and returns the original payload, field for field — no
`destinationOffer`, no `isDemoStore`, no `appliedFilters.destination`. Supply it
and the response is driven by `StoreOffer` instead. The same applies to
`/api/products/:id/history`, which reads `PriceHistory` without a country and
`StoreOfferPriceHistory` with one.

`POST /api/watchlist` answers a duplicate destination-and-currency target with
**409** and, when the collision is *currency-only*, names the existing item so the
client can offer to update it rather than silently creating a second target.

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

  // Where it ships from, where it ships to, and whether it is a demo fixture.
  storeCountry: CountryCode;
  supportedDeliveryCountries: readonly CountryCode[];
  supportedCurrencies: readonly Currency[];
  region: StoreRegion;                    // 'local' | 'nordic' | 'european'
  isDemoStore: boolean;

  /** Explicit, never inferred. A provider answers for itself. */
  supportsDestination(country: CountryCode): boolean;

  searchProducts(query: ProductSearchInput, ctx?: DestinationContext): Promise<ExternalProduct[]>;
  getProductDetails(url: string): Promise<ExternalProductDetails>;
  getOffer(productUrl: string, ctx: DestinationContext): Promise<ExternalStoreOffer>;
}
```

The destination members were **added** rather than replacing anything, and
`DestinationContext` is optional on `searchProducts`, so existing adapters and the
monitor's `getProductDetails` path keep working untouched. `getOffer` throws a
typed non-retryable error for an unsupported destination instead of returning a
guess, and **the absence of a delivery rule means "does not ship there"** — the
default is never "yes".

`createProviderRegistry()` picks the implementations from `PROVIDER_MODE`, and
`searchAll()` queries stores concurrently while **isolating failures**: a store
that is down degrades the result set instead of failing the request. Provider
output is validated with Zod at the boundary, and an individual malformed row is
dropped rather than poisoning the batch.

**Mock mode (default).** Bundled catalogues for all ten stores — **115 products**
across three Finnish and seven synthetic European demo retailers — with
deterministic synthetic price history seeded from a hash of each product id, so a
re-seed is byte-for-byte reproducible. The dataset deliberately includes a
permanent fake "sale", a rising price, genuine all-time lows, volatile pricing, an
out-of-stock item, unpublished shipping costs, two foreign currencies, a store
that cannot deliver to Finland and a store whose declared coverage overstates
what it actually offers — so both the scoring and the destination logic are
visible on first run rather than every product looking alike. Latency and failure
injection are configurable.

Every demo store's catalogue and prices are **illustrative fixtures**. They are
disclosed as such wherever an offer appears.

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

An item with a **delivered-price** target takes a parallel branch: it is evaluated
against the delivered total from `StoreOffer` / `StoreOfferPriceHistory` — never
the shelf price — and the email names the destination and the currency. If the
delivered total is unknown, or its exchange rate is missing or stale, the alert is
**suppressed** rather than fired on a number we do not trust. Items with only a
list-price target take the original path unchanged.

All of these behaviours are covered by tests.

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

## Responsive UI and accessibility

The comparison table is the hardest layout in the product — thirteen columns at
desktop width — and it resolves to **one representation per breakpoint, not
several with some hidden**:

| Width | Comparison layout |
|---|---|
| ≥ `lg` (1024px) | Full table, 13 columns |
| `sm`–`lg` | The *same* table, reduced to the 6 columns without which it cannot answer its own question |
| < `sm` (640px) | One card per store |

The switch is a JavaScript media query rather than `hidden lg:table-cell`, and
that is a correctness decision: rendering every row twice and hiding one copy puts
each store name, price and badge in the DOM twice, where `getByLabel` and
Playwright locators still match them. A single `COLUMNS` array is mapped by both
`<thead>` and `<tbody>`, so a header and its cells cannot drift apart. The
destination controls in the header are mounted the same way — exactly one copy at
any width.

Verified with no horizontal page overflow at 320, 375, 768, 1024 and 1440 px.
Wide content scrolls inside its own container; the document never scrolls
sideways.

Accessibility is structural rather than retrofitted:

- The **skip link is the first focusable element** on every page — the destination
  controls sit after the navigation in DOM order specifically to keep it that way.
- The `Field` component generates ids and wires `<label for>`,
  `aria-describedby` and `aria-invalid` automatically, so a correctly-labelled
  form is the default.
- Every control has a **visible focus indicator**; 70 controls were checked
  individually.
- **Nothing is communicated by colour alone.** The winner is the words *"Cheapest
  delivered total"*, warnings are sentences, and the demo-store disclosure is
  text with a footnote defining it — not a coloured badge to be inferred.
- Country **names**, never a flag alone: several are indistinguishable at 16 px and
  screen readers announce them as unhelpful emoji names.
- Charts have a **values-table fallback**, so the data is reachable without
  hovering.
- Unsupported destinations are listed and **disabled with a reason** rather than
  omitted, so "not available yet" is distinguishable from "we forgot".

The current pass is semantics, labelling, focus management and keyboard
operability, verified in tests — not screen-reader user testing. See
[Future improvements](#future-improvements).

## Testing

```bash
npm test           # unit + API integration + component
npm run test:e2e   # Playwright, needs the database running
```

**1 052 automated tests and 27 end-to-end tests**, all passing.

| Suite | Count | What it covers |
|---|---:|---|
| `packages/shared` unit | **472** | Discount maths, history statistics, deal-quality scoring (including fake-discount and price-increase cases), query parsing, formatting, cross-store matching, the money module (minor-unit invariants, rounding, conversion, missing and stale rates), delivered-total sorting, country and duty rules |
| `packages/store-providers` unit | **134** | Mock adapters, catalogue integrity, deterministic history, per-destination delivery rules, explicit destination support, retry/backoff limits, robots.txt rules, JSON-LD extraction |
| `apps/api` integration | **196** | Every endpoint against the real database and the real Express app, with responses re-parsed through the published schemas; filters, sorting, pagination non-overlap, validation failures, 404s, user scoping, security headers; destination search and exclusion counts, the "declared coverage is not proof" case, destination history, four-column watchlist identity and its 409s, delivered-price alerts, and a guard asserting every migration is additive and safely ordered |
| `apps/web` component | **250** | Cards, comparison tables, filter panel, target-price form, watchlist grouping, settings, destination history chart, destination state and URL handling — including accessibility wiring, one-layout-per-breakpoint and the honesty copy |
| `e2e` Playwright | **27** | `main-flow` (10) the six required journeys plus dashboard, settings, fake-discount surfacing and keyboard navigation · `cross-store` (7) matching, grouping, comparison and the review queue · `cross-border` (10) the destination journeys |

API and monitoring tests run against real PostgreSQL, because the behaviour
under test *is* the interaction with it — transactions, unique constraints,
scoped updates, SQL-level sorting. A mocked client would only prove the mock was
called. Fixtures are namespaced per test and cleaned up, so seeded development
data survives a run.

The end-to-end suite runs with `workers: 1` against the shared seeded database and
never resets it, so every test is written to be independently re-runnable:
identifiers are resolved from the API rather than pasted in, the destination is
cleared through an `addInitScript` guarded by a `sessionStorage` flag so a test's
own choice survives its navigation, and watchlist rows and settings are restored in
`beforeEach` **and** `afterEach` — an `afterEach` that never fired because a run
crashed would otherwise poison every later run.

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
- **Seven of the ten stores are invented.** The European retailers are demo
  fixtures with illustrative catalogues, prices and delivery rules, labelled as
  such throughout. They demonstrate the mechanism; they do not report on any real
  shop.
- **Coverage is explicit, not exhaustive.** DealFinder compares *selected*
  retailers. Adding a real one means an individually reviewed integration — an
  official API, an affiliate or merchant feed, or another permitted source — not
  pointing a crawler at a new domain.
- **Import charges are warned about, never calculated.** Any route crossing the
  customs border is marked "may apply" and the total is not described as final.
  Actual duty depends on classification, valuation and the carrier's handling fee.
- **Exchange rates are seeded static values behind an injectable provider.** There
  is no live FX feed. The freshness rules are enforced, which is why a database
  seeded a fortnight ago correctly stops crowning converted offers.
- **Delivery estimates come from each store's published rules only.** Where a
  store publishes none, the UI says "Delivery time not published" rather than
  guessing.
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
- **Six of fourteen modelled countries are not yet selectable.** They exist so
  delivery rules naming them are valid and so the UI can say "not available yet".
- **Light theme only**, matching the brief's visual direction.
- **The default database accepts one connection and is memory-fragile** under long
  test runs — see Setup and
  [docs/database-environment.md](docs/database-environment.md).
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
- **No catalogue crawling, at all.** `searchProducts()` returns `[]` in live mode
  by design. Live mode refreshes *known* products, which is what price tracking
  needs; populating a catalogue belongs to a licensed feed.
- **Official APIs and affiliate feeds are the recommended production route**, in
  that order of preference. The three modelled Finnish retailers are reachable
  through affiliate networks; every additional retailer must be reviewed and
  integrated individually.

**A permissive robots.txt is not permission.** Terms of service, the EU Database
Directive (96/9/EC) sui generis right and its national implementations,
copyright, and the GDPR all still apply, and this code checking robots.txt does
not make scraping lawful. Read
[`docs/legal-and-ethics.md`](docs/legal-and-ethics.md) before enabling live
mode; you are responsible for compliance in your jurisdiction.

Displayed prices may be stale or wrong. The UI says so, and every deal
assessment is labelled a heuristic rather than advice. Prices, availability,
delivery costs, tax treatment, exchange rates and delivery conditions all change,
and a **delivered total is an estimate** — DealFinder must never present one as a
guarantee. Confirm on the retailer's own page before buying.

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
- **Money as `Decimal(10,2)`**, converted in one mapper layer — and all *new*
  delivered-price arithmetic in **integer minor units**, because a chain of
  convert-then-add-then-add in floating point is how a comparison table develops a
  stable-looking wrong answer. The existing float DTO fields are untouched.
- **`country` opt-in on the wire**, so the pre-expansion API response and every
  test asserting it stayed valid rather than being re-baselined.
- **`DeliveredComparisonTable` as a sibling of `OfferComparisonTable`**, not a
  retrofit. One answers "cheapest listed plus published shipping in one currency",
  the other "cheapest delivered to this country across three currencies with four
  ways to be incomparable". Merging them would have produced a matrix of
  conditionals around the most safety-critical numbers in the product.
- **Historical FX converted at the rate recorded on each date**, never today's —
  otherwise a currency movement is indistinguishable from a price change.
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
