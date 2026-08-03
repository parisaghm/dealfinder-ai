import { type Currency } from '../schemas/common';
import {
  RATE_SCALE_EXPONENT,
  convertMoney,
  divideRounded,
  parseDecimalToScaled,
  type ExchangeRateSnapshot,
  type Money,
} from './money';

/**
 * Exchange-rate lookup and freshness.
 *
 * Two rules drive everything here, and both exist because a price-comparison
 * tool that quietly converts at a bad rate is worse than one that declines to
 * convert at all:
 *
 *  1. **A rate is never used without its timestamp.** Staleness is a first-class
 *     outcome, not a footnote.
 *  2. **A missing rate produces no number.** The offer is reported as
 *     incomparable, and it cannot win a cheapest-delivered comparison.
 *
 * The application must work with no live FX feed at all, so a seeded static
 * table is a supported production-shaped configuration — provided its rates
 * carry honest timestamps and the UI says how old they are.
 */

/** How a rate was obtained, so the UI can be honest about derived values. */
export type RateDerivation = 'direct' | 'inverted' | 'triangulated';

export interface ResolvedRate {
  readonly snapshot: ExchangeRateSnapshot;
  readonly derivation: RateDerivation;
}

export interface RateTable {
  /** The rate to convert `base` into `quote`, or null when unobtainable. */
  resolve(base: Currency, quote: Currency): ResolvedRate | null;
  readonly size: number;
}

const RATE_SCALE = 10n ** BigInt(RATE_SCALE_EXPONENT);

/** The pivot for triangulation. Every seeded pair includes EUR on one side. */
const PIVOT_CURRENCY: Currency = 'EUR';

function key(base: Currency, quote: Currency): string {
  return `${base}->${quote}`;
}

function scaledToDecimalString(scaled: bigint): string {
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(RATE_SCALE_EXPONENT + 1, '0');
  const integerPart = digits.slice(0, digits.length - RATE_SCALE_EXPONENT);
  const fractionPart = digits.slice(digits.length - RATE_SCALE_EXPONENT);
  return `${negative ? '-' : ''}${integerPart}.${fractionPart}`;
}

function invert(snapshot: ExchangeRateSnapshot): ExchangeRateSnapshot | null {
  const scaled = parseDecimalToScaled(snapshot.rate, RATE_SCALE_EXPONENT);
  if (scaled == null || scaled <= 0n) return null;

  // 1 / rate, held at the same scale. Rounded, not truncated — truncating here
  // would understate every inverted rate by up to one unit in the last place.
  const inverted = divideRounded(RATE_SCALE * RATE_SCALE, scaled);
  if (inverted <= 0n) return null;

  return {
    baseCurrency: snapshot.quoteCurrency,
    quoteCurrency: snapshot.baseCurrency,
    rate: scaledToDecimalString(inverted),
    fetchedAt: snapshot.fetchedAt,
  };
}

function multiplyRates(
  first: ExchangeRateSnapshot,
  second: ExchangeRateSnapshot,
): ExchangeRateSnapshot | null {
  const a = parseDecimalToScaled(first.rate, RATE_SCALE_EXPONENT);
  const b = parseDecimalToScaled(second.rate, RATE_SCALE_EXPONENT);
  if (a == null || b == null || a <= 0n || b <= 0n) return null;

  const product = divideRounded(a * b, RATE_SCALE);
  if (product <= 0n) return null;

  // The combined rate is only as fresh as its stalest leg. Taking the older
  // timestamp is what keeps the staleness check honest across a triangulation.
  const older =
    Date.parse(first.fetchedAt) <= Date.parse(second.fetchedAt) ? first.fetchedAt : second.fetchedAt;

  return {
    baseCurrency: first.baseCurrency,
    quoteCurrency: second.quoteCurrency,
    rate: scaledToDecimalString(product),
    fetchedAt: older,
  };
}

/**
 * Build a lookup over recorded rates.
 *
 * Resolution order is direct, then inverted, then triangulated through EUR.
 * Each step is labelled in the result so a derived rate can be presented as
 * what it is. Seeding a pair directly always beats deriving it.
 */
export function createRateTable(snapshots: readonly ExchangeRateSnapshot[]): RateTable {
  const direct = new Map<string, ExchangeRateSnapshot>();

  for (const snapshot of snapshots) {
    const existing = direct.get(key(snapshot.baseCurrency, snapshot.quoteCurrency));
    // Keep the freshest observation when a pair is recorded more than once.
    if (existing == null || Date.parse(snapshot.fetchedAt) > Date.parse(existing.fetchedAt)) {
      direct.set(key(snapshot.baseCurrency, snapshot.quoteCurrency), snapshot);
    }
  }

  /** Direct hit, else the inverse of the opposite pair. No triangulation. */
  function resolveLeg(base: Currency, quote: Currency): ResolvedRate | null {
    const exact = direct.get(key(base, quote));
    if (exact) return { snapshot: exact, derivation: 'direct' };

    const reverse = direct.get(key(quote, base));
    if (reverse) {
      const inverted = invert(reverse);
      if (inverted) return { snapshot: inverted, derivation: 'inverted' };
    }

    return null;
  }

  function resolve(base: Currency, quote: Currency): ResolvedRate | null {
    if (base === quote) return null;

    const leg = resolveLeg(base, quote);
    if (leg) return leg;

    // Neither direction was recorded. Route through the pivot, which every
    // seeded pair has on one side, so SEK→DKK works without seeding 42 pairs.
    if (base === PIVOT_CURRENCY || quote === PIVOT_CURRENCY) return null;

    const toPivot = resolveLeg(base, PIVOT_CURRENCY);
    const fromPivot = resolveLeg(PIVOT_CURRENCY, quote);
    if (toPivot == null || fromPivot == null) return null;

    const combined = multiplyRates(toPivot.snapshot, fromPivot.snapshot);
    if (combined == null) return null;

    return { snapshot: combined, derivation: 'triangulated' };
  }

  return { resolve, size: direct.size };
}

export interface StalenessAssessment {
  readonly ageHours: number;
  readonly isStale: boolean;
}

/** Age of a rate in hours. Negative clock skew is clamped to 0, never reported. */
export function rateAgeHours(snapshot: ExchangeRateSnapshot, now: number = Date.now()): number {
  const fetched = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(fetched)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - fetched) / 3_600_000);
}

export function assessStaleness(
  snapshot: ExchangeRateSnapshot,
  maxAgeHours: number,
  now: number = Date.now(),
): StalenessAssessment {
  const ageHours = rateAgeHours(snapshot, now);
  return { ageHours, isStale: ageHours > maxAgeHours };
}

export type ConversionStatus =
  | 'same-currency'
  | 'converted'
  | 'converted-stale'
  | 'rate-missing'
  | 'rate-unusable';

export interface ConversionOutcome {
  /** Null whenever the amount could not be converted honestly. */
  readonly converted: Money | null;
  readonly status: ConversionStatus;
  /** Null for a same-currency amount, which needs no rate. */
  readonly snapshot: ExchangeRateSnapshot | null;
  readonly derivation: RateDerivation | null;
  readonly ageHours: number | null;
  /**
   * True whenever a conversion happened at all. Converted money is always an
   * estimate — the store charges in its own currency and the card rate is not
   * the rate the shopper's bank will use — so it is always labelled as one.
   */
  readonly isEstimate: boolean;
  /**
   * True when this figure must not be presented as the guaranteed cheapest
   * delivered total.
   *
   * Distinct from `isEstimate` on purpose. A fresh conversion is an estimate but
   * is still good enough to rank on; a *stale* one is shown, labelled with its
   * age, and barred from winning. Barred is not the same as hidden — hiding it
   * would conceal a genuinely relevant offer.
   */
  readonly blocksCheapestClaim: boolean;
}

export interface ConvertOptions {
  readonly maxAgeHours: number;
  readonly now?: number;
}

/**
 * Convert with full provenance — the function mappers should call.
 *
 * A same-currency amount short-circuits before any rate is consulted, so a
 * domestic offer is never penalised for the state of the FX table.
 */
export function convertWithProvenance(
  money: Money,
  to: Currency,
  table: RateTable,
  options: ConvertOptions,
): ConversionOutcome {
  if (money.currency === to) {
    return {
      converted: money,
      status: 'same-currency',
      snapshot: null,
      derivation: null,
      ageHours: null,
      isEstimate: false,
      blocksCheapestClaim: false,
    };
  }

  const resolved = table.resolve(money.currency, to);
  if (resolved == null) {
    return {
      converted: null,
      status: 'rate-missing',
      snapshot: null,
      derivation: null,
      ageHours: null,
      isEstimate: false,
      blocksCheapestClaim: true,
    };
  }

  const converted = convertMoney(money, to, resolved.snapshot);
  if (converted == null) {
    return {
      converted: null,
      status: 'rate-unusable',
      snapshot: resolved.snapshot,
      derivation: resolved.derivation,
      ageHours: null,
      isEstimate: false,
      blocksCheapestClaim: true,
    };
  }

  const { ageHours, isStale } = assessStaleness(resolved.snapshot, options.maxAgeHours, options.now);

  return {
    converted,
    status: isStale ? 'converted-stale' : 'converted',
    snapshot: resolved.snapshot,
    derivation: resolved.derivation,
    ageHours,
    isEstimate: true,
    blocksCheapestClaim: isStale,
  };
}
