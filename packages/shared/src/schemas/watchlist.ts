import { z } from 'zod';
import { countryCodeSchema } from '../countries';
import { currencySchema, idSchema, isoDateTimeSchema, moneySchema } from './common';
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

  /**
   * Where the user wants it delivered, and the currency their target is in.
   *
   * Part of the item's identity: the same product tracked for Finland and for
   * Germany is two independent targets, and the UI names both on every row so two
   * rows for one product read as intentional rather than as a duplicate bug.
   */
  destinationCountry: countryCodeSchema,
  destinationCountryName: z.string().min(1),
  preferredCurrency: currencySchema,

  /**
   * Target on the delivered total rather than the list price.
   *
   * Separate from `targetPrice` because they are different questions: "notify me
   * when it costs €300 to my door" versus "when the sticker says €300". A row can
   * carry either or both.
   */
  targetDeliveredPrice: moneySchema.nullable(),
  /** Null when no delivered target is set, or when no delivered total is known. */
  deliveredComparison: targetComparisonSchema.nullable(),
  /**
   * The current delivered total for this destination, when one can be computed.
   * Null means unknown — most often unpublished shipping — and must never be
   * rendered as though the product simply costs its list price.
   */
  currentDeliveredPrice: moneySchema.nullable(),
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

  /**
   * Destination and currency default to Finland and EUR.
   *
   * Defaulted rather than required so an existing client that knows nothing about
   * destinations keeps working and keeps meaning what it always meant — which is
   * also why the two database columns carry the same defaults.
   */
  destinationCountry: countryCodeSchema.default('FI'),
  preferredCurrency: currencySchema.default('EUR'),
  targetDeliveredPrice: moneySchema.positive().max(10_000_000).nullable().optional(),

  /**
   * Confirms the user really wants a *second* currency target for a destination
   * they already track.
   *
   * Without it, a request that collides only on currency is rejected with the
   * existing item's id so the client can offer "update the existing target"
   * instead. Opt-in rather than opt-out because the accidental case — someone
   * changed a currency dropdown — is far commoner than the deliberate one, and
   * its cost is duplicate alert emails.
   */
  allowAdditionalCurrency: z.boolean().default(false),
});

/**
 * The parsed form, with defaults applied. What the service receives.
 */
export type CreateWatchlistItemInput = z.infer<typeof createWatchlistItemSchema>;

/**
 * The form a *caller* sends, where defaulted fields may be omitted.
 *
 * Distinct from `CreateWatchlistItemInput` because `z.infer` reports the output
 * type, in which every defaulted field is required. A client that does not care
 * about destinations should be able to post `{ productId }` and get Finland/EUR —
 * which is the whole point of the defaults, and would be defeated by making it
 * spell them out.
 */
export type CreateWatchlistItemPayload = z.input<typeof createWatchlistItemSchema>;

/**
 * PATCH accepts any field on its own — editing a target must not require
 * re-sending the alert toggle — but rejects an entirely empty body, which is
 * almost always a client bug rather than an intentional no-op.
 *
 * `preferredCurrency` is editable here on purpose. Changing the currency on an
 * existing target updates that target in place; it does not silently mint a
 * second one. Creating a genuinely separate currency target for the same
 * destination is a distinct, explicitly-labelled action in the UI, because a
 * changed dropdown should never be the reason a user starts getting two emails.
 */
export const updateWatchlistItemSchema = z
  .object({
    targetPrice: moneySchema.positive().max(10_000_000).nullable().optional(),
    alertsEnabled: z.boolean().optional(),
    targetDeliveredPrice: moneySchema.positive().max(10_000_000).nullable().optional(),
    destinationCountry: countryCodeSchema.optional(),
    preferredCurrency: currencySchema.optional(),
  })
  .refine(
    (value) =>
      value.targetPrice !== undefined ||
      value.alertsEnabled !== undefined ||
      value.targetDeliveredPrice !== undefined ||
      value.destinationCountry !== undefined ||
      value.preferredCurrency !== undefined,
    'Provide at least one field to update.',
  );
export type UpdateWatchlistItemInput = z.infer<typeof updateWatchlistItemSchema>;
