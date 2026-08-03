import { z } from 'zod';
import { currencySchema, isoDateTimeSchema, moneySchema } from './common';
import { notificationSchema } from './notification';
import { productSummarySchema } from './product';
import { savedSearchSchema } from './saved-search';

/** `GET /api/dashboard` — everything the dashboard renders, in one round trip. */

export const dashboardSummarySchema = z.object({
  trackedProducts: z.number().int().nonnegative(),
  /** Watchlist items with alerts enabled and a target price set. */
  activeAlerts: z.number().int().nonnegative(),
  /** Products whose price was first seen or reduced in the last 7 days. */
  dealsFoundThisWeek: z.number().int().nonnegative(),
  /**
   * Sum, across tracked products, of how far each sits below its recorded
   * average. An estimate of what tracking has been worth — not a promise, and
   * labelled as such in the UI.
   */
  estimatedSavings: moneySchema,
  currency: currencySchema,
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const priceChangeEntrySchema = z.object({
  product: productSummarySchema,
  previousPrice: moneySchema,
  currentPrice: moneySchema,
  /** Signed: negative is a drop. */
  changePercent: z.number(),
  changedAt: isoDateTimeSchema,
});
export type PriceChangeEntry = z.infer<typeof priceChangeEntrySchema>;

export const dashboardResponseSchema = z.object({
  summary: dashboardSummarySchema,
  recentPriceChanges: z.array(priceChangeEntrySchema),
  bestDeals: z.array(productSummarySchema),
  alertActivity: z.array(notificationSchema),
  savedSearches: z.array(savedSearchSchema),
});
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
