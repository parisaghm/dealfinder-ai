import type { Availability, Currency } from '../schemas/common';
import type {
  DealQuality,
  DealQualityConfidence,
  DealQualityFactor,
  DealQualityLabel,
} from '../schemas/deal-quality';
import type { PriceStatistics } from '../schemas/price';
import { formatMoney } from '../utils/format';
import { calculateDiscountPercent, calculatePercentChange, clamp, roundTo } from './discount';
import { calculatePriceStatistics, calculatePriceTrend, type PricePointInput } from './statistics';

/**
 * Deal-quality scoring.
 *
 * The premise of the product: a crossed-out price is a marketing claim, not
 * evidence. This module weighs the claimed discount against what the product
 * has *actually* cost over time, and reports how confident it is.
 *
 * Design constraints:
 *  - Explainable. Every factor returns a sentence a person can check.
 *  - Deterministic and pure. Same inputs, same score. No clock, no I/O.
 *  - Honest about ignorance. With no history the history-based factors score
 *    neutral and `confidence` drops to LOW, rather than inventing certainty.
 *  - Not advice. `disclaimer` travels with every assessment.
 */

// ── Weights (must total 100) ────────────────────────────────────────────────
export const DEAL_QUALITY_WEIGHTS = {
  discount: 30,
  vsAverage: 24,
  vsLowest: 24,
  trend: 10,
  shipping: 6,
  availability: 6,
} as const;

// ── Calibration thresholds ─────────────────────────────────────────────────
/** Discount that earns a full score on the discount factor. */
export const DISCOUNT_FULL_SCORE_PERCENT = 40;
/** Being this far under the recorded average earns a full score. */
export const BELOW_AVERAGE_FULL_SCORE_RATIO = 0.25;
/** Being this far above the recorded low earns zero on that factor. */
export const ABOVE_LOWEST_ZERO_SCORE_RATIO = 0.15;
/** Shipping at this share of the item price earns zero on the shipping factor. */
export const SHIPPING_ZERO_SCORE_SHARE = 0.1;

/** Minimum observations before we are willing to challenge a store's claim. */
export const MIN_SAMPLES_FOR_CLAIM_CHECK = 5;
/** Current price this close to the average means the "sale" is the normal price. */
export const PERMANENT_SALE_RATIO = 0.98;
/** A claimed original this far above the highest ever seen was never charged. */
export const INFLATED_ORIGINAL_RATIO = 1.15;

export const SCORE_EXCELLENT_MIN = 75;
export const SCORE_GOOD_MIN = 55;
/** A price rise only overrides the label when the deal is not otherwise strong. */
export const PRICE_INCREASED_MAX_SCORE = 70;
/**
 * How much a price must rise before it counts as an increase.
 *
 * Real retail prices wobble by fractions of a percent between checks. Calling a
 * €0.30 movement on a €1,199 laptop a "price increase" is technically true and
 * practically useless, so the same threshold used for trend detection applies
 * here.
 */
export const PRICE_INCREASE_MIN_PERCENT = 0.5;

export const CONFIDENCE_HIGH_MIN_SAMPLES = 20;
export const CONFIDENCE_MEDIUM_MIN_SAMPLES = 5;

export const DEAL_QUALITY_DISCLAIMER =
  'Deal quality is an automated heuristic based on the prices we have recorded, not financial advice. Always check the store listing yourself.';

const AVAILABILITY_SCORES: Record<Availability, number> = {
  IN_STOCK: 100,
  LOW_STOCK: 85,
  PREORDER: 55,
  UNKNOWN: 45,
  DISCONTINUED: 25,
  OUT_OF_STOCK: 0,
};

export interface DealQualityInput {
  currentPrice: number;
  originalPrice?: number | null;
  shippingPrice?: number | null;
  availability?: Availability;
  currency?: Currency;
  /**
   * Recent observations used for the trend factor. Order does not matter.
   * List endpoints pass a bounded window (e.g. the last 6 checks) so a page of
   * results never has to load a product's entire history.
   */
  recentHistory?: readonly PricePointInput[];
  /**
   * Aggregates over the *full* history. Supplied by the API from a single SQL
   * aggregate. Derived from `recentHistory` when omitted.
   */
  statistics?: PriceStatistics;
}

function confidenceFor(sampleSize: number): DealQualityConfidence {
  if (sampleSize >= CONFIDENCE_HIGH_MIN_SAMPLES) return 'HIGH';
  if (sampleSize >= CONFIDENCE_MEDIUM_MIN_SAMPLES) return 'MEDIUM';
  return 'LOW';
}

function labelFor(score: number, roseSinceLastCheck: boolean): DealQualityLabel {
  if (roseSinceLastCheck && score < PRICE_INCREASED_MAX_SCORE) return 'PRICE_INCREASED';
  if (score >= SCORE_EXCELLENT_MIN) return 'EXCELLENT';
  if (score >= SCORE_GOOD_MIN) return 'GOOD';
  return 'AVERAGE';
}

/**
 * Score a single offer.
 *
 * Note that the history-based factors compare against `currentPrice`, not the
 * shipping-inclusive price: recorded history stores the item price, so mixing
 * the two would compare unlike quantities. Shipping is scored as its own
 * factor instead, which also keeps it from being counted twice.
 */
export function scoreDealQuality(input: DealQualityInput): DealQuality {
  const currency = input.currency ?? 'EUR';
  const money = (value: number) => formatMoney(value, currency);

  const currentPrice = Number.isFinite(input.currentPrice) ? Math.max(0, input.currentPrice) : 0;
  const history = input.recentHistory ?? [];
  const statistics = input.statistics ?? calculatePriceStatistics(history);
  const trend = calculatePriceTrend(history);

  const { lowest, highest, average, previousPrice, sampleSize } = statistics;
  const hasHistory = sampleSize > 0 && average != null && lowest != null;

  const factors: DealQualityFactor[] = [];

  // ── Is the store's claim believable? ─────────────────────────────────────
  // Assessed first, because an unsubstantiated claim must not be allowed to
  // earn points on the discount factor below.
  const warnings: string[] = [];
  let claimedDiscountTrustworthy = true;

  if (input.originalPrice != null && sampleSize >= MIN_SAMPLES_FOR_CLAIM_CHECK) {
    if (average != null && average > 0 && currentPrice >= average * PERMANENT_SALE_RATIO) {
      claimedDiscountTrustworthy = false;
      warnings.push(
        `This "discounted" price is what the product normally costs (recorded average ${money(average)}), so the advertised saving is not real.`,
      );
    }
    if (highest != null && highest > 0 && input.originalPrice > highest * INFLATED_ORIGINAL_RATIO) {
      claimedDiscountTrustworthy = false;
      warnings.push(
        `The stated original price of ${money(input.originalPrice)} is well above the highest price we have ever recorded (${money(highest)}).`,
      );
    }
  }

  // ── 1. Advertised discount ───────────────────────────────────────────────
  // Scored on evidence, not on the marketing claim. A discount our own records
  // contradict earns nothing here — the whole point of the product — leaving
  // the history factors below to decide whether the price is actually good.
  const discountPercent = calculateDiscountPercent(currentPrice, input.originalPrice);
  factors.push({
    key: 'discount',
    label: 'Advertised discount',
    weight: DEAL_QUALITY_WEIGHTS.discount,
    score: claimedDiscountTrustworthy
      ? clamp((discountPercent / DISCOUNT_FULL_SCORE_PERCENT) * 100, 0, 100)
      : 0,
    detail:
      input.originalPrice == null
        ? 'The store does not advertise a previous price.'
        : !claimedDiscountTrustworthy
          ? `Advertised as ${discountPercent}% off ${money(input.originalPrice)}, but our recorded history does not support that claim, so it earns no credit here.`
          : discountPercent > 0
            ? `Advertised as ${discountPercent}% off ${money(input.originalPrice)}.`
            : `No genuine reduction: the listed price is not below the stated ${money(input.originalPrice)}.`,
  });

  // ── 2. Against the recorded average ──────────────────────────────────────
  if (hasHistory && average > 0) {
    const belowAverageRatio = (average - currentPrice) / average;
    factors.push({
      key: 'vs-average',
      label: 'Compared to its usual price',
      weight: DEAL_QUALITY_WEIGHTS.vsAverage,
      score: clamp((belowAverageRatio / BELOW_AVERAGE_FULL_SCORE_RATIO) * 100, 0, 100),
      detail:
        belowAverageRatio > 0.005
          ? `${money(average - currentPrice)} below its ${money(average)} recorded average.`
          : belowAverageRatio < -0.005
            ? `${money(currentPrice - average)} above its ${money(average)} recorded average.`
            : `Essentially identical to its ${money(average)} recorded average.`,
    });
  } else {
    factors.push({
      key: 'vs-average',
      label: 'Compared to its usual price',
      weight: DEAL_QUALITY_WEIGHTS.vsAverage,
      score: 50,
      detail: 'Not enough recorded history yet to know its usual price.',
    });
  }

  // ── 3. Against the recorded low ──────────────────────────────────────────
  if (hasHistory && lowest > 0) {
    const aboveLowestRatio = (currentPrice - lowest) / lowest;
    factors.push({
      key: 'vs-lowest',
      label: 'Compared to its best price',
      weight: DEAL_QUALITY_WEIGHTS.vsLowest,
      score: clamp(100 - (aboveLowestRatio / ABOVE_LOWEST_ZERO_SCORE_RATIO) * 100, 0, 100),
      detail:
        currentPrice <= lowest
          ? `Matches the lowest price we have recorded (${money(lowest)}).`
          : `${money(currentPrice - lowest)} above its recorded low of ${money(lowest)}.`,
    });
  } else {
    factors.push({
      key: 'vs-lowest',
      label: 'Compared to its best price',
      weight: DEAL_QUALITY_WEIGHTS.vsLowest,
      score: 50,
      detail: 'No recorded low to compare against yet.',
    });
  }

  // ── 4. Recent direction ──────────────────────────────────────────────────
  const trendScore =
    trend.direction === 'FALLING'
      ? clamp(60 + Math.abs(trend.changePercent) * 4, 0, 100)
      : trend.direction === 'RISING'
        ? clamp(40 - trend.changePercent * 4, 0, 100)
        : trend.direction === 'STABLE'
          ? 55
          : 50;
  factors.push({
    key: 'trend',
    label: 'Recent price direction',
    weight: DEAL_QUALITY_WEIGHTS.trend,
    score: trendScore,
    detail:
      trend.direction === 'FALLING'
        ? `Down ${Math.abs(trend.changePercent)}% across the last ${trend.sampleSize} checks.`
        : trend.direction === 'RISING'
          ? `Up ${trend.changePercent}% across the last ${trend.sampleSize} checks.`
          : trend.direction === 'STABLE'
            ? `Unchanged across the last ${trend.sampleSize} checks.`
            : 'Too few checks to establish a direction.',
  });

  // ── 5. Shipping ──────────────────────────────────────────────────────────
  const shipping = input.shippingPrice;
  const shippingShare = shipping != null && currentPrice > 0 ? shipping / currentPrice : 0;
  factors.push({
    key: 'shipping',
    label: 'Delivery cost',
    weight: DEAL_QUALITY_WEIGHTS.shipping,
    score:
      shipping == null
        ? 70
        : shipping <= 0
          ? 100
          : clamp(100 - (shippingShare / SHIPPING_ZERO_SCORE_SHARE) * 100, 0, 100),
    detail:
      shipping == null
        ? 'The store does not publish a delivery cost for this item.'
        : shipping <= 0
          ? 'Free delivery.'
          : `${money(shipping)} delivery on top, making it ${money(currentPrice + shipping)} in total.`,
  });

  // ── 6. Availability ──────────────────────────────────────────────────────
  const availability: Availability = input.availability ?? 'UNKNOWN';
  factors.push({
    key: 'availability',
    label: 'Availability',
    weight: DEAL_QUALITY_WEIGHTS.availability,
    score: AVAILABILITY_SCORES[availability],
    detail:
      availability === 'IN_STOCK'
        ? 'In stock now.'
        : availability === 'LOW_STOCK'
          ? 'Only a few left in stock.'
          : availability === 'OUT_OF_STOCK'
            ? 'Out of stock, so the price cannot be acted on.'
            : availability === 'PREORDER'
              ? 'Available to pre-order only.'
              : availability === 'DISCONTINUED'
                ? 'Discontinued by the store.'
                : 'The store does not report stock for this item.',
  });

  const weighted = factors.reduce((sum, factor) => sum + factor.weight * factor.score, 0);
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const score = totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;

  // A rise only counts once it exceeds the noise floor.
  const roseSinceLastCheck =
    previousPrice != null &&
    currentPrice > previousPrice &&
    calculatePercentChange(previousPrice, currentPrice) >= PRICE_INCREASE_MIN_PERCENT;
  const label = labelFor(score, roseSinceLastCheck);

  if (availability === 'OUT_OF_STOCK') {
    warnings.push('Out of stock — the price shown cannot currently be acted on.');
  }

  return {
    score,
    label,
    headline: buildHeadline({
      label,
      currentPrice,
      lowest,
      average,
      previousPrice,
      hasHistory,
      money,
    }),
    factors,
    confidence: confidenceFor(sampleSize),
    claimedDiscountTrustworthy,
    warnings,
    disclaimer: DEAL_QUALITY_DISCLAIMER,
  };
}

function buildHeadline(args: {
  label: DealQualityLabel;
  currentPrice: number;
  lowest: number | null;
  average: number | null;
  previousPrice: number | null;
  hasHistory: boolean;
  money: (value: number) => string;
}): string {
  const { label, currentPrice, lowest, average, previousPrice, hasHistory, money } = args;

  if (label === 'PRICE_INCREASED' && previousPrice != null) {
    return `Price went up ${money(currentPrice - previousPrice)} since the last check.`;
  }
  if (!hasHistory) {
    return 'We have just started tracking this product, so there is no price history to judge it against yet.';
  }
  if (lowest != null && currentPrice <= lowest) {
    return 'This is the lowest price we have recorded for this product.';
  }
  if (average != null && currentPrice < average) {
    return `${money(average - currentPrice)} cheaper than its recorded average.`;
  }
  if (average != null && currentPrice > average) {
    return `${money(currentPrice - average)} more expensive than its recorded average.`;
  }
  return 'Currently priced in line with its recorded history.';
}

/**
 * Convenience helper for list rendering: the numbers a product card needs,
 * computed once alongside the score.
 */
export function summariseOffer(input: DealQualityInput): {
  discountPercent: number;
  effectivePrice: number;
  dealQuality: DealQuality;
} {
  const dealQuality = scoreDealQuality(input);
  return {
    discountPercent: calculateDiscountPercent(input.currentPrice, input.originalPrice),
    effectivePrice: roundTo(input.currentPrice + Math.max(0, input.shippingPrice ?? 0)),
    dealQuality,
  };
}
