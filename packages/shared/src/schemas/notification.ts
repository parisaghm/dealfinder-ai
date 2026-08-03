import { z } from 'zod';
import { idSchema, isoDateTimeSchema, moneySchema } from './common';

export const NOTIFICATION_TYPES = [
  'TARGET_REACHED',
  'PRICE_DROP',
  'BACK_IN_STOCK',
  'TEST',
] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
export const notificationStatusSchema = z.enum(NOTIFICATION_STATUSES);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

export const notificationSchema = z.object({
  id: idSchema,
  productId: idSchema.nullable(),
  productName: z.string().max(300).nullable(),
  type: notificationTypeSchema,
  message: z.string().max(1000),
  status: notificationStatusSchema,
  /**
   * The price that triggered the alert. Retained so the monitor can suppress a
   * repeat alert for an unchanged price without re-parsing `message`.
   */
  priceAtAlert: moneySchema.nullable(),
  sentAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type Notification = z.infer<typeof notificationSchema>;

/** `POST /api/alerts/test` — sends a sample alert to prove delivery works. */
export const testAlertRequestSchema = z.object({
  /** Uses this product when given, otherwise the first tracked product. */
  productId: idSchema.optional(),
});
export type TestAlertRequest = z.infer<typeof testAlertRequestSchema>;

export const testAlertResponseSchema = z.object({
  delivered: z.boolean(),
  /** Which Nodemailer transport handled it: stream, json or smtp. */
  transport: z.string(),
  recipient: z.string(),
  /** Where a dev-mode message landed, when applicable. */
  outputPath: z.string().nullable(),
  notification: notificationSchema,
});
export type TestAlertResponse = z.infer<typeof testAlertResponseSchema>;
