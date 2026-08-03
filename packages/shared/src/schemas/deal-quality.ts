import { z } from 'zod';

/**
 * The vocabulary of the deal-quality assessment.
 *
 * Deliberately explainable: a score alone is not useful (and not honest), so
 * every assessment carries the individual factors that produced it, a plain
 * headline, an explicit confidence level derived from how much history we
 * actually have, and any warnings about the store's *claimed* discount.
 */

export const DEAL_QUALITY_LABELS = ['EXCELLENT', 'GOOD', 'AVERAGE', 'PRICE_INCREASED'] as const;
export const dealQualityLabelSchema = z.enum(DEAL_QUALITY_LABELS);
export type DealQualityLabel = z.infer<typeof dealQualityLabelSchema>;

export const DEAL_QUALITY_FACTOR_KEYS = [
  'discount',
  'vs-average',
  'vs-lowest',
  'trend',
  'shipping',
  'availability',
] as const;
export const dealQualityFactorKeySchema = z.enum(DEAL_QUALITY_FACTOR_KEYS);
export type DealQualityFactorKey = z.infer<typeof dealQualityFactorKeySchema>;

export const dealQualityFactorSchema = z.object({
  key: dealQualityFactorKeySchema,
  /** Short human label, e.g. "Compared to recorded average". */
  label: z.string(),
  /** This factor's contribution to the total, 0–100. */
  weight: z.number().min(0).max(100),
  /** How well the product scores on this factor alone, 0–100. */
  score: z.number().min(0).max(100),
  /** One sentence explaining the score in concrete terms. */
  detail: z.string(),
});
export type DealQualityFactor = z.infer<typeof dealQualityFactorSchema>;

/**
 * How much to trust the assessment, based purely on how many price
 * observations back it. A single observation cannot tell you whether €199 is
 * a bargain, and the UI says so rather than implying certainty.
 */
export const DEAL_QUALITY_CONFIDENCE = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const dealQualityConfidenceSchema = z.enum(DEAL_QUALITY_CONFIDENCE);
export type DealQualityConfidence = z.infer<typeof dealQualityConfidenceSchema>;

export const dealQualitySchema = z.object({
  score: z.number().min(0).max(100),
  label: dealQualityLabelSchema,
  /** One-line summary shown next to the badge. */
  headline: z.string(),
  factors: z.array(dealQualityFactorSchema),
  confidence: dealQualityConfidenceSchema,
  /**
   * False when the recorded history contradicts the store's crossed-out
   * price — the core promise of the product. See `warnings` for the reason.
   */
  claimedDiscountTrustworthy: z.boolean(),
  warnings: z.array(z.string()),
  disclaimer: z.string(),
});
export type DealQuality = z.infer<typeof dealQualitySchema>;
