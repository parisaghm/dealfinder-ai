import { z } from 'zod';
import { isoDateTimeSchema, moneySchema } from './common';

/** A single recorded observation of a product's price. */
export const pricePointSchema = z.object({
  price: moneySchema,
  recordedAt: isoDateTimeSchema,
});
export type PricePoint = z.infer<typeof pricePointSchema>;

/**
 * Aggregates over a product's recorded history.
 *
 * Every field is nullable because a product observed exactly once has no
 * meaningful average, and a brand-new product has no history at all. Callers
 * must handle "we don't know yet" rather than being handed a misleading 0.
 */
export const priceStatisticsSchema = z.object({
  lowest: moneySchema.nullable(),
  highest: moneySchema.nullable(),
  average: moneySchema.nullable(),
  /** Most recent recorded price. */
  latestPrice: moneySchema.nullable(),
  /** The recording before `latestPrice`, used to detect a rise since last check. */
  previousPrice: moneySchema.nullable(),
  /** Number of recorded observations backing these figures. */
  sampleSize: z.number().int().nonnegative(),
  firstRecordedAt: isoDateTimeSchema.nullable(),
  lastRecordedAt: isoDateTimeSchema.nullable(),
});
export type PriceStatistics = z.infer<typeof priceStatisticsSchema>;

export const PRICE_TREND_DIRECTIONS = ['FALLING', 'RISING', 'STABLE', 'UNKNOWN'] as const;
export const priceTrendDirectionSchema = z.enum(PRICE_TREND_DIRECTIONS);
export type PriceTrendDirection = z.infer<typeof priceTrendDirectionSchema>;

export const priceTrendSchema = z.object({
  direction: priceTrendDirectionSchema,
  /** Signed percentage change across the compared window. */
  changePercent: z.number().finite(),
  /** How many observations the comparison used. */
  sampleSize: z.number().int().nonnegative(),
});
export type PriceTrend = z.infer<typeof priceTrendSchema>;
