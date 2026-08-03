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

## Four decisions that carry the weight

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
