/**
 * Synthetic price history for the sample dataset.
 *
 * Two properties matter:
 *
 *  - **Deterministic.** The series is derived from a hash of the product's
 *    external id, so re-seeding produces byte-identical history. Tests and
 *    screenshots stay stable, and `db:reset` is reproducible.
 *  - **Shaped by intent.** Each product declares a *pattern* rather than
 *    random noise, so the seeded catalogue deliberately contains a genuine
 *    all-time low, a permanent fake "sale", a rising price and a volatile one.
 *    That is what makes the deal-quality scoring visible on first run instead
 *    of every product looking identical.
 */

export const PRICE_PATTERNS = [
  /** Small wobbles around a stable price — the common case. */
  'steady',
  /** Gradual decline to today's price: a real, earned discount. */
  'declining',
  /** Creeping upward — should be labelled "Price increased". */
  'rising',
  /** Large swings both ways. */
  'volatile',
  /** Never actually sells for the "original" price: the fake discount. */
  'permanent-sale',
  /** Flat for months, then a genuine drop to an all-time low right now. */
  'dropped-to-low',
  /** A temporary spike that has since come back down. */
  'spiked',
] as const;
export type PricePattern = (typeof PRICE_PATTERNS)[number];

export interface HistorySpec {
  pattern: PricePattern;
  /** How many days of history to synthesise. */
  days: number;
  /**
   * Where the series begins. Ignored by `permanent-sale`, which stays at the
   * current price throughout — that is the whole point of it.
   */
  startPrice?: number;
}

export interface GeneratedPricePoint {
  price: number;
  recordedAt: string;
}

/** Deterministic 32-bit hash of a string, used to seed the PRNG. */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32 — small, fast, good enough, and reproducible. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 86_400_000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Build a daily series that ends at `currentPrice` on `now`.
 *
 * @param externalId Seeds the PRNG, making the output reproducible.
 * @param currentPrice Today's price — always the final point.
 * @param now End of the series. Injected so seeding is testable.
 */
export function generatePriceHistory(
  externalId: string,
  currentPrice: number,
  spec: HistorySpec,
  now: Date = new Date(),
): GeneratedPricePoint[] {
  const random = createRandom(hashString(externalId));
  const days = Math.max(2, Math.floor(spec.days));
  const end = now.getTime();
  const start = spec.startPrice ?? currentPrice;

  const points: GeneratedPricePoint[] = [];

  for (let dayIndex = days - 1; dayIndex >= 0; dayIndex -= 1) {
    // 0 at the oldest point, 1 at today.
    const progress = (days - 1 - dayIndex) / (days - 1);
    const jitter = (random() - 0.5) * 2; // −1..1
    let price: number;

    switch (spec.pattern) {
      case 'declining':
      case 'rising':
        // Interpolate start → current, with mild noise that fades out so the
        // series lands exactly on today's price.
        price = start + (currentPrice - start) * progress + jitter * start * 0.012 * (1 - progress);
        break;

      case 'volatile':
        price =
          start + (currentPrice - start) * progress + Math.sin(progress * 9) * start * 0.06 + jitter * start * 0.02;
        break;

      case 'permanent-sale':
        // Hovers on the "discounted" price for the entire period, so its
        // recorded average equals what the store calls a special offer.
        price = currentPrice * (1 + jitter * 0.004);
        break;

      case 'dropped-to-low':
        // Flat until the last ~15% of the window, then a real drop.
        price =
          progress < 0.85
            ? start * (1 + jitter * 0.01)
            : start + (currentPrice - start) * ((progress - 0.85) / 0.15);
        break;

      case 'spiked': {
        // A bump peaking mid-window, decaying back to today's price.
        const spike = Math.exp(-((progress - 0.5) ** 2) / 0.01) * start * 0.18;
        price = start + (currentPrice - start) * progress + spike + jitter * start * 0.01;
        break;
      }

      case 'steady':
      default:
        price = start * (1 + jitter * 0.018) + (currentPrice - start) * progress;
        break;
    }

    points.push({
      price: round2(Math.max(1, price)),
      recordedAt: new Date(end - dayIndex * DAY_MS).toISOString(),
    });
  }

  // The final observation is today's advertised price, exactly.
  const last = points[points.length - 1];
  if (last) last.price = round2(currentPrice);

  return points;
}
