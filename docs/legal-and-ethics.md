# Legal and ethical considerations for product-data collection

**Read this before setting `PROVIDER_MODE=live`.**

This document is not boilerplate. Collecting pricing data from websites is
legally constrained, and the constraints shaped how this code is written. If you
enable live collection, you — the operator — are responsible for compliance in
your jurisdiction.

---

## The short version

1. **A permissive `robots.txt` is not permission.** This code checks and obeys
   robots.txt; that does not make scraping lawful.
2. **Terms of Service govern.** Many retailers explicitly prohibit automated
   access or price extraction. Read them. Where prohibited, do not proceed.
3. **Prefer an official API, affiliate feed, or data licence.** All three MVP
   stores are reachable through affiliate networks. That is the correct
   production route, both legally and operationally.
4. **Never circumvent access controls.** No CAPTCHA solving, no bot-protection
   evasion, no paywall or login-wall bypass, no user-agent spoofing. This
   codebase contains no such capability and none should be added.

## Legal frameworks that apply in the EU/Finland

This is an orientation, **not legal advice**. Obtain advice for your situation.

| Framework | Why it matters here |
|---|---|
| **Terms of Service** (contract) | Usually the most direct restriction. Accessing a site can bind you to terms that prohibit automated collection. Breach is a contractual matter regardless of technical feasibility. |
| **EU Database Directive 96/9/EC** — sui generis right | A database assembled with substantial investment is protected *independently of copyright*. Extracting or re-utilising a substantial part — including repeatedly extracting insubstantial parts — can infringe. A retailer's product catalogue and pricing data can qualify. This is the single most commonly overlooked risk for a price-comparison product. |
| **Copyright** | Product descriptions and photographs are typically protected. Bare facts (a numeric price) generally are not, but the surrounding text and images are. |
| **GDPR** | Product pages should contain no personal data, but reviews, seller names and Q&A sections often do. Do not collect it; if encountered, do not store it. |
| **Unfair-competition / marketing law** | How you *present* collected prices matters. Stale or misleading price claims can create liability independent of how the data was obtained. Finnish and EU consumer-protection rules on price indication are relevant if you show "was/now" pricing. |
| **Computer-misuse law** | Circumventing technical access controls can be criminal, not merely a breach of contract. Never do it. |

Two implications for this project specifically:

- **Store only what you need.** This app stores a numeric price, availability, a
  name, a URL and a timestamp. It does not mirror descriptions or images from
  live sites (the sample catalogue's text is our own).
- **Price history is our own record.** The observations we accumulate are our
  measurements over time, not a copy of anyone's database — which is both a
  better legal position and the thing that makes the product useful.

## What this code does about it

These are enforced in code, not merely documented:

| Commitment | Where |
|---|---|
| Live collection off unless explicitly enabled | `PROVIDER_MODE=mock` default; live adapters are behind a dynamic import that is never reached otherwise |
| robots.txt fetched, parsed, obeyed; **fails closed** on a disallow | [`live/robots.ts`](../packages/store-providers/src/live/robots.ts) — `assertCrawlAllowed()` runs before every fetch and throws `ProviderBlockedError` |
| `Crawl-delay` honoured | Parsed from robots.txt and raises the per-store request interval |
| Honest user-agent, with contact URL | `USER_AGENT` in [`fetch-with-timeout.ts`](../packages/store-providers/src/http/fetch-with-timeout.ts) — never a spoofed browser string |
| 403/429 treated as "stop", never retried | `ProviderBlockedError` is non-retryable by construction; asserted by tests |
| Published structured data preferred over scraping markup | [`structured-data.ts`](../packages/store-providers/src/live/structured-data.ts) — JSON-LD first, DOM last |
| Plain HTTP GET preferred over launching a browser | Two-stage read in [`base-provider.ts`](../packages/store-providers/src/live/base-provider.ts) |
| Requests serialised and paced per store | `RequestPacer` in `base-provider.ts` |
| Images, fonts, media and analytics blocked when a browser *is* used | [`browser.ts`](../packages/store-providers/src/live/browser.ts) — we need the price, not the assets |
| Bounded timeouts and retries everywhere | `AbortController` + `withRetry` |
| **No catalogue crawling** | `searchProducts()` returns `[]` in live mode, by design |
| No cookie persistence between runs | Fresh browser context per operation |

### Why live search is deliberately unimplemented

Crawling a store's search results to build a catalogue is the highest-volume,
least-defensible thing this system could do: it is what ToS clauses target, it is
where sui generis database rights bite hardest, and it places the most load on
someone else's infrastructure.

Price *tracking* does not need it. Refreshing products a user has explicitly
chosen to watch is a small number of requests to pages they themselves visited.
So live mode does exactly that, and catalogue population is left to a licensed
feed. This is an architectural decision about what the product should be willing
to do, not an unfinished feature.

## Ethical practice beyond the legal minimum

- **Be a good neighbour.** Rate-limit conservatively. A price checked every six
  hours is as useful as one checked every minute, at a fraction of the cost to
  the store.
- **Do not misrepresent staleness.** Every price in this UI shows when it was
  last checked, and links out to the store to confirm.
- **Do not present heuristics as advice.** The deal score is labelled an
  automated heuristic, with its confidence and its reasoning shown.
- **Attribute and link.** Every product links to the store's own page. The point
  is to send the user there, not to substitute for it.
- **Respond to objections.** Publish contact details in the user-agent and honour
  removal requests promptly.

## Enabling live mode responsibly

1. Read each target site's Terms of Service and robots.txt yourself.
2. Check for an official API or affiliate programme first — use it if it exists.
3. Confirm your jurisdiction's position on database rights and scraping.
4. Set a conservative `PROVIDER_MAX_CONCURRENCY` and a real contact URL in
   `USER_AGENT`.
5. Start with a handful of products and watch the logs.
6. Re-check periodically: terms change, and a redesign can turn a working adapter
   into an accidental hammer.

If you are unsure about any of the above, stay in mock mode or use an official
feed. The application is fully functional either way.
