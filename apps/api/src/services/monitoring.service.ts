import { decimalToNumber, type Prisma, type PrismaClient } from '@deal-finder/db';
import {
  CHECK_FREQUENCY_HOURS,
  calculateDiscountPercent,
  convertWithProvenance,
  countryName,
  toMajor,
  type Currency,
} from '@deal-finder/shared';
import { renderPriceAlertEmail } from '../email/templates/price-alert';
import { sendMail, type SendMailResult } from '../email/transport';
import { env } from '../env';
import { logger } from '../logger';
import { moneyFromDecimal } from '../mappers/offer.mapper';
import { loadRateContext, type RateContext } from './exchange-rate.service';

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
  /**
   * Overrides the exchange-rate table.
   *
   * Injected by tests that need to prove a stale or missing rate suppresses a
   * delivered-price alert, which is otherwise untestable without waiting days.
   */
  rates?: RateContext;
  /**
   * Limit the run to these users. Omitted, every user is checked.
   *
   * The scheduled job passes nothing, which is the whole point of it. This exists
   * because a *test* must not: the query below is global by design, so a suite
   * that called `runPriceCheck` with its own fixtures also picked up the seeded
   * demo user's watchlist, rewrote those products' prices to whatever the test
   * had stubbed, and left real alert notifications behind. That corrupted the
   * shared seeded data every run — including the Sony listing whose exact price
   * the end-to-end suite asserts.
   *
   * It is also a genuine capability rather than a test hook wearing a disguise:
   * re-checking one user on demand is a thing an operator wants.
   */
  userIds?: readonly string[];
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
    where: {
      alertsEnabled: true,
      ...(dependencies.userIds ? { userId: { in: [...dependencies.userIds] } } : {}),
    },
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
          store: { select: { slug: true, name: true, isActive: true, countryCode: true } },
          /**
           * The destination offers for this listing.
           *
           * Selected with the batch rather than looked up per item: one query per
           * watchlist row is the N+1 this whole include exists to avoid, and a
           * product has at most a handful of offers. Which one applies is decided
           * per item, from the destination and currency that item tracks.
           */
          storeOffers: {
            select: {
              countryCode: true,
              currency: true,
              shippingPrice: true,
              totalDeliveredPrice: true,
            },
          },
        },
      },
    },
  });

  const currentTime = now();

  /**
   * One rate table for the whole run, loaded at most once and only if needed.
   *
   * Not per item, and certainly not per offer. Lazy because a run containing no
   * delivered-price targets must issue exactly the queries it always did.
   * `fresh: true` because the monitor runs every half hour and should read what is
   * recorded now, not a table cached by a web request minutes ago.
   */
  let rates: RateContext | null = dependencies.rates ?? null;
  const resolveRates = async (): Promise<RateContext> => {
    rates ??= await loadRateContext(prisma, { fresh: true, now: currentTime.getTime() });
    return rates;
  };

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
      const targetDeliveredPrice = decimalToNumber(item.targetDeliveredPrice);

      /**
       * A delivered-price target takes precedence, with no fallback.
       *
       * When the user asked to be told about the delivered total, the list price
       * is not an approximation of it — it is a different number that omits
       * exactly the cost the user cared about. So if the delivered total cannot be
       * established, this item simply waits: no email, and specifically no email
       * derived from `targetPrice` instead.
       */
      const trackingDelivered = targetDeliveredPrice != null;

      const delivered = trackingDelivered
        ? evaluateDeliveredTarget({
            offers: product.storeOffers,
            destinationCountry: item.destinationCountry,
            preferredCurrency: item.preferredCurrency as Currency,
            targetDeliveredPrice,
            rates: await resolveRates(),
            now: currentTime,
          })
        : null;

      if (trackingDelivered && (delivered == null || !delivered.reached)) {
        logger.debug(
          {
            productId: product.id,
            destinationCountry: item.destinationCountry,
            reason: delivered?.reason,
          },
          'Delivered-price target not established as met; waiting',
        );
        continue;
      }

      if (!trackingDelivered && (targetPrice == null || newPrice > targetPrice)) continue;

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
        // Scopes the duplicate check. A delivered-price target for Finland is
        // evaluated against its own alert history, so it is neither muted by a
        // German one nor by a list-price alert that happened to fire earlier.
        destinationCountry: trackingDelivered ? item.destinationCountry : null,
        deliveredPrice: delivered?.deliveredPrice ?? null,
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
        currency: trackingDelivered ? (item.preferredCurrency as Currency) : (product.currency as Currency),
        currentPrice: newPrice,
        previousPrice: priceChanged ? previousPrice : null,
        targetPrice,
        originalPrice: originalPrice ?? null,
        discountPercent,
        watchlistItemId: item.id,
        recipientName: user.name,
        destination:
          delivered == null
            ? null
            : {
                countryName: countryName(item.destinationCountry),
                deliveredPrice: delivered.deliveredPrice,
                targetDeliveredPrice: delivered.target,
                shippingPrice: delivered.shippingPrice,
                isConverted: delivered.isConverted,
              },
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
            message:
              delivered == null
                ? `${product.name} reached ${newPrice} ${product.currency}, at or below the target of ${targetPrice}.`
                : `${product.name} costs ${delivered.deliveredPrice} ${item.preferredCurrency} delivered to ${countryName(item.destinationCountry)}, at or below the target of ${delivered.target}.`,
            priceAtAlert: newPrice,
            // Both recorded for a delivered alert: the destination is what makes
            // the row identifiable as one, and the delivered figure is what the
            // next run compares against.
            deliveredPriceAtAlert: delivered?.deliveredPrice ?? null,
            destinationCountry: delivered == null ? null : item.destinationCountry,
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

/** The offer columns a delivered-price evaluation needs. */
interface DeliveredOfferRow {
  countryCode: string;
  currency: string;
  shippingPrice: Prisma.Decimal | null;
  totalDeliveredPrice: Prisma.Decimal | null;
}

export interface DeliveredEvaluation {
  /** True only when the delivered total is known, trustworthy and at or below target. */
  reached: boolean;
  /** Why, in words, for the debug log. */
  reason: string;
  /** The delivered total in the tracked currency. Meaningless unless `reached`. */
  deliveredPrice: number;
  target: number;
  /** Null when the store publishes no delivery cost. */
  shippingPrice: number | null;
  isConverted: boolean;
}

/**
 * Whether a delivered-price target has actually been met.
 *
 * Five distinct ways this returns "no", and each one exists because saying "yes"
 * would send an email asserting something we cannot support:
 *
 *  1. **No offer for the destination.** Nothing proves the product can be
 *     delivered there at all, so there is no delivered total to compare.
 *  2. **Shipping unpublished.** An unknown delivery cost means an unknown total.
 *     Treating it as zero would fire an alert for a price nobody can pay.
 *  3. **No exchange rate.** A total in kronor cannot be compared to a target in
 *     euros without one, and guessing is worse than waiting.
 *  4. **A stale exchange rate.** Fresh enough to *show*, labelled with its age;
 *     not fresh enough to send an email claiming a threshold was crossed.
 *  5. **Above the target.** The ordinary case.
 *
 * In none of them does it fall back to the list price.
 */
export function evaluateDeliveredTarget(input: {
  offers: readonly DeliveredOfferRow[];
  destinationCountry: string;
  preferredCurrency: Currency;
  targetDeliveredPrice: number;
  rates: RateContext;
  now: Date;
}): DeliveredEvaluation {
  const base = {
    reached: false,
    deliveredPrice: 0,
    target: input.targetDeliveredPrice,
    shippingPrice: null,
    isConverted: false,
  };

  const forDestination = input.offers.filter(
    (offer) => offer.countryCode === input.destinationCountry,
  );
  // Prefer the offer already quoted in the tracked currency: it needs no rate and
  // so cannot be blocked by the state of the FX table.
  const offer =
    forDestination.find((candidate) => candidate.currency === input.preferredCurrency) ??
    forDestination[0];

  if (offer == null) {
    return { ...base, reason: `no offer proves delivery to ${input.destinationCountry}` };
  }

  const offerCurrency = offer.currency as Currency;
  const shipping = moneyFromDecimal(offer.shippingPrice, offerCurrency);

  if (offer.shippingPrice == null || offer.totalDeliveredPrice == null) {
    return { ...base, reason: 'the store publishes no delivery cost to this destination' };
  }

  const total = moneyFromDecimal(offer.totalDeliveredPrice, offerCurrency);
  if (total == null) {
    return { ...base, reason: 'the recorded delivered total could not be read' };
  }

  const outcome = convertWithProvenance(total, input.preferredCurrency, input.rates.table, {
    maxAgeHours: input.rates.maxAgeHours,
    now: input.now.getTime(),
  });

  if (outcome.converted == null) {
    return {
      ...base,
      reason: `no exchange rate for ${offerCurrency} to ${input.preferredCurrency}`,
    };
  }
  if (outcome.blocksCheapestClaim) {
    return {
      ...base,
      reason: `the ${offerCurrency} exchange rate is too old to alert on`,
      isConverted: true,
    };
  }

  const deliveredPrice = toMajor(outcome.converted);
  const convertedShipping =
    shipping == null
      ? null
      : convertWithProvenance(shipping, input.preferredCurrency, input.rates.table, {
          maxAgeHours: input.rates.maxAgeHours,
          now: input.now.getTime(),
        }).converted;

  return {
    reached: deliveredPrice <= input.targetDeliveredPrice,
    reason:
      deliveredPrice <= input.targetDeliveredPrice
        ? 'delivered total is at or below the target'
        : 'delivered total is above the target',
    deliveredPrice,
    target: input.targetDeliveredPrice,
    shippingPrice: convertedShipping == null ? null : toMajor(convertedShipping),
    isConverted: outcome.isEstimate,
  };
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
  /**
   * The destination this alert is about, or null for a list-price alert.
   *
   * Scopes the duplicate check. Without it, a Finnish delivered-price alert and a
   * German one would share one history and mute each other, and a list-price alert
   * would mute both. Every pre-existing notification has `null` here, which is
   * exactly the list-price bucket.
   */
  destinationCountry?: string | null;
  /** The delivered total that met the target, in the tracked currency. */
  deliveredPrice?: number | null;
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

  const destinationCountry = input.destinationCountry ?? null;
  const isDelivered = destinationCountry != null && input.deliveredPrice != null;

  const lastAlert = await prisma.notification.findFirst({
    where: {
      userId: input.userId,
      productId: input.productId,
      type: 'TARGET_REACHED',
      status: 'SENT',
      destinationCountry,
    },
    orderBy: { createdAt: 'desc' },
    select: { priceAtAlert: true, deliveredPriceAtAlert: true, createdAt: true },
  });

  if (!lastAlert) return { send: true, reason: 'no previous alert' };

  // Like compared with like: a delivered-price alert is judged against the last
  // delivered figure for the same destination, never against a list price.
  const lastPrice = isDelivered
    ? decimalToNumber(lastAlert.deliveredPriceAtAlert)
    : decimalToNumber(lastAlert.priceAtAlert);
  const price = isDelivered ? (input.deliveredPrice ?? input.price) : input.price;

  // A further drop is new information, regardless of the cooldown.
  if (lastPrice != null && price < lastPrice) {
    return { send: true, reason: 'price dropped further than the last alert' };
  }

  if (lastPrice != null && price >= lastPrice) {
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
