# Cross-store product matching

The same headphones at three stores used to be three unrelated rows. This
document describes how they become one product with three offers, why the rules
are the shape they are, and what to do when the matcher gets something wrong.

The engine lives in `packages/shared/src/matching/`. It is pure — no database,
no clock, no network — so the seed script, the backfill job, the API and the
browser all run the identical code, and a match explained on the review page is
the same match the scoring pass made.

---

## The shape of the thing

```
Product (a store's listing)  ──canonicalProductId──▶  CanonicalProduct
                             ◀──────offers──────────
```

A canonical product is **not** a merge. Offers keep their own id, price,
history, watchlist entries and store, and simply point at one. Two consequences
follow, and both were the reason for the design:

- undoing a bad match is nulling one column, never reconstructing deleted rows;
- existing watchlists and price alerts still reference the *store listing* they
  always did, so this feature could be added without touching them.

`ProductMatchCandidate` is the review queue. It is also the memory that stops a
rejected pair being proposed again, which is why a rejection is a status change
and not a delete.

---

## The pipeline

### Stage 1 — identifiers (`identifiers.ts`)

When two listings publish the same GTIN they are the same product, and no amount
of title similarity is needed to prove it.

| rank | condition | score | method |
|---|---|---|---|
| 1 | both publish the same GTIN | 100 | `IDENTIFIER` |
| 2 | both publish the same EAN | 100 | `IDENTIFIER` |
| 3 | same brand **and** same MPN | 98 | `IDENTIFIER` |
| 4 | same brand, model number **and** category | 92 | `MODEL` |

Every identifier is normalised and **check-digit validated** before it counts. A
mis-parsed identifier produces a *confident* wrong answer rather than an
uncertain one, so the parser rejects anything it is not sure about and returns
`null` instead of throwing — this is third-party retail data, and malformed
input is expected.

An EAN is carried into the GTIN slot as well, so a store publishing only `ean`
still matches one publishing only `gtin`.

**The model-number stoplist is the most important guard here.** Without it
`128GB` is a "model number" and every 128 GB device on the market merges into
one product. Rejected: `\d+(GB|MB|TB)`, `4K|8K|FHD|QHD|UHD`, `USBC`, `HDMI\d*`,
bare years, `\d+(HZ|MAH|OHM|MM|W|IN|PA)`.

A stage-1 hit does **not** end the pipeline. Variant conflicts and the price
sanity guard still run — retailers do publish the wrong EAN, and the sample
catalogue contains a deliberate example.

### Stage 2 — normalisation (`normalize.ts`)

Turns `Sony WH-1000XM5 vastamelukuulokkeet, Musta` and
`Sony WH1000XM5 Wireless Headphones, Black` into comparable token sets.

The step order is load-bearing; each step is individually tested.

1. Strip HTML.
2. NFKD fold + remove combining marks — `näyttö → naytto`, which is what lets a
   Finnish and an English title meet.
3. Lowercase, without a locale (a Turkish locale maps `I` to a dotless ı and
   breaks every model number).
4. Fold typographic dashes, quotes, `×` and non-breaking spaces.
5. **Units**, before punctuation is stripped:
   - thousands separators, restricted to units that reach four figures — a bare
     `(\d) (\d{3})` rule would turn `iPhone 16 128 GB` into `iPhone 16128 GB`;
   - `TB → GB`, so `1 TB` and `1024 GB` are one token;
   - **capacity role tagging**: `ram:16gb`, `storage:512gb`, or `cap:128gb` when
     the title never says. Searched outward by distance, preferring the token
     *after* the number, because "16 GB RAM 512 GB SSD" puts both role words one
     token from both capacities;
   - screen `13" / 13,6 tuumaa / 13.6 inch → 13.6in`; watts, millimetres
     (ranges first, so `18-45 mm` survives), mAh, ohms;
   - resolution aliases `2160p|uhd → 4k`.
6. Collapse model separators to a fixed point: `wh-1000xm5 → wh1000xm5`.
   Digit–hyphen–digit is left alone so `18-45mm` survives.
7. Split hyphenated *words*: `over-ear → over ear`. Stores disagree about this
   constantly and it costs real similarity on otherwise identical titles.
8. **Remove marketing phrases** (FI/EN/SV), and a trailing ` | Store` suffix.
9. **Lift out the category noun**, reusing the vertical's own synonym index —
   no second taxonomy. Synonyms are diacritic-folded to match folded tokens.
10. Strip punctuation, keeping `+` (`S25+`), `.` (`6.2`), `-` (`18-45`) and `:`.
11. A deliberately tiny stopword list.

`normaliseProductName` is idempotent and deterministic; both are property-tested.

> **The `PROTECTED_TERMS` list in `marketing.ts` is a safety mechanism.** An
> over-eager marketing list is the single easiest way to turn this feature into
> a bad-merge generator: strip `pro` and every iPhone merges with every iPhone
> Pro. A guard runs at module load and throws if any marketing phrase is built
> entirely from protected words.

### Variant attributes (`variants.ts`)

Normalisation makes titles comparable. This layer stops "comparable" becoming
"identical" for products a shopper would not accept as substitutes.

Material axes per category:

| category | axes that may block a merge |
|---|---|
| phones | storage, generation, pack quantity |
| tablets | storage, screen size, connectivity, generation, pack quantity |
| laptops | storage, memory, CPU, GPU, screen size, generation, pack quantity |
| televisions, monitors | screen size, generation, pack quantity |
| headphones | impedance, generation, pack quantity |
| smartwatches | case size, connectivity, generation, pack quantity |
| gaming | storage, edition, generation, pack quantity |
| accessories | **colour**, storage, pack quantity |
| everything else | generation, pack quantity |

**Colour is material only for accessories.** A black and a white Sonos Era 100
at the same price are the same purchase decision and *should* compare together;
a black and a blue phone case are separate SKUs a shopper searches for
individually. One table entry, not a special case in code.

Two severities:

| severity | cap | meaning |
|---|---|---|
| `BLOCKING` | 40 — below the review threshold, so **no row is written at all** | different products |
| `REVIEWABLE` | 70 — below auto-attach | probably different; ask a person |

Rules worth knowing:

- **Screen size is compared relatively** (≤ 6 %). The same MacBook Air is
  advertised as 13" and 13.6" — 4.4 % apart, one product — while 55" vs 65" is
  15 % and 11" vs 12.9" is 14.7 %. No absolute tolerance separates those.
- **Pack quantity defaults to 1**, so a single item versus a four-pack is always
  comparable and always blocking.
- **An unmarked generation is generation 1**, so "gen 2 vs unmarked" is a real
  difference rather than missing data.
- **Unknown-role capacities are compared as a set.** This is the only thing
  keeping `iPhone 16 128 GB` apart from `iPhone 16 256 GB`, since every other
  signal agrees perfectly.

### Stage 3 — weighted scoring (`score.ts`)

Weights, normalised over the factors that could actually be evaluated, so a
missing signal is neutral rather than punitive:

| factor | weight |
|---|---|
| identifier | 40 |
| model number | 22 |
| brand | 20 |
| name similarity | 18 |
| variant attributes | 12 |
| category | 8 |

Name similarity is a **weighted Dice coefficient** over identity tokens, not an
edit distance: titles are bags of facts in arbitrary order. Tokens containing
digits carry double weight, because that is where model fragments live.

**Conflicts cap rather than subtract.** A weighted mean is a good way to rank
plausible pairs and a terrible way to reject implausible ones — 95 % name
agreement will out-vote a storage mismatch every time. So:

1. any `BLOCKING` conflict → cap 40
2. any `REVIEWABLE` conflict → cap 70
3. prices differing by more than **3×** → cap 55, plus a stated reason
4. an identifier shared across unrelated categories → cap 70

#### Confidence

```
HIGH   = score ≥ 88, no conflicts, and one of:
           · a matching identifier, or
           · brand (or brand alias) + exact model number, or
           · brand + category + name ≥ 85 % + a confirmed substantive specification
MEDIUM = score ≥ 62, no blocking conflict, and either hard evidence or name ≥ 45 %
LOW    = otherwise
```

Three clauses do the safety work:

- **Name similarity alone can never reach HIGH.** A 0.97 Dice score with no
  brand, no model number and no confirmed specification is a coincidence until a
  human says otherwise.
- **Pack quantity does not count as a "confirmed specification".** It defaults
  to 1 on every subject, so "1 versus 1" agrees for free.
- **Below 45 % name similarity, a pair with no identifier and no model number is
  not even queued.** Same brand, same category and an agreeing pack quantity is
  enough to drag two unrelated products into the mid-seventies otherwise.

**Anything below the review threshold is discarded, never written.** That is a
stronger reading of "never silently merge low-confidence matches" than
persisting a row and filtering it later.

### Stage 4 — optional AI review (`review.ts`)

An interface and a no-op. There is **no implementation, no model client, no API
key and no network dependency** anywhere in the matching path.

Authority rules, enforced by the orchestrator rather than the reviewer, so an
implementation cannot widen its own remit:

- `REJECT` is always honoured — a veto is safe in a way an endorsement is not;
- `CONFIRM` marks the candidate `AI_CONFIRMED` and surfaces it pre-endorsed, but
  it still needs the human approve call unless `MATCH_AI_AUTO_APPROVE=true`;
- `ABSTAIN` changes nothing.

A verdict can never override an identifier conflict, override a deterministic
variant conflict, or raise a pair that scored below the review threshold. Only
ambiguous MEDIUM candidates are eligible at all.

---

## Thresholds

Configured via env (`apps/api/src/env.ts`), defaults in
`packages/shared/src/matching/config.ts`:

| setting | default | effect |
|---|---|---|
| `MATCH_AUTO_ATTACH_MIN_SCORE` | 88 | raise it to group less and review more |
| `MATCH_REVIEW_MIN_SCORE` | 62 | raise it to shrink the queue by discarding weaker pairs |
| `MATCH_AI_REVIEW_ENABLED` | `false` | — |
| `MATCH_AI_AUTO_APPROVE` | `false` | — |

Boot fails if the review threshold is not below the auto-attach threshold, since
that would silently turn the review queue off.

The confidence rules and the conflict caps are deliberately **not** configurable.

---

## Operating it

```bash
npm run db:migrate          # additive: new tables + nullable columns, zero DML
npm run db:match            # attach what can be attached, queue the rest
npm run db:match -- --force # recompute from scratch, preserving human decisions
npm run db:seed             # idempotent; runs matching as its last pass
```

**Run these one at a time.** The development database accepts a single
connection (`DATABASE_POOL_MAX=1`), so the API, the seed and the test suite
cannot overlap.

`--force` first discards every machine-made decision — machine attachments,
`PENDING` and `SUPERSEDED` candidates, and canonical records left describing
nothing — then recomputes. `APPROVED` and `REJECTED` rows and `MANUAL`
attachments are preserved. Without that preamble, a canonical record created by
an older engine version keeps its stale identity fields forever and every later
listing is matched against it rather than against current data.

### When the matcher gets it wrong

| symptom | fix |
|---|---|
| two different products grouped | `POST /api/products/:id/rematch { "force": true }` on the wrong offer, then reject the candidate it regenerates |
| the same product split in two | approve the candidate in `/admin/match-review`, or add the missing identifier to the store data |
| a stale explanation | `npm run db:match -- --force`; `MATCHER_VERSION` is stored on every decision so stale ones are recognisable |

---

## Known limits

- **Candidate retrieval is linear past roughly six figures of canonical
  products.** The `normalizedName` prefix branch is the one that degrades. The
  upgrade is `pg_trgm` plus a GIN index, and it is a change to
  `findCandidateCanonicals` in `packages/db/src/matching.ts` plus one migration
  — which is why that lookup is isolated in a single function. Not built now:
  there is no `pg_trgm` precedent in this repo and PGlite support would need
  verifying first.
- **Canonical sorting by price spread is not offered.** Spread is not an
  indexable column, and sorting a *paginated* list by a computed value reorders
  rows across page boundaries. The honest fix is a maintained column, by the
  same argument that justifies `Product.discountPercent`.
- **Only the electronics vertical has variant axes defined.** A new vertical
  falls back to generation and pack quantity, which is safe but coarse.
- **Match quality depends on stores publishing identifiers.** Only some of the
  sample catalogue does, deliberately — that is the realistic case.

---

## Migration notes

`prisma/migrations/20260801160000_canonical_products` is purely additive:
3 `CREATE TYPE`, 2 `CREATE TABLE`, 8 nullable `ADD COLUMN` on `products`,
15 indexes, 3 foreign keys. **No `DROP`, no `ALTER COLUMN`, no `NOT NULL` on an
existing table, and zero DML.** Backfill is the separate, re-runnable
`npm run db:match`.

Prisma has no down migrations. The manual inverse, should it ever be needed:

```sql
DROP TABLE "product_match_candidates";
DROP TABLE "canonical_products";
ALTER TABLE "products"
  DROP COLUMN "canonicalMatchMethod", DROP COLUMN "canonicalMatchScore",
  DROP COLUMN "canonicalMatchedAt",   DROP COLUMN "canonicalProductId",
  DROP COLUMN "ean",                  DROP COLUMN "gtin",
  DROP COLUMN "modelNumber",          DROP COLUMN "mpn";
DROP TYPE "MatchCandidateStatus";
DROP TYPE "MatchConfidence";
DROP TYPE "MatchMethod";
```

Because nothing was transformed, that restores the exact prior state.
