import { decimalToNumber, type PrismaClient } from '@deal-finder/db';
import {
  CHECK_FREQUENCY_HOURS,
  calculateDiscountPercent,
  type Currency,
} from '@deal-finder/shared';
import { renderPriceAlertEmail } from '../email/templates/price-alert';
import { sendMail, type SendMailResult } from '../email/transport';
import { env } from '../env';
import { logger } from '../logger';

/**
 * Scheduled price monitoring.
 *
 * Runs on a cron schedule and, for each active watchlist item:
 *   1. asks the provider for the latest price,
 *   2. records a `PriceHistory` row **only when the price actually changed**,
 *   3. compares against the user's target,
 *   4. emails an alert when the target is met,
 *   5. suppresses a repeat alert for the same unchanged price,
 *   6. isolates every failure so one broken store cannot stop the run.
 *
 * Written as a plain function over injected dependencies (`fetchPrice`, `now`,
 * `send`) rather than reaching for the provider registry and the clock itself.
 * That is what makes the six behaviours above testable without a network, a
 * mail server or waiting for real time to pass.
 */

export interface PriceObservation {
  currentPrice: number;
  originalPrice?: number | null;
  shippingPrice?: number | null;
  availability?:
    | 'IN_STOCK'
    | 'LOW_STOCK'
    | 'OUT_OF_STOCK'
    | 'PREORDER'
    | 'DISCONTINUED'
    | 'UNKNOWN';
}

/** Looks up the current price for a product. Throwing is expected and handled. */
export type PriceFetcher = (product: {
  id: string;
  externalId: string;
  productUrl: string;
  storeSlug: string;
}) => Promise<PriceObservation | null>;

export interface MonitoringDependencies {
  prisma: PrismaClient;
  fetchPrice: PriceFetcher;
  now?: () => Date;
  send?: (input: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }) => Promise<SendMailResult>;
  /** Overrides `MONITOR_BATCH_SIZE`. */
  batchSize?: number;
  /** Overrides `ALERT_COOLDOWN_HOURS`. */
  alertCooldownHours?: number;
}

export interface MonitoringRunSummary {
  checked: number;
  priceChanges: number;
  alertsSent: number;
  alertsSuppressed: number;
  skipped: number;
  failures: Array<{ productId: string; store: string; message: string }>;
  durationMs: number;
}

export async function runPriceCheck(
  dependencies: MonitoringDependencies,
): Promise<MonitoringRunSummary> {
  const { prisma, fetchPrice } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const send = dependencies.send ?? sendMail;
  const batchSize = dependencies.batchSize ?? env.MONITOR_BATCH_SIZE;
  const cooldownHours = dependencies.alertCooldownHours ?? env.ALERT_COOLDOWN_HOURS;

  const startedAt = Date.now();
  const summary: MonitoringRunSummary = {
    checked: 0,
    priceChanges: 0,
    alertsSent: 0,
    alertsSuppressed: 0,
    skipped: 0,
    failures: [],
    durationMs: 0,
  };

  const items = await prisma.watchlistItem.findMany({
    where: { alertsEnabled: true },
    // Least-recently-checked products first, so a large watchlist is covered
    // evenly across runs instead of always re-checking the same head.
    orderBy: { product: { lastCheckedAt: 'asc' } },
    take: batchSize,
    include: {
      user: { select: { id: true, email: true, name: true, settings: true } },
      product: {
        select: {
          id: true,
          externalId: true,
          name: true,
          productUrl: true,
          currentPrice: true,
          originalPrice: true,
          shippingPrice: true,
          currency: true,
          lastCheckedAt: true,
          store: { select: { slug: true, name: true, isActive: true } },
        },
      },
    },
  });

  const currentTime = now();

  for (const item of items) {
    const { product, user } = item;

    try {
      // Respect the user's chosen cadence. The cron fires globally; this is
      // what makes a per-user "check frequency" setting mean something.
      const frequency = user.settings?.checkFrequency ?? 'EVERY_6_HOURS';
      const minimumGapMs = CHECK_FREQUENCY_HOURS[frequency] * 3_600_000;
      const elapsedMs = currentTime.getTime() - product.lastCheckedAt.getTime();
      if (elapsedMs < minimumGapMs) {
        summary.skipped += 1;
        continue;
      }

      if (!product.store.isActive) {
        summary.skipped += 1;
        continue;
      }

      const observation = await fetchPrice({
        id: product.id,
        externalId: product.externalId,
        productUrl: product.productUrl,
        storeSlug: product.store.slug,
      });

      summary.checked += 1;

      if (!observation) {
        summary.failures.push({
          productId: product.id,
          store: product.store.slug,
          message: 'Provider returned no price for this product.',
        });
        continue;
      }

      const previousPrice = decimalToNumber(product.currentPrice) ?? 0;
      const newPrice = observation.currentPrice;
      const priceChanged = newPrice !== previousPrice;

      const originalPrice =
        observation.originalPrice !== undefined
          ? observation.originalPrice
          : decimalToNumber(product.originalPrice);

      // Always advance lastCheckedAt — that is what "we looked" means, and it
      // drives both the ordering above and the "last checked" label in the UI.
      await prisma.product.update({
        where: { id: product.id },
        data: {
          currentPrice: newPrice,
          originalPrice: originalPrice ?? null,
          ...(observation.shippingPrice !== undefined
            ? { shippingPrice: observation.shippingPrice }
            : {}),
          ...(observation.availability ? { availability: observation.availability } : {}),
          discountPercent: calculateDiscountPercent(newPrice, originalPrice),
          lastCheckedAt: currentTime,
        },
      });

      // History records changes, not polls.
      if (priceChanged) {
        summary.priceChanges += 1;
        await prisma.priceHistory.create({
          data: {
            productId: product.id,
            price: newPrice,
            currency: product.currency,
            recordedAt: currentTime,
          },
        });
      }

      const targetPrice = decimalToNumber(item.targetPrice);
      if (targetPrice == null || newPrice > targetPrice) continue;

      // ── The target is met. Should we actually alert? ──────────────────────
      const decision = await shouldAlert(prisma, {
        watchlistItemId: item.id,
        productId: product.id,
        userId: user.id,
        price: newPrice,
        lastAlertedAt: item.lastAlertedAt,
        cooldownHours,
        notifyByEmail: user.settings?.notifyByEmail ?? true,
        notifyOnTargetReached: user.settings?.notifyOnTargetReached ?? true,
        now: currentTime,
      });

      if (!decision.send) {
        summary.alertsSuppressed += 1;
        logger.debug(
          { productId: product.id, reason: decision.reason },
          'Suppressed duplicate price alert',
        );
        continue;
      }

      const discountPercent = calculateDiscountPercent(newPrice, originalPrice);
      const email = renderPriceAlertEmail({
        productName: product.name,
        storeName: product.store.name,
        productUrl: product.productUrl,
        currency: product.currency as Currency,
        currentPrice: newPrice,
        previousPrice: priceChanged ? previousPrice : null,
        targetPrice,
        originalPrice: originalPrice ?? null,
        discountPercent,
        watchlistItemId: item.id,
        recipientName: user.name,
      });

      const result = await send({
        to: user.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });

      await prisma.$transaction([
        prisma.notification.create({
          data: {
            userId: user.id,
            productId: product.id,
            type: 'TARGET_REACHED',
            status: result.delivered ? 'SENT' : 'FAILED',
            message: `${product.name} reached ${newPrice} ${product.currency}, at or below the target of ${targetPrice}.`,
            priceAtAlert: newPrice,
            sentAt: result.delivered ? currentTime : null,
            error: result.error ?? null,
          },
        }),
        // Record the attempt either way: without this a permanently failing
        // mail server would retry the same alert every single run.
        prisma.watchlistItem.update({
          where: { id: item.id },
          data: { lastAlertedAt: currentTime },
        }),
      ]);

      if (result.delivered) summary.alertsSent += 1;
      else
        summary.failures.push({
          productId: product.id,
          store: product.store.slug,
          message: `Alert email failed: ${result.error ?? 'unknown error'}`,
        });
    } catch (error) {
      // One product's failure must never abort the run.
      const message = error instanceof Error ? error.message : String(error);
      summary.failures.push({
        productId: product.id,
        store: product.store.slug,
        message,
      });
      logger.warn(
        { productId: product.id, store: product.store.slug, err: error },
        'Price check failed for one product; continuing',
      );
    }
  }

  summary.durationMs = Date.now() - startedAt;
  return summary;
}

interface AlertDecisionInput {
  watchlistItemId: string;
  productId: string;
  userId: string;
  price: number;
  lastAlertedAt: Date | null;
  cooldownHours: number;
  notifyByEmail: boolean;
  notifyOnTargetReached: boolean;
  now: Date;
}

/**
 * Whether to send an alert for a met target.
 *
 * The requirement is "prevent duplicate alerts for the same unchanged price",
 * which is subtler than a time-based cooldown alone: if the price drops
 * *further*, that is genuinely new information and worth another email even
 * inside the cooldown window. So the last alerted price is compared explicitly
 * — which is what `Notification.priceAtAlert` exists for.
 */
export async function shouldAlert(
  prisma: PrismaClient,
  input: AlertDecisionInput,
): Promise<{ send: boolean; reason: string }> {
  if (!input.notifyByEmail) return { send: false, reason: 'user disabled email notifications' };
  if (!input.notifyOnTargetReached) {
    return { send: false, reason: 'user disabled target-reached notifications' };
  }

  const lastAlert = await prisma.notification.findFirst({
    where: {
      userId: input.userId,
      productId: input.productId,
      type: 'TARGET_REACHED',
      status: 'SENT',
    },
    orderBy: { createdAt: 'desc' },
    select: { priceAtAlert: true, createdAt: true },
  });

  if (!lastAlert) return { send: true, reason: 'no previous alert' };

  const lastPrice = decimalToNumber(lastAlert.priceAtAlert);

  // A further drop is new information, regardless of the cooldown.
  if (lastPrice != null && input.price < lastPrice) {
    return { send: true, reason: 'price dropped further than the last alert' };
  }

  if (lastPrice != null && input.price >= lastPrice) {
    const cooldownMs = input.cooldownHours * 3_600_000;
    const elapsed = input.now.getTime() - lastAlert.createdAt.getTime();
    if (elapsed < cooldownMs) {
      return { send: false, reason: 'already alerted at this price within the cooldown window' };
    }
    // Past the cooldown and still at or above the previously alerted price:
    // nothing new to say.
    return { send: false, reason: 'price has not improved since the last alert' };
  }

  const cooldownMs = input.cooldownHours * 3_600_000;
  const elapsed = input.now.getTime() - lastAlert.createdAt.getTime();
  return elapsed >= cooldownMs
    ? { send: true, reason: 'cooldown elapsed' }
    : { send: false, reason: 'within cooldown window' };
}
