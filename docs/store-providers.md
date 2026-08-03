# Store providers

How store integrations work, and how to add one.

⚠️ Before enabling `PROVIDER_MODE=live`, read
[legal-and-ethics.md](legal-and-ethics.md).

---

## The interface

Every integration implements the same contract
([`types.ts`](../packages/store-providers/src/types.ts)):

```ts
interface StoreProvider {
  name: string;                 // "Verkkokauppa.com"
  slug: string;                 // "verkkokauppa" — matches Store.slug
  vertical: string;             // "electronics"
  websiteUrl: string;
  logoUrl?: string | null;
  sourceKind: 'mock' | 'api' | 'structured-data' | 'browser';

  searchProducts(query: ProductSearchInput): Promise<ExternalProduct[]>;
  getProductDetails(url: string): Promise<ExternalProductDetails>;
}
```

`sourceKind` is deliberately part of the interface: how data was obtained is
operationally and legally significant, and it appears in logs.

## Boundary validation

Provider output is third-party data, so it is validated with
`externalProductSchema` before it is allowed any further. A single malformed row
is **dropped and logged**, not allowed to fail the batch:

```ts
const parsed = externalProductSchema.safeParse(candidate);
if (parsed.success) data.push(parsed.data);
else logger.warn('Discarded malformed product from provider', { … });
```

A negative price or a missing id must never reach the database.

## Failure isolation

`registry.searchAll()` returns a `ProviderResult<T>` per store rather than
throwing:

```ts
type ProviderResult<T> =
  | { ok: true;  provider: string; data: T;                durationMs: number }
  | { ok: false; provider: string; error: ProviderFailure; durationMs: number };
```

A store being down degrades the result set instead of failing the user's request
— the "gracefully handle unavailable stores" requirement. Requests run with a
concurrency cap so we are not a bad neighbour.

### Retry policy

`ProviderFailure.retryable` is set by failure kind, and `withRetry` obeys it:

| Kind | Retryable | Why |
|---|---|---|
| `timeout`, `network` | ✅ | Transient |
| `blocked` (403/429) | ❌ | The site told us to stop. Retrying is how crawlers get banned. |
| `not-found` (404) | ❌ | Will not fix itself |
| `invalid-data` | ❌ | Malformed markup will not fix itself |

Backoff is exponential with jitter, so concurrent failures do not synchronise
into a thundering herd. All of this is asserted in `http/retry.test.ts`.

## Mock mode (the default)

`PROVIDER_MODE=mock` uses bundled catalogues — 14 products per store, 42 total,
with no network access. It is not a stub: it implements the same interface,
applies the same filters, validates the same way, and can be told to be slow or
to fail (`PROVIDER_MOCK_FAILURE_RATE`), so loading and error states are exercised
in development rather than discovered in production.

### Deterministic synthetic history

Each product declares a *pattern* rather than random noise, and
[`history.ts`](../packages/store-providers/src/mock/history.ts) generates a daily
series seeded from a hash of the product's external id. Re-seeding is
byte-for-byte reproducible, which keeps tests and screenshots stable.

| Pattern | Purpose |
|---|---|
| `steady` | The common case — small wobbles |
| `declining` | A real, earned discount |
| `rising` | Should be labelled "Price increased" |
| `volatile` | Large swings both ways |
| `permanent-sale` | **The fake discount** — never actually cheaper than the "sale" price |
| `dropped-to-low` | Flat, then a genuine drop to an all-time low |
| `spiked` | A temporary rise that has come back down |

The seeded catalogue deliberately contains all of them, plus an out-of-stock
item, a pre-order, free and paid delivery, and items with **no published
delivery cost** (distinct from free). Without that variety every product would
score alike and the deal-quality feature would be invisible on a fresh install.

A test asserts the `permanent-sale` pattern actually trips the fake-discount
detector — the fixture and the feature are verified together.

## Live mode

`PROVIDER_MODE=live` loads the real adapters through a dynamic import, so the
default install never even loads Playwright.

### Two-stage read, cheapest first

```
1. HTTP GET  →  parse schema.org/Product JSON-LD     ← preferred
2. only if that fails:
   render in Chromium  →  JSON-LD again  →  DOM selectors  ← last resort
```

Structured data is preferred because it is published deliberately for exactly
this kind of consumption, it survives redesigns (CSS classes do not), and it
needs no browser — a GET plus a JSON parse is far lighter on the store than
rendering their site.

`structured-data.ts` walks `@graph`, handles `@type` arrays, tolerates malformed
blocks alongside good ones, maps `ItemAvailability` onto our enum, reads
published shipping rates, and **returns null when there is no price** — a
priceless record is useless for price tracking and must not enter the database.
Price strings are parsed by the shared `parseAmount`, which disambiguates
`1.099,00` from `1,099.00` (getting that wrong turns €1,099 into €1.10 — it did,
once; there is now a test).

### Guardrails, enforced in code

- `assertCrawlAllowed()` before **every** fetch; fails closed on a disallow.
- `Crawl-delay` raises the per-store request interval.
- Requests serialised and paced per store (`RequestPacer`).
- Honest `User-Agent` with a contact URL. Never a spoofed browser string.
- One browser per process, launched lazily; a fresh context per operation, closed
  afterwards; no cookie persistence.
- Images, fonts, media, stylesheets and analytics aborted — we need the price.
- Hard navigation and operation timeouts.

### Live search is intentionally empty

```ts
async searchProducts(): Promise<ExternalProduct[]> {
  return [];
}
```

Crawling a store's search results to build a catalogue is the most aggressive and
least defensible thing this system could do. Price tracking does not need it:
live mode refreshes *known* products, and catalogue population belongs to an
affiliate feed. See [legal-and-ethics.md](legal-and-ethics.md#why-live-search-is-deliberately-unimplemented).

## Adding a store

### With an official API or feed (preferred)

Implement `StoreProvider` directly, set `sourceKind: 'api'`, register it in
`registry.ts` (mock) or `live/index.ts` (live). Add a `Store` row via the seed or
a migration. Nothing else changes.

### As a sample catalogue

1. Add `mock/data/<store>.ts` exporting a `MockStoreDataset`.
2. Add it to `MOCK_DATASETS` in `registry.ts` and to `DATASETS` in
   `prisma/seed.ts`.
3. `npm run db:seed`.

### As a live adapter

Add a descriptor to `createLiveProviders()` — the shared base handles robots.txt,
pacing, JSON-LD and the rendered fallback:

```ts
createLiveProvider({
  name: 'Example Store',
  slug: 'example',
  websiteUrl: 'https://www.example.fi',
  minRequestIntervalMs: 2_000,
  readySelector: '[data-testid="price"]',
  async extractFromDom(page) { /* last-resort selectors */ },
});
```

Adding a store is a descriptor, not new machinery. Selectors are a last resort
and **will** break on a redesign — which is why the JSON-LD path is tried first
and the DOM path raises `ProviderInvalidDataError` (non-retryable) rather than
guessing.

## Ingestion

Providers do not write to the database. `apps/api` passes their output to
`upsertProductFromSource()` in
[`packages/db/src/ingestion.ts`](../packages/db/src/ingestion.ts), the single
writer for product prices. It:

- upserts on `(storeId, externalId)` — idempotent by construction;
- recomputes the derived `discountPercent` in exactly one place;
- writes a `PriceHistory` row **only** for a new product or a changed price.

The seed script uses the same path, so ingestion is exercised from the first
`db:seed` rather than only in production.
