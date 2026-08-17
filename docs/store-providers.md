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

  // ── Destination members ──────────────────────────────────────────────────
  storeCountry: CountryCode;                          // where it ships from
  supportedDeliveryCountries: readonly CountryCode[]; // declared coverage
  supportedCurrencies: readonly Currency[];
  region: StoreRegion;                                // local | nordic | european
  isDemoStore: boolean;                               // a fictional retailer

  /** Explicit, never inferred. A provider must answer for itself. */
  supportsDestination(country: CountryCode): boolean;

  searchProducts(query: ProductSearchInput, ctx?: DestinationContext): Promise<ExternalProduct[]>;
  getProductDetails(url: string): Promise<ExternalProductDetails>;
  getOffer(productUrl: string, ctx: DestinationContext): Promise<ExternalStoreOffer>;
}
```

`sourceKind` is deliberately part of the interface: how data was obtained is
operationally and legally significant, and it appears in logs.

### The destination members are additive

Everything above the `searchProducts` line is new; nothing was removed or
re-typed. Two details make that a compatibility guarantee rather than a hope:

- **`DestinationContext` is optional on `searchProducts`.** An adapter that
  ignores it behaves exactly as before, and the price monitor's
  `getProductDetails` path — which has no destination and needs none — is
  untouched.
- **`getOffer` is a separate method.** Destination pricing did not change the
  meaning of an existing call; it added a call for a question that could not
  previously be asked.

### `supportsDestination()` is explicit, never inferred

A provider answers for itself rather than having the answer derived from its
metadata. `getOffer` for an unsupported destination throws a typed,
**non-retryable** `ProviderUnsupportedDestinationError` instead of returning a
guess or an empty offer — an empty offer would be indistinguishable from "free
delivery, no information", which is the one confusion this system must not make.

`externalStoreOfferSchema` validates the result at the boundary, exactly as
`externalProductSchema` does for products.

### Delivery rules: absence means "no"

A dataset declares delivery per destination:

```ts
deliveryRules: {
  DE: { shippingPrice: 0,    minDays: 1, maxDays: 3 },   // free domestically
  FI: { shippingPrice: 12.9, minDays: 3, maxDays: 6 },
  IT: { shippingPrice: null, minDays: 4, maxDays: 9 },   // delivers, cost unpublished
  // no SE key → does not ship to Sweden
}
```

Three states, and conflating any two of them produces a wrong price:

| Rule | Means |
|---|---|
| **No key for the country** | Does not ship there. The default is "no", never "yes" |
| `shippingPrice: null` | Ships there, but the cost is **not published** → delivered total is `null`, shown as unknown, never `0`, and can never win |
| `shippingPrice: 0` | Ships there **free** |

`freeOver` raises a threshold above which delivery becomes free.

### `StoreOffer` is the source of truth for deliverability

`supportedDeliveryCountries` on a provider or a `Store` row is **declared
capability**. It drives the region filter and the store listing. It is never
evidence that a *particular product* can be delivered:

> The UI may not say "ships to Finland" because the store's coverage array
> contains `FI`. It requires a `StoreOffer` row for
> `(productId, FI, currency)`.

One demo dataset deliberately declares Finland while one of its products has no
Finnish offer, and tests assert that this product is not offered as deliverable —
in the API response, on the card and in the comparison table. A fixture for the
inconsistency is the only way to know the rule is actually enforced rather than
merely intended.

### Demo-store metadata and the synthetic-catalogue policy

`isDemoStore` travels from the dataset through the provider, into the `Store` row,
out through the API DTO and into the UI, where it renders as *"Demo store — a
fictional retailer with synthetic prices, for demonstration only"* plus a footnote
defining the term where offers are tabulated. It is text, not a coloured badge: a
disclosure nobody can reach by touch or by screen reader is not a disclosure.

The policy for synthetic data:

- **Seven of the ten providers are invented retailers.** Their names, catalogues,
  prices, delivery rules and history are fixtures. They are not observations of
  any real shop, and must never be presented as such.
- **Every synthetic dataset says so in its file header**, matching the convention
  the three Finnish datasets already used.
- **They exist to make behaviour visible**, not to inflate coverage: two quote in a
  foreign currency so conversion is exercised, one publishes no delivery cost for
  some items, one does not ship to Finland, and one overstates its coverage.
- **Reserved identifiers are off limits.** No dataset may publish the EANs used by
  the Sony trio or the deliberately-unmerged Philips pair; the seed checks this,
  because a collision would silently change cross-store offer counts that the
  end-to-end suite asserts.

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

`PROVIDER_MODE=mock` uses bundled catalogues — **ten stores, 115 products** — with
no network access. It is not a stub: it implements the same interface, applies the
same filters, validates the same way, and can be told to be slow or to fail
(`PROVIDER_MOCK_FAILURE_RATE`), so loading and error states are exercised in
development rather than discovered in production.

| Store | Country | Region | Currency | Kind |
|---|---|---|---|---|
| Gigantti | FI | local | EUR | Models a real retailer |
| Power | FI | local | EUR | Models a real retailer |
| Verkkokauppa.com | FI | local | EUR | Models a real retailer |
| Nordbyte AB | SE | nordic | SEK | Synthetic demo store |
| Danske Elektro A/S | DK | nordic | DKK | Synthetic demo store |
| TechHalle GmbH | DE | european | EUR | Synthetic demo store |
| Kanaalshop B.V. | NL | european | EUR | Synthetic demo store |
| Maison Numérique SAS | FR | european | EUR | Synthetic demo store |
| Ibérica Digital S.L. | ES | european | EUR | Synthetic demo store |
| Adriatica Tech S.r.l. | IT | european | EUR | Synthetic demo store |

The three Finnish datasets keep their original prices unchanged — the end-to-end
suite asserts them — and gained only country, region and delivery metadata.

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

## Adding a real store: the integration priority

DealFinder compares *selected* retailers. Each one is integrated individually, and
the source is chosen from this order — **highest first, and you stop at the
first one that is available**:

| # | Source | Why it ranks here |
|---:|---|---|
| 1 | **Official retailer API** | Explicitly offered for this purpose, with terms you can read, a contract you can rely on, rate limits you can honour, and a schema that will not break on a redesign |
| 2 | **Affiliate or product feed** | Permission is the point of the programme; the data is published *for* comparison, is usually more complete than a page, and the commercial relationship makes the product viable |
| 3 | **Merchant feed** (retailer-supplied file or endpoint) | The retailer chose what to publish and how often. Same permission story, less standardised than an affiliate network |
| 4 | **Public structured data** (`schema.org/Product` JSON-LD) | Published deliberately for machine consumption, survives redesigns, and costs the store a single GET rather than a rendered page. Still subject to ToS and database rights — see [legal-and-ethics.md](legal-and-ethics.md) |
| 5 | **Explicitly permitted retrieval** | Written permission for a specific, paced, documented access pattern. Get it in writing; record who granted it and when |

**Below this list there is nothing.** Broad catalogue scraping is not a lower
priority — it is not an option. It is the highest-volume, least-defensible thing
this system could do, and `searchProducts()` returns `[]` in live mode precisely so
the capability does not exist to be reached for under deadline pressure.

Before adding any real retailer:

1. Read its Terms of Service and robots.txt yourself.
2. Establish which tier above applies, and record it in the adapter as
   `sourceKind`.
3. Confirm the delivery destinations and currencies it *actually* serves, and
   express them as explicit rules — an absent rule means "does not ship there".
4. Decide the delivered-price treatment: does the published price include VAT for
   the destination, and can the route attract duty?
5. Keep `isDemoStore: false` and make sure nothing about it reads as synthetic —
   and equally, never let a synthetic store read as real.

## Adding a store

### With an official API or feed (preferred)

Implement `StoreProvider` directly, set `sourceKind: 'api'`, register it in
`registry.ts` (mock) or `live/index.ts` (live). Add a `Store` row via the seed or
a migration. Nothing else changes.

### As a sample catalogue

1. Add `mock/data/<store>.ts` exporting a `MockStoreDataset`, with a file header
   stating plainly whether the store and its prices are fictional.
2. Set `countryCode`, `region`, `supportedCurrencies`,
   `supportedDeliveryCountries`, `vatRegistrationCountry`, `isDemoStore` and
   `deliveryRules` — remembering that a missing rule means "does not ship there".
3. Add it to `MOCK_DATASETS` in `registry.ts` and to `DATASETS` in
   `prisma/seed.ts`.
4. Check you have not reused a reserved EAN.
5. `npm run db:seed`.

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

Destination offers have their own single writer,
[`packages/db/src/offers.ts`](../packages/db/src/offers.ts):
`upsertStoreOfferFromSource()` is idempotent on
`(productId, countryCode, currency)`, and `recordStoreOfferObservation()` writes a
`StoreOfferPriceHistory` row only when a destination-relevant value actually
changed — the same discipline, for the same reason.

The seed script uses both paths, so ingestion is exercised from the first
`db:seed` rather than only in production.
