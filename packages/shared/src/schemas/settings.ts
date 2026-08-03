import { z } from 'zod';
import { currencySchema, emailSchema, isoDateTimeSchema } from './common';

/**
 * User settings.
 *
 * Backed by a `UserSettings` row (1:1 with `User`) rather than by loose JSON,
 * so the monitoring job can query on `checkFrequency` and `notifyByEmail`
 * instead of loading and parsing every user's blob.
 */

export const CHECK_FREQUENCIES = ['HOURLY', 'EVERY_6_HOURS', 'DAILY', 'WEEKLY'] as const;
export const checkFrequencySchema = z.enum(CHECK_FREQUENCIES);
export type CheckFrequency = z.infer<typeof checkFrequencySchema>;

/**
 * Minimum hours between checks for each frequency. The scheduler runs on a
 * single global cron; this is what makes a *per-user* preference meaningful —
 * an item is skipped when its user's interval has not yet elapsed.
 */
export const CHECK_FREQUENCY_HOURS: Record<CheckFrequency, number> = {
  HOURLY: 1,
  EVERY_6_HOURS: 6,
  DAILY: 24,
  WEEKLY: 168,
};

export const userSettingsSchema = z.object({
  email: z.string().max(254),
  name: z.string().max(120).nullable(),
  notifyByEmail: z.boolean(),
  notifyOnTargetReached: z.boolean(),
  /** Alert on any drop, not just when the target is met. */
  notifyOnPriceDrop: z.boolean(),
  checkFrequency: checkFrequencySchema,
  /** Store slugs pre-selected in the search filters. */
  preferredStores: z.array(z.string().max(64)),
  preferredCategories: z.array(z.string().max(64)),
  currency: currencySchema,
  updatedAt: isoDateTimeSchema,
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

export const updateUserSettingsSchema = z
  .object({
    email: emailSchema.optional(),
    name: z.string().trim().max(120).nullable().optional(),
    notifyByEmail: z.boolean().optional(),
    notifyOnTargetReached: z.boolean().optional(),
    notifyOnPriceDrop: z.boolean().optional(),
    checkFrequency: checkFrequencySchema.optional(),
    preferredStores: z.array(z.string().trim().max(64)).max(50).optional(),
    preferredCategories: z.array(z.string().trim().max(64)).max(50).optional(),
    currency: currencySchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');
export type UpdateUserSettingsInput = z.infer<typeof updateUserSettingsSchema>;

/**
 * Destructive account actions from the settings page. The literal confirmation
 * string is required so a stray request can never wipe someone's data.
 */
export const CLEAR_DATA_SCOPES = ['watchlist', 'saved-searches', 'notifications', 'all'] as const;
export const clearDataSchema = z.object({
  scope: z.enum(CLEAR_DATA_SCOPES),
  confirm: z.literal('DELETE'),
});
export type ClearDataInput = z.infer<typeof clearDataSchema>;

export const clearDataResponseSchema = z.object({
  scope: z.enum(CLEAR_DATA_SCOPES),
  deleted: z.object({
    watchlistItems: z.number().int().nonnegative(),
    savedSearches: z.number().int().nonnegative(),
    notifications: z.number().int().nonnegative(),
  }),
});
export type ClearDataResponse = z.infer<typeof clearDataResponseSchema>;
