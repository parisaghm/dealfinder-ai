import { decimalToNumber, type PrismaClient } from '@deal-finder/db';
import {
  testAlertRequestSchema,
  type Currency,
  type TestAlertRequest,
  type TestAlertResponse,
} from '@deal-finder/shared';
import { Router } from 'express';
import { renderPriceAlertEmail } from '../email/templates/price-alert';
import { emailOutputDirectory, sendMail } from '../email/transport';
import { env } from '../env';
import { ApiError } from '../errors';
import { currentUser, requireUser } from '../middleware/auth';
import { validate, validated } from '../middleware/validate';

/**
 * `POST /api/alerts/test`
 *
 * Sends a real alert email through the configured transport so a user can
 * verify delivery works end to end before relying on it. Uses a product the
 * user tracks (or an explicitly named one) so the message contains genuine
 * prices rather than placeholders.
 */
export function createAlertsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.post('/test', requireUser, validate(testAlertRequestSchema), async (req, res, next) => {
    try {
      const user = currentUser(req);
      const { productId } = validated<TestAlertRequest>(req);

      const watchlistItem = await prisma.watchlistItem.findFirst({
        where: { userId: user.id, ...(productId ? { productId } : {}) },
        orderBy: { createdAt: 'desc' },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              productUrl: true,
              currentPrice: true,
              originalPrice: true,
              currency: true,
              discountPercent: true,
              store: { select: { name: true } },
            },
          },
        },
      });

      // Fall back to any product when nothing is tracked yet, so the feature is
      // usable on a fresh install.
      const product =
        watchlistItem?.product ??
        (await prisma.product.findFirst({
          where: productId ? { id: productId } : {},
          orderBy: { discountPercent: 'desc' },
          select: {
            id: true,
            name: true,
            productUrl: true,
            currentPrice: true,
            originalPrice: true,
            currency: true,
            discountPercent: true,
            store: { select: { name: true } },
          },
        }));

      if (!product) {
        throw ApiError.notFound(
          'No product available to build a test alert from. Run `npm run db:seed` first, or add a product to your watchlist',
        );
      }

      const currentPrice = decimalToNumber(product.currentPrice) ?? 0;
      const targetPrice = decimalToNumber(watchlistItem?.targetPrice ?? null);

      const email = renderPriceAlertEmail({
        productName: product.name,
        storeName: product.store.name,
        productUrl: product.productUrl,
        currency: product.currency as Currency,
        currentPrice,
        previousPrice: null,
        // Show a plausible target when the item has none, so the test message
        // exercises the same layout a real alert uses.
        targetPrice: targetPrice ?? Math.round(currentPrice * 1.05 * 100) / 100,
        originalPrice: decimalToNumber(product.originalPrice),
        discountPercent: product.discountPercent,
        watchlistItemId: watchlistItem?.id ?? null,
        recipientName: user.name,
        isTest: true,
      });

      const result = await sendMail({
        to: user.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });

      const notification = await prisma.notification.create({
        data: {
          userId: user.id,
          productId: product.id,
          type: 'TEST',
          status: result.delivered ? 'SENT' : 'FAILED',
          message: `Test alert for ${product.name}.`,
          priceAtAlert: currentPrice,
          sentAt: result.delivered ? new Date() : null,
          error: result.error ?? null,
        },
        select: {
          id: true,
          productId: true,
          type: true,
          message: true,
          status: true,
          priceAtAlert: true,
          sentAt: true,
          createdAt: true,
        },
      });

      const response: TestAlertResponse = {
        delivered: result.delivered,
        transport: result.transport,
        recipient: user.email,
        outputPath:
          result.outputPath ??
          (env.EMAIL_TRANSPORT === 'stream' ? emailOutputDirectory() : null),
        notification: {
          id: notification.id,
          productId: notification.productId,
          productName: product.name,
          type: notification.type,
          message: notification.message,
          status: notification.status,
          priceAtAlert: decimalToNumber(notification.priceAtAlert),
          sentAt: notification.sentAt ? notification.sentAt.toISOString() : null,
          createdAt: notification.createdAt.toISOString(),
        },
      };

      // 502 when the transport rejected it: the request was fine, delivery was not.
      res.status(result.delivered ? 200 : 502).json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
