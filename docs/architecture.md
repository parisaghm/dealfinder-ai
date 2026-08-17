# Architecture

How the pieces fit, and why they are arranged this way.

---

## Dependency direction

```
packages/shared           types · Zod schemas · pricing maths · verticals
      ▲     ▲                    (pure: no I/O, no React, no DB)
      │     └──────────────┐
packages/store-providers   packages/db          packages/ui
      ▲                          ▲            (presentation only)
      └──────────┬───────────────┘                   ▲
                 │                                   │
             apps/api ─────────────────────────► apps/web
        Express · cron · email              React client
```

Arrows point from dependency to dependent. Nothing points back. Two rules keep
it that way:

- **`packages/shared` imports nothing from the app.** It is pure. That is what
  lets the browser and the server share the exact same pricing functions.
- **`packages/db` does not import `store-providers`.** Ingestion describes its
  input structurally (`ProductUpsertInput`) rather than importing
  `ExternalProduct`, so the arrow stays one-way.

## Request lifecycle

`GET /api/deals?query=Philips%20headphones%20with%20at%20least%2030%25%20discount`

```
requestContext        assign request id, start timer
   ↓
helmet · cors · json(64kb) · rateLimit
   ↓
attachUser            resolve req.user (optional — browsing is anonymous)
   ↓
validate(dealsQuerySchema, 'query')
   ↓  coerced, defaulted, typed
searchDeals()
   ├─ parseSearchQuery()      "…at least 30% discount" → {category, minimumDiscount}
   ├─ explicit filters win over inferred ones
   ├─ SQL: WHERE + ORDER BY indexed columns, LIMIT/OFFSET
   ├─ one groupBy for full-history aggregates
   ├─ one windowed raw query for the recent trend window
   └─ toProductSummary() → Decimal→number + scoreDealQuality()
   ↓
res.json(dealsResponse)        ← the browser re-parses this with the same schema
```

Errors from anywhere leave through one handler that maps Zod issues → 400,
Prisma known errors → 404/409, connection failures → 503, everything else → 500
with the request id, and never leaks internals.

## Five decisions that carry the weight

### 1. Pricing logic is pure and shared

Discount arithmetic, history statistics and deal-quality scoring have no I/O.
Consequences: the card and the details page cannot disagree; the maths is
unit-tested with no database; and the same code can later run in a worker or an
edge function unchanged.

### 2. One schema, both directions

`dealsResponseSchema` validates on the way out **and** on the way in. A field
renamed on the server surfaces immediately in the browser as a schema error
naming the field, rather than as `undefined` deep in a component. The cost is
microseconds; the benefit is that the contract cannot silently drift.

### 3. Filtering and sorting in SQL, before pagination

`Product.discountPercent` is a maintained derived column. `minimumDiscount`
becomes an indexed `WHERE`, and `best-discount` an indexed `ORDER BY`.

The alternative — computing discount in application code — forces sorting *after*
fetching a page, which reorders within pages and produces results that are simply
wrong. Deal-quality score is *not* sortable for exactly this reason: it needs
history, so it is computed per response and used for badges only, never for
ordering or filtering. That is a deliberate limit, not an oversight.

Every write to price fields goes through `upsertProductFromSource()`, so the
derived column cannot drift from its inputs.

### 4. Provider isolation

Nothing above `packages/store-providers` knows how data was obtained. This keeps
the legally sensitive code in one reviewable place, makes mock↔live↔official-API
a one-file change, and lets a store fail without failing the request.

### 5. One authority for deliverability

`StoreOffer` decides whether a product can reach a country.
`Store.supportedDeliveryCountries` is coarse declared capability and is never a
per-product claim. The failure this prevents is specific and plausible: a store
that lists Finland in its coverage but has no Finnish offer for the item would
otherwise be shown as deliverable, and the user would discover otherwise at
checkout. Tests cover exactly that inconsistency, in the API, on the card and in
the comparison table.

## Avoiding N+1 on a page of results

A page of 24 products each needing history statistics is the obvious performance
trap. Instead, [`price-history.service.ts`](../apps/api/src/services/price-history.service.ts)
issues exactly two queries per page:

1. **Aggregates** — one `groupBy` over the page's product ids, so Postgres
   computes min/max/avg/count rather than shipping thousands of rows.
2. **Recent window** — one raw query using
   `ROW_NUMBER() OVER (PARTITION BY "productId" ORDER BY "recordedAt" DESC)`,
   because Prisma's query builder cannot express "the last N rows per group". It
   is parameterised, so the id list cannot be injected.

Both return maps keyed by product id, so the mapper is O(1) per row. The details
page, needing one product's full series for the chart, loads it directly — the
right trade-off at that cardinality.

## The five product layers

Everything about destination-aware comparison follows from this chain, so it is
worth being precise about what each link means.

```
Store ─── Product ───┬── CanonicalProduct
                     │        (cross-store identity)
                     │
                     └── StoreOffer ─── StoreOfferPriceHistory
                              (one per destination country + currency)
```

| Layer | Is | Is not |
|---|---|---|
| **`Store`** | A retailer: its country, region, declared delivery coverage, supported currencies, VAT registration country, `dataSourceType`, `isDemoStore` | A statement about any individual product |
| **`Product`** | **One retailer's listing** — the shelf price, the URL, the availability, its own price history and its own watchlist entries | The real-world product; two shops selling the same headphones are two `Product` rows |
| **`CanonicalProduct`** | **Cross-store identity** — the real-world product several listings are offers for | A merged row. Listings *point at* it; they are never folded into it |
| **`StoreOffer`** | **A destination-specific commercial offer** — what this listing costs delivered to one country in one currency: product price, delivery, tax treatment, import-duty status, delivered total, delivery window. **The sole authority on deliverability** | A copy of the listing. It answers a different question: not "what does this shop charge" but "what would this cost me, here" |
| **`StoreOfferPriceHistory`** | **Destination-aware history** — per observation: product price, delivery, estimated tax, estimated import fees, delivered total, original and display currency, the exchange rate *and its timestamp*, and availability | A reinterpretation of `PriceHistory`, which knows nothing about destinations |

### Why `PriceHistory` could not be reused

`PriceHistory` records an item price and nothing else. Shipping, tax, duty and the
exchange rate all vary by destination, and none of them was ever recorded there.
Pressing it into service would have meant inventing history — so the backfill
creates **no** `StoreOfferPriceHistory` rows from it. Destination history begins
accumulating from the first destination-aware check; only the demo stores have a
synthetic series, generated by the seed and labelled as such.

Both tables are written on **change**, not on poll, so a series records price
movements rather than how often we looked.

### Why `Product.shippingPrice` stays

It looks redundant next to `StoreOffer.shippingPrice` and is not:

- It is what the **legacy no-destination path** reads. That response is
  deliberately unchanged, and `effectivePrice` is computed from this field.
- It is what the Finnish offers were **backfilled from** — a `null` there stayed
  `null` in the offer, never becoming `0`.
- Removing it would be a destructive migration in service of tidiness.

The two are not in conflict because they answer different questions: the column is
"what this shop charges to deliver domestically, as published on the listing"; the
offer is "what delivery to *this* country costs".

## Legacy and destination paths

`country` is **optional on the wire**, and the whole expansion rests on that.

```
GET /api/deals            (no country)  →  searchProductDeals()
                                            reads Product, PriceHistory
                                            returns the pre-expansion payload,
                                            field for field
GET /api/deals?country=FI               →  searchDealsByDestination()
                                            reads StoreOffer, filters and sorts
                                            on it in SQL before pagination
```

`searchDeals()` is a dispatcher; the original function body was renamed, not
edited. Consequences worth knowing:

- A response without `country` carries no `destinationOffer`, no `isDemoStore` and
  no `appliedFilters.destination`. Verified against the running API, not assumed.
- `GET /api/products/:id/history` reads `PriceHistory` without a country and
  `StoreOfferPriceHistory` with one.
- The default `region` is `local`, so `country=FI&region=local` returns Finnish
  stores only — European stores are one visible click away. That keeps the existing
  store-count assertions arithmetically true.
- Every destination-aware React component takes a **nullable** destination prop and
  renders its pre-expansion output when it is `null`. The test factories default
  those fields to `null` for the same reason.

The deliverability filter is `storeOffers: { some: { countryCode } }`. Store
metadata is used only for the region filter and the store listing — **never** as a
per-product claim. `GET /api/stores?country=FI` returns stores having at least one
Finnish offer, with `supportedDeliveryCountries` alongside, labelled as declared
capability.

## Money: integer minor units

`packages/shared/src/money/` does all delivered-price arithmetic in integers.

```ts
interface Money { minorUnits: number; currency: Currency }   // integers only

addMoney(...parts)          // throws on a currency mismatch
convertMoney(m, to, rate)   // null when the rate is unusable
deliveredTotal({ productPrice, shippingPrice, estimatedTax, importFees })
```

Three properties, each earning its keep:

1. **Rounding happens once**, half-up, at the single conversion point — never
   mid-chain. A delivered total is convert → add → add → add, and a float error
   introduced at the first link cannot be rounded back into correctness at the
   last.
2. **`toMajor` is called only in mappers**, never inside arithmetic. The float
   mirror exists for the formatters and for the DTO's `major` field.
3. **Null propagates asymmetrically, on purpose.** Unknown *shipping* makes the
   whole total `null`, because a parcel with an unknown delivery cost has an
   unknown total. Unknown *tax or duty* contributes `0` and is disclosed in words,
   because the price is known and the surcharge is a warning rather than a figure.

The pre-existing float DTO fields (`currentPrice`, `effectivePrice`,
`moneySchema`) are untouched. This module governs the *new* arithmetic.

## Exchange rates and why staleness matters

Rates live in an additive `ExchangeRate` table behind an injectable
`RateProvider`, seeded with static values so a fresh clone works offline. One
`RateTable` is resolved per request and threaded down — fetching inside a mapper
would be an N+1 on the most frequently rendered component in the product.

`exchangeRateTimestamp` is always persisted and always surfaced. Then:

| State | Total | May be crowned cheapest | Alert fires |
|---|---|---|---|
| Same currency | Exact | Yes | Yes |
| Fresh (≤ `FX_RATE_MAX_AGE_HOURS`) | Estimate, labelled, rate and date shown | Yes | Yes |
| **Stale** | Shown, with a staleness warning | **No** | **No** |
| **Missing** | `null` — "cannot be compared" | No | No |

The reasoning behind the middle row is the point of the whole feature. A stale
rate is still the best information available, so *hiding* the offer would be its
own dishonesty — the user is entitled to see it. What must not happen is a stale
rate deciding which shop gets the click, or an alert email asserting that a
threshold was crossed when the crossing might be a currency movement nobody
observed. So the total is shown and the *claim* is withheld.

Historical points carry the rate in force on their own date. Re-converting an old
point at today's rate would make a currency movement indistinguishable from a
price change; where no rate was recorded, the series shows a gap.

## Cross-store product identity

`Product` is a *store's listing*. `CanonicalProduct` is the real-world product
several listings are offers for, and they point at it rather than being merged
into it.

That direction is the whole design. Offers keep their own id, price, history,
watchlist entries and store, so:

- an incorrect match is undone by nulling one column, never by reconstructing
  deleted rows;
- watchlists and price alerts still reference the store listing they always did,
  which is why this feature could be added without touching either.

The matching engine lives in `packages/shared/src/matching/` and is pure — no
database, no clock, no network — so the seed script, the backfill job, the API
and the browser run identical code. The persistence side is
`packages/db/src/matching.ts`, which is the single writer for product identity
in the same way `ingestion.ts` is the single writer for prices.

Two rules are worth carrying in your head when working near it:

1. **Nothing below the review threshold is ever written.** "Never silently merge
   a low-confidence match" is enforced by not persisting a row at all, which is
   stronger than persisting one and filtering it later.
2. **Conflicts cap the score, they do not subtract from it.** A weighted mean is
   good at ranking plausible pairs and terrible at rejecting implausible ones —
   95 % name agreement out-votes a storage mismatch every time.

Grouping on `GET /api/deals` is a *decoration* of a page that has already been
selected, ordered and counted. It never changes which products are on the page.
Collapsing rows in SQL would make `total` count products-after-grouping and
silently break both pagination and the result summary — the same reasoning as
"filtering and sorting in SQL, before pagination" above, applied in reverse.

Sorting *offers*, by contrast, happens in memory. Those look inconsistent and are
not: an offer list is complete and small, so there is no page boundary to
corrupt, and doing it in memory lets it reuse the exact `calculateEffectivePrice`
and `scoreDealQuality` the rest of the app uses instead of a SQL
re-implementation that would drift.

Full detail, including the calibration and its known limits, is in
[product-matching.md](product-matching.md).

## Frontend structure

- **Search state lives in the URL.** Results are shareable and bookmarkable, and
  the back button works. `lib/search-params.ts` is the single translation layer
  between URL params, form values and the API query.
- **React Query owns server state**; there is no global store. Query keys are
  centralised in `lib/queries.ts` so invalidation is reliable — tracking a
  product must refresh the watchlist, the dashboard *and* the deals list, whose
  rows carry `isTracked`.
- **`packages/ui` is presentation-only.** No fetching, no routing, no domain
  knowledge. Anything that knows what a "deal" is lives in `apps/web`.
- **Accessibility is structural.** The `Field` component generates ids and wires
  `<label for>`, `aria-describedby` and `aria-invalid` automatically, so a
  correctly-labelled form is the default rather than something each page must
  remember.
- **The destination is URL-first, then stored, then a settings default.**
  `lib/destination.tsx` resolves in that order and writes to storage *only* when
  the user changes a control. A shared link therefore carries its own destination —
  and in-app links re-apply it, because a URL-only destination has nothing in
  storage to fall back on and would silently answer for the reader's own country.
  `UserSettings` deliberately does **not** activate destination mode: those columns
  default to `FI`/`EUR`/`local` for every user who has ever existed, so treating
  them as a choice would switch the feature on for someone who never asked.
- **One DOM representation per breakpoint.** Layout switches are JavaScript media
  queries, not `hidden lg:block`. Hidden duplicates are still in the DOM, where
  `getByLabel` and Playwright locators match them — a second copy of every row
  turns each locator into a strict-mode failure, and `.first()` everywhere is the
  brittleness this avoids.

## Extensibility: verticals

A vertical is a `VerticalDescriptor`: categories, a Zod schema for
vertical-specific attributes, and copy. `Product` carries `vertical` and
`attributes Json`, and the generic machinery — search, filtering, price history,
scoring, watchlists, alerts — is vertical-agnostic, because every market is
priced, discounted and worth watching over time.

Adding one: write the descriptor, register it, add adapters. The filter UI
follows automatically through `GET /api/meta`; nothing is hard-coded in the
frontend. No migration of core tables.

## The authentication seam

```ts
interface AuthenticationStrategy {
  readonly name: string;
  authenticate(req: Request): Promise<AuthenticatedUser | null>;
}
```

`attachUser(strategy)` populates `req.user`; routers call `requireUser` where a
user is needed. Adding Auth.js/Clerk/Firebase/Supabase means writing one more
strategy — no route, service or query changes.

Two properties that make the swap safe:

- The development strategy trusts a client header, so the server **refuses to
  start in production**.
- Every user-scoped query filters by `userId` in its `WHERE` clause rather than
  checking ownership after loading. Another user's id therefore returns 404 and
  cannot be read or modified — behaviour that is already correct under real auth,
  and which the API tests assert.

## Operational shape

- **Env validated at boot** with Zod; the process exits listing what is wrong.
  `MONITOR_CRON` is validated too, so a typo cannot mean "alerts silently never
  fire".
- **Structured logging** (pino) with a request id on every line and in every
  error response, so a user-reported failure is traceable without reproduction.
- **Graceful shutdown**: stop the cron, drain HTTP with a timeout, release the
  pool.
- **Cron re-entrancy guard**, and the whole run wrapped so a crash cannot kill
  the timer and end all monitoring silently.
- **Health check that can actually fail** — it queries the database and returns
  503 when that fails, rather than reporting "ok" because the process is alive.
