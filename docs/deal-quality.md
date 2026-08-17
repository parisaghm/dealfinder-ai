# Deal quality: how the score works

The product's premise is that **a crossed-out price is a claim, not evidence**.
This document explains what replaces it.

Implementation:
[`packages/shared/src/pricing/deal-quality.ts`](../packages/shared/src/pricing/deal-quality.ts).
Pure, deterministic, no I/O, no clock — so it is testable and so the API and the
browser always agree.

---

## Design constraints

1. **Explainable.** Every factor returns a sentence a person can check against
   the chart above it. A bare number invites false precision.
2. **Deterministic.** Same inputs, same score. No randomness, no wall clock.
3. **Honest about ignorance.** With no history, history-based factors score
   *neutral* and confidence drops — rather than inventing certainty.
4. **Not advice.** Every assessment carries a disclaimer, and the UI repeats it.

## The six factors

Weights total exactly 100, so the score is a true weighted percentage.

| Factor | Weight | Full marks when | Zero when |
|---|---:|---|---|
| `discount` | 30 | 40%+ off a **credible** original price | No claim, no reduction, or a claim our records contradict |
| `vs-average` | 24 | 25% below the recorded average | At or above the average |
| `vs-lowest` | 24 | At or below the recorded low | 15%+ above the recorded low |
| `trend` | 10 | Falling across recent checks | Rising steeply |
| `shipping` | 6 | Free delivery | Delivery ≥10% of the item price |
| `availability` | 6 | In stock | Out of stock |

### Why history comparisons use the item price, not the delivered price

Recorded history stores the item price. Comparing a shipping-inclusive figure
against a history of item prices would compare unlike quantities and make every
product with delivery look worse than its own past. Shipping is therefore scored
as its own factor — which also stops a delivery fee being counted twice. There
is a test asserting exactly this.

### Availability is scored, not filtered

An out-of-stock bargain is not a bargain, but it is still information. It scores
zero on availability and carries a warning, rather than being hidden.

## Labels

```
score ≥ 75  →  Excellent deal
score ≥ 55  →  Good deal
otherwise   →  Average price

…unless the price rose by more than 0.5% since the previous observation and the
score is below 70  →  Price increased
```

**Why the 0.5% floor:** real retail prices wobble by fractions of a percent
between checks. Calling a €0.30 movement on a €1,199 laptop a "price increase" is
technically true and practically useless. Early on, this exact bug labelled 8 of
the 42 products the seed contained at the time "Price increased" purely from
noise. The same threshold is used for trend detection, so the two agree.

**Why a strong deal overrides the rise:** a product that jumped €1 from an
all-time low is still an excellent price. The override applies only when the deal
is not otherwise strong.

## Detecting a fake discount

This is the part that matters most. Two independent signals, each requiring at
least **5 observations** before we are willing to contradict a store:

### 1. The permanent sale

```
currentPrice >= recordedAverage × 0.98
```

If the "discounted" price is essentially what the product always costs, the
advertised saving is not real.

> This "discounted" price is what the product normally costs (recorded average
> 348,86 €), so the advertised saving is not real.

### 2. The inflated original

```
claimedOriginalPrice > recordedHighest × 1.15
```

If the crossed-out price is well above anything we have ever seen charged, it was
not a real price.

> The stated original price of 499 € is well above the highest price we have ever
> recorded (350,38 €).

### The consequence is not just a warning

When either signal fires, **the `discount` factor scores 0** — the claim earns no
credit at all. Crediting a 50%-off claim we can actively disprove would defeat
the point of the product. The history factors then decide the outcome on their
own.

Worked example, from the seeded catalogue (Roborock Q7 Max, advertised at €349
down from €499, but recorded at ~€349 for 120 straight days):

| Factor | Score | Contribution |
|---|---:|---:|
| discount | **0** (claim unsupported) | 0.0 |
| vs-average | 0 (at its average) | 0.0 |
| vs-lowest | ~10 | 2.4 |
| trend | 55 (flat) | 5.5 |
| shipping | 100 (free) | 6.0 |
| availability | 100 | 6.0 |
| **Total** | | **≈ 41 → Average price** |

Without the zeroing rule the same product scores ~63 and reads "Good deal" — a
30%-off badge on a product that has never been cheaper. That difference is the
whole thesis of the application.

## Confidence

Derived purely from how many observations back the assessment:

| Observations | Confidence | Shown as |
|---:|---|---|
| ≥ 20 | HIGH | "Based on a long recorded price history" |
| 5–19 | MEDIUM | "Based on a limited price history" |
| 0–4 | LOW | "…very little price history so far, treat with caution" |

With zero history, `vs-average` and `vs-lowest` score a neutral **50** rather
than 0 or 100 — we do not know, and pretending otherwise in either direction
would be wrong. A brand-new product therefore reads roughly "Average price, low
confidence", which is the truthful answer.

## Calibration and its limits

The thresholds are **hand-chosen constants**, exported and documented at the top
of the module (`DISCOUNT_FULL_SCORE_PERCENT`, `BELOW_AVERAGE_FULL_SCORE_RATIO`,
`ABOVE_LOWEST_ZERO_SCORE_RATIO`, `PERMANENT_SALE_RATIO`,
`INFLATED_ORIGINAL_RATIO`, …). They are deliberately conservative: it is better
to under-call a good deal than to endorse a fake one.

They are **not** learned from outcome data. A production version should calibrate
against realised prices and per-category baselines, and account for seasonality
(a TV in November is not a TV in March). Until then, the numbers are transparent,
testable, and easy to adjust in one place — which is the right property for a
heuristic nobody should be treating as truth.

## Tests

`packages/shared/src/pricing/deal-quality.test.ts` covers: weights totalling 100,
every factor being explained, genuine all-time lows, both fake-discount signals,
refusing to accuse a store without enough evidence, price-increase labelling and
its noise floor, shipping not double-counting, availability, all four confidence
bands, determinism, and robustness against NaN/Infinity/absurd inputs.
