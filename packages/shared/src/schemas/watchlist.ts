import { z } from 'zod';
import { idSchema, isoDateTimeSchema, moneySchema } from './common';
import { productSummarySchema } from './product';

/**
 * Watchlist — tracked products and their target prices.
 */

export const ALERT_STATUSES = [
  /** Tracked, but the user set no target price. */
  'NO_TARGET',
  /** Target set, current price still above it. */
  'WAITING',
  /** Current price is at or below the target. */
  'TARGET_REACHED',
  /** Monitoring paused by the user. */
  'PAUSED',
] as const;
export const alertStatusSchema = z.enum(ALERT_STATUSES);
export type AlertStatus = z.infer<typeof alertStatusSchema>;

export const targetComparisonSchema = z.object({
  /** `currentPrice − targetPrice`; negative means the target was beaten. */
  difference: z.number(),
  percentAway: z.number(),
  reached: z.boolean(),
});
export type TargetComparison = z.infer<typeof targetComparisonSchema>;

export const watchlistItemSchema = z.object({
  id: idSchema,
  productId: idSchema,
  targetPrice: moneySchema.nullable(),
  alertsEnabled: z.boolean(),
  lastAlertedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  product: productSummarySchema,
  /** Null when no target price is set. */
  targetComparison: targetComparisonSchema.nullable(),
  alertStatus: alertStatusSchema,
  /** Change since the previous recorded price, for the trend indicator. */
  priceChangeSincePrevious: z.number().nullable(),
});
export type WatchlistItem = z.infer<typeof watchlistItemSchema>;

export const watchlistResponseSchema = z.object({
  items: z.array(watchlistItemSchema),
  total: z.number().int().nonnegative(),
});
export type WatchlistResponse = z.infer<typeof watchlistResponseSchema>;

export const createWatchlistItemSchema = z.object({
  productId: idSchema,
  /** Omit or null to track without a target. Must be above zero when set. */
  targetPrice: moneySchema.positive().max(10_000_000).nullable().optional(),
  alertsEnabled: z.boolean().default(true),
});
export type CreateWatchlistItemInput = z.infer<typeof createWatchlistItemSchema>;

/**
 * PATCH accepts either field on its own — editing a target must not require
 * re-sending the alert toggle — but rejects an entirely empty body, which is
 * almost always a client bug rather than an intentional no-op.
 */
export const updateWatchlistItemSchema = z
  .object({
    targetPrice: moneySchema.positive().max(10_000_000).nullable().optional(),
    alertsEnabled: z.boolean().optional(),
  })
  .refine(
    (value) => value.targetPrice !== undefined || value.alertsEnabled !== undefined,
    'Provide at least one of targetPrice or alertsEnabled.',
  );
export type UpdateWatchlistItemInput = z.infer<typeof updateWatchlistItemSchema>;
