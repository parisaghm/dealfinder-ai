import { createRateTable } from '@deal-finder/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendMailResult } from '../src/email/transport';
import { emptyRateContext, type RateContext } from '../src/services/exchange-rate.service';
import {
  runPriceCheck,
  type PriceFetcher,
  type PriceObservation,
} from '../src/services/monitoring.service';
import {
  createTestContext,
  createTestOffer,
  createTestProduct,
  prisma,
  trackProduct,
  type TestContext,
} from './helpers/fixtures';

/**
 * Scheduled monitoring.
 *
 * These cover the six behaviours the brief requires of the job, each of which
 * is a real failure mode:
 *   1. find active watchlist items,
 *   2. get the latest price,
 *   3. write history **only when the price changed**,
 *   4. compare against the target,
 *   5. alert when the target is reached,
 *   6. never alert twice for the same unchanged price,
 *   7. keep going when a provider throws.
 *
 * `fetchPrice`, `now` and `send` are injected, so none of this needs a network,
 * a mail server, or the passage of real time.
 */

let context: TestContext;

/** Captures alert emails instead of sending them. */
function createMailSpy() {
  const sent: Array<{ to: string; subject: string }> = [];
  const send = vi.fn(async (input: { to: string; subject: string }): Promise<SendMailResult> => {
    sent.push({ to: input.to, subject: input.subject });
    return { delivered: true, transport: 'stream', messageId: 'test', outputPath: null };
  });
  return { sent, send };
}

/** A fetcher returning a fixed price for every product. */
const fixedPrice =
  (observation: PriceObservation): PriceFetcher =>
  async () =>
    observation;

/** Old enough that the user's check-frequency gate never suppresses the check. */
const longAgo = () => new Date(Date.now() - 30 * 86_400_000);

beforeEach(async () => {
  context = await createTestContext();
});

afterEach(async () => {
  await context.cleanup();
});

describe('finding work', () => {
  it('checks items whose alerts are enabled', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 200,
      lastCheckedAt: longAgo(),
    });
    await trackProduct(context, productId, { targetPrice: 150 });

    const mail = createMailSpy();
    const summary = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 190 }),
      send: mail.send,
    });

    expect(summary.checked).toBeGreaterThanOrEqual(1);
  });

  it('skips an item whose alerts are paused', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 200,
      lastCheckedAt: longAgo(),
    });
    await trackProduct(context, productId, { targetPrice: 500, alertsEnabled: false });

    const fetchPrice = vi.fn(async (_product: { id: string }) => ({ currentPrice: 100 }));
    await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice,
      send: createMailSpy().send,
    });

    // The paused product must never be fetched at all.
    const fetchedIds = fetchPrice.mock.calls.map(([called]) => called.id);
    expect(fetchedIds).not.toContain(productId);
  });

  it("respects the user's check frequency", async () => {
    await prisma.userSettings.update({
      where: { userId: context.userId },
      data: { checkFrequency: 'WEEKLY' },
    });

    // Checked an hour ago; a weekly cadence means it is not due.
    const productId = await createTestProduct(context, {
      currentPrice: 200,
      lastCheckedAt: new Date(Date.now() - 3_600_000),
    });
    await trackProduct(context, productId, { targetPrice: 150 });

    const fetchPrice = vi.fn(async (_product: { id: string }) => ({ currentPrice: 100 }));
    const summary = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice,
      send: createMailSpy().send,
    });

    const fetchedIds = fetchPrice.mock.calls.map(([called]) => called.id);
    expect(fetchedIds).not.toContain(productId);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
  });
});

describe('recording price history', () => {
  it('writes a history row when the price changed', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 200,
      lastCheckedAt: longAgo(),
      history: [200],
    });
    await trackProduct(context, productId, { targetPrice: 1 });

    await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 180 }),
      send: createMailSpy().send,
    });

    const rows = await prisma.priceHistory.findMany({
      where: { productId },
      orderBy: { recordedAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(Number(rows[1]?.price)).toBe(180);

    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(Number(product?.currentPrice)).toBe(180);
  });

  // The series is a record of price changes, not of how often we polled. A row
  // per check would make "lowest recorded price" meaningless and bloat the table.
  it('writes no history row when the price is unchanged', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 200,
      lastCheckedAt: longAgo(),
      history: [200],
    });
    await trackProduct(context, productId, { targetPrice: 1 });

    await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 200 }),
      send: createMailSpy().send,
    });

    expect(await prisma.priceHistory.count({ where: { productId } })).toBe(1);
  });

  it('always advances lastCheckedAt, even without a change', async () => {
    const before = longAgo();
    const productId = await createTestProduct(context, {
      currentPrice: 200,
      lastCheckedAt: before,
    });
    await trackProduct(context, productId, { targetPrice: 1 });

    await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 200 }),
      send: createMailSpy().send,
    });

    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product!.lastCheckedAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it('recomputes the derived discount column', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 200,
      originalPrice: 400,
      discountPercent: 50,
      lastCheckedAt: longAgo(),
    });
    await trackProduct(context, productId, { targetPrice: 1 });

    await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 300, originalPrice: 400 }),
      send: createMailSpy().send,
    });

    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product?.discountPercent).toBe(25);
  });
});

describe('alerting', () => {
  it('emails when the target price is reached', async () => {
    const productId = await createTestProduct(context, {
      name: 'Target Product',
      currentPrice: 200,
      lastCheckedAt: longAgo(),
    });
    await trackProduct(context, productId, { targetPrice: 150 });

    const mail = createMailSpy();
    const summary = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 140 }),
      send: mail.send,
    });

    expect(summary.alertsSent).toBe(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.to).toBe(context.userEmail);
    expect(mail.sent[0]?.subject).toContain('Target Product');

    const notification = await prisma.notification.findFirst({
      where: { userId: context.userId, productId },
    });
    expect(notification?.type).toBe('TARGET_REACHED');
    expect(notification?.status).toBe('SENT');
    expect(Number(notification?.priceAtAlert)).toBe(140);
  });

  it('does not alert while the price is above the target', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 200,
      lastCheckedAt: longAgo(),
    });
    await trackProduct(context, productId, { targetPrice: 100 });

    const mail = createMailSpy();
    const summary = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 180 }),
      send: mail.send,
    });

    expect(summary.alertsSent).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it('alerts at exactly the target price', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 200,
      lastCheckedAt: longAgo(),
    });
    await trackProduct(context, productId, { targetPrice: 150 });

    const mail = createMailSpy();
    await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 150 }),
      send: mail.send,
    });

    expect(mail.sent).toHaveLength(1);
  });

  it('never alerts for an item with no target price', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 200,
      lastCheckedAt: longAgo(),
    });
    await trackProduct(context, productId, { targetPrice: null });

    const mail = createMailSpy();
    await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 1 }),
      send: mail.send,
    });

    expect(mail.sent).toHaveLength(0);
  });

  it('honours the user disabling email notifications', async () => {
    await prisma.userSettings.update({
      where: { userId: context.userId },
      data: { notifyByEmail: false },
    });

    const productId = await createTestProduct(context, {
      currentPrice: 200,
      lastCheckedAt: longAgo(),
    });
    await trackProduct(context, productId, { targetPrice: 150 });

    const mail = createMailSpy();
    const summary = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 140 }),
      send: mail.send,
    });

    expect(mail.sent).toHaveLength(0);
    expect(summary.alertsSuppressed).toBe(1);
  });
});

describe('duplicate alert suppression', () => {
  // The requirement: no second email for the same unchanged price.
  it('does not alert twice at the same price', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 200,
      lastCheckedAt: longAgo(),
    });
    await trackProduct(context, productId, { targetPrice: 150 });

    const mail = createMailSpy();
    const fetchPrice = fixedPrice({ currentPrice: 140 });

    await runPriceCheck({ prisma, userIds: [context.userId], fetchPrice, send: mail.send });
    expect(mail.sent).toHaveLength(1);

    // Make the product due again; the price has not moved.
    await prisma.product.update({
      where: { id: productId },
      data: { lastCheckedAt: longAgo() },
    });

    const second = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice,
      send: mail.send,
    });
    expect(mail.sent).toHaveLength(1);
    expect(second.alertsSuppressed).toBe(1);
  });

  // A further drop is genuinely new information and worth a second email even
  // inside the cooldown window — a time-only cooldown would swallow it.
  it('alerts again when the price drops further', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 200,
      lastCheckedAt: longAgo(),
    });
    await trackProduct(context, productId, { targetPrice: 150 });

    const mail = createMailSpy();

    await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 140 }),
      send: mail.send,
    });
    expect(mail.sent).toHaveLength(1);

    await prisma.product.update({
      where: { id: productId },
      data: { lastCheckedAt: longAgo() },
    });

    await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 120 }),
      send: mail.send,
      alertCooldownHours: 24,
    });
    expect(mail.sent).toHaveLength(2);
  });

  it('does not alert again when the price rises but is still under the target', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 200,
      lastCheckedAt: longAgo(),
    });
    await trackProduct(context, productId, { targetPrice: 150 });

    const mail = createMailSpy();

    await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 120 }),
      send: mail.send,
    });
    expect(mail.sent).toHaveLength(1);

    await prisma.product.update({
      where: { id: productId },
      data: { lastCheckedAt: longAgo() },
    });

    // Still below the €150 target, but worse than the €120 we already reported.
    await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 145 }),
      send: mail.send,
    });
    expect(mail.sent).toHaveLength(1);
  });
});

describe('provider failure isolation', () => {
  it('keeps processing after one product throws, and reports the failure', async () => {
    const failing = await createTestProduct(context, {
      externalId: 'fails',
      currentPrice: 200,
      lastCheckedAt: longAgo(),
    });
    const working = await createTestProduct(context, {
      externalId: 'works',
      currentPrice: 200,
      lastCheckedAt: longAgo(),
    });
    await trackProduct(context, failing, { targetPrice: 150 });
    await trackProduct(context, working, { targetPrice: 150 });

    const mail = createMailSpy();
    const summary = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: async (product) => {
        if (product.id === failing) throw new Error('Store is down');
        return { currentPrice: 140 };
      },
      send: mail.send,
    });

    // The healthy product still got checked and alerted.
    expect(summary.alertsSent).toBe(1);
    expect(summary.failures.some((failure) => failure.message.includes('Store is down'))).toBe(
      true,
    );

    const updated = await prisma.product.findUnique({ where: { id: working } });
    expect(Number(updated?.currentPrice)).toBe(140);
  });

  it('records a failure when the provider returns no price', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 200,
      lastCheckedAt: longAgo(),
    });
    await trackProduct(context, productId, { targetPrice: 150 });

    const summary = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: async () => null,
      send: createMailSpy().send,
    });

    expect(summary.failures.length).toBeGreaterThanOrEqual(1);
    // The stored price must not be overwritten by a failed lookup.
    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(Number(product?.currentPrice)).toBe(200);
  });

  it('marks the notification FAILED when the email cannot be sent', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 200,
      lastCheckedAt: longAgo(),
    });
    await trackProduct(context, productId, { targetPrice: 150 });

    const summary = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 140 }),
      send: async () => ({
        delivered: false,
        transport: 'smtp' as const,
        messageId: null,
        outputPath: null,
        error: 'SMTP unreachable',
      }),
    });

    expect(summary.alertsSent).toBe(0);
    const notification = await prisma.notification.findFirst({
      where: { userId: context.userId, productId },
    });
    expect(notification?.status).toBe('FAILED');
    expect(notification?.error).toContain('SMTP unreachable');

    // lastAlertedAt is still stamped, so a permanently broken mail server does
    // not retry the same alert on every run.
    const item = await prisma.watchlistItem.findFirst({ where: { productId } });
    expect(item?.lastAlertedAt).not.toBeNull();
  });
});

/**
 * Destination-aware alerting.
 *
 * A delivered-price target asks a different question from a list-price one, and
 * the answer has to be *established* before an email claims it. Five distinct
 * conditions below say "not yet" — no offer, unpublished shipping, no exchange
 * rate, a stale exchange rate, and a total above the threshold — and in none of
 * them does the monitor fall back to the list price. Falling back would be the
 * worst available behaviour: it would tell a user their €300 delivered target was
 * met because the sticker said €299, while delivery cost €12.90.
 *
 * Note the deliberate boundary. The monitor refreshes *listed* prices through
 * `fetchPrice` and evaluates delivered targets against the recorded `StoreOffer`.
 * Re-quoting every destination on every run would mean a provider call per
 * watchlist item per country; destination offers are refreshed by the ingestion
 * path instead. So the delivered figure is as fresh as the last offer refresh,
 * and `StoreOffer.lastCheckedAt` records when that was.
 */
describe('destination-aware alerting', () => {
  const HOUR = 3_600_000;

  /** The Danish rate, observed an hour ago. */
  function freshRates(now: number): RateContext {
    return {
      table: createRateTable([
        {
          baseCurrency: 'DKK',
          quoteCurrency: 'EUR',
          rate: '0.13400000',
          fetchedAt: new Date(now - HOUR).toISOString(),
        },
      ]),
      maxAgeHours: 48,
      now,
      isFallback: false,
    };
  }

  /** The same rate, ten days old. */
  function staleRates(now: number): RateContext {
    return {
      table: createRateTable([
        {
          baseCurrency: 'DKK',
          quoteCurrency: 'EUR',
          rate: '0.13400000',
          fetchedAt: new Date(now - 10 * 24 * HOUR).toISOString(),
        },
      ]),
      maxAgeHours: 48,
      now,
      isFallback: false,
    };
  }

  it('alerts when the delivered total reaches the target, naming the destination', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 299,
      shippingPrice: 9.9,
      lastCheckedAt: longAgo(),
    });
    await createTestOffer(productId, context.storeId, {
      countryCode: 'FI',
      storeCountryCode: 'FI',
      productPrice: 299,
      shippingPrice: 9.9,
    });
    await trackProduct(context, productId, {
      destinationCountry: 'FI',
      preferredCurrency: 'EUR',
      targetDeliveredPrice: 320,
    });

    const mail = createMailSpy();
    const summary = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 299 }),
      send: mail.send,
    });

    expect(summary.alertsSent).toBe(1);
    // 299 + 9,90 = 308,90, at or below the 320 target.
    expect(mail.sent[0]?.subject).toContain('delivered to Finland');

    const notification = await prisma.notification.findFirst({
      where: { userId: context.userId, productId },
    });
    expect(notification?.destinationCountry).toBe('FI');
    expect(Number(notification?.deliveredPriceAtAlert)).toBe(308.9);
  });

  it('takes the delivered target in preference to the list-price one', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 299,
      lastCheckedAt: longAgo(),
    });
    await createTestOffer(productId, context.storeId, {
      countryCode: 'FI',
      storeCountryCode: 'FI',
      productPrice: 299,
      shippingPrice: 9.9,
    });
    await trackProduct(context, productId, {
      // The list price of 299 is comfortably under 400 and would have alerted.
      targetPrice: 400,
      destinationCountry: 'FI',
      // The delivered total of 308,90 is not under 300, so it has not.
      targetDeliveredPrice: 300,
    });

    const mail = createMailSpy();
    const summary = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 299 }),
      send: mail.send,
    });

    expect(summary.alertsSent).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it('waits, rather than using the list price, when shipping is unpublished', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 250,
      lastCheckedAt: longAgo(),
    });
    await createTestOffer(productId, context.storeId, {
      countryCode: 'FI',
      storeCountryCode: 'FI',
      productPrice: 250,
      // Unpublished. Not zero.
      shippingPrice: null,
    });
    await trackProduct(context, productId, {
      destinationCountry: 'FI',
      // 250 would beat this. The delivered total is unknown, so nothing has.
      targetDeliveredPrice: 300,
    });

    const mail = createMailSpy();
    const summary = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 250 }),
      send: mail.send,
    });

    expect(summary.alertsSent).toBe(0);
    expect(await prisma.notification.count({ where: { productId } })).toBe(0);
  });

  it('waits when no offer proves delivery to the tracked destination', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 100,
      lastCheckedAt: longAgo(),
    });
    // A Finnish offer exists; the user tracks Germany.
    await createTestOffer(productId, context.storeId, {
      countryCode: 'FI',
      storeCountryCode: 'FI',
      productPrice: 100,
      shippingPrice: 0,
    });
    await trackProduct(context, productId, {
      destinationCountry: 'DE',
      targetDeliveredPrice: 500,
    });

    const mail = createMailSpy();
    const summary = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 100 }),
      send: mail.send,
    });

    expect(summary.alertsSent).toBe(0);
  });

  it('does not alert when no exchange rate is available for the offer currency', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 1990,
      currency: 'DKK',
      lastCheckedAt: longAgo(),
    });
    await createTestOffer(productId, context.storeId, {
      countryCode: 'FI',
      storeCountryCode: 'DK',
      currency: 'DKK',
      productPrice: 1990,
      shippingPrice: 99,
    });
    await trackProduct(context, productId, {
      destinationCountry: 'FI',
      preferredCurrency: 'EUR',
      // 2 089 kr is about 280 euro, so a usable rate would have alerted.
      targetDeliveredPrice: 300,
    });

    const mail = createMailSpy();
    const summary = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 1990 }),
      send: mail.send,
      rates: emptyRateContext({ now: Date.now() }),
    });

    expect(summary.alertsSent).toBe(0);
  });

  it('does not alert on a stale exchange rate, but does on a fresh one', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 1990,
      currency: 'DKK',
      lastCheckedAt: longAgo(),
    });
    await createTestOffer(productId, context.storeId, {
      countryCode: 'FI',
      storeCountryCode: 'DK',
      currency: 'DKK',
      productPrice: 1990,
      shippingPrice: 99,
    });
    await trackProduct(context, productId, {
      destinationCountry: 'FI',
      preferredCurrency: 'EUR',
      targetDeliveredPrice: 300,
    });

    const stale = createMailSpy();
    const withStaleRate = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 1990 }),
      send: stale.send,
      rates: staleRates(Date.now()),
    });
    expect(withStaleRate.alertsSent).toBe(0);

    // The threshold really was crossed. It was the rate's age that withheld the
    // email, not the arithmetic.
    await prisma.product.update({
      where: { id: productId },
      data: { lastCheckedAt: longAgo() },
    });
    const fresh = createMailSpy();
    const withFreshRate = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 1990 }),
      send: fresh.send,
      rates: freshRates(Date.now()),
    });
    expect(withFreshRate.alertsSent).toBe(1);

    const notification = await prisma.notification.findFirst({ where: { productId } });
    expect(Number(notification?.deliveredPriceAtAlert)).toBeCloseTo(279.93, 2);
  });

  it('evaluates each destination target independently', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 299,
      lastCheckedAt: longAgo(),
    });
    await createTestOffer(productId, context.storeId, {
      countryCode: 'FI',
      storeCountryCode: 'FI',
      productPrice: 299,
      shippingPrice: 9.9,
    });
    await createTestOffer(productId, context.storeId, {
      countryCode: 'DE',
      storeCountryCode: 'FI',
      productPrice: 299,
      shippingPrice: 19.9,
    });

    // 308,90 to Finland meets its target; 318,90 to Germany does not meet its.
    await trackProduct(context, productId, {
      destinationCountry: 'FI',
      targetDeliveredPrice: 320,
    });
    await trackProduct(context, productId, {
      destinationCountry: 'DE',
      targetDeliveredPrice: 310,
    });

    const mail = createMailSpy();
    const summary = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 299 }),
      send: mail.send,
    });

    expect(summary.alertsSent).toBe(1);
    const notifications = await prisma.notification.findMany({ where: { productId } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.destinationCountry).toBe('FI');
  });

  it('suppresses a repeat when the delivered total has not improved', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 299,
      lastCheckedAt: longAgo(),
    });
    await createTestOffer(productId, context.storeId, {
      countryCode: 'FI',
      storeCountryCode: 'FI',
      productPrice: 299,
      shippingPrice: 9.9,
    });
    await trackProduct(context, productId, {
      destinationCountry: 'FI',
      targetDeliveredPrice: 320,
    });

    const first = createMailSpy();
    await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 299 }),
      send: first.send,
    });

    // Both gates that are *not* under test are reopened, so the only thing left
    // that can withhold the second email is the unchanged delivered total.
    await prisma.product.update({ where: { id: productId }, data: { lastCheckedAt: longAgo() } });
    await prisma.watchlistItem.updateMany({ where: { productId }, data: { lastAlertedAt: null } });

    const second = createMailSpy();
    const repeat = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 299 }),
      send: second.send,
    });

    expect(repeat.alertsSent).toBe(0);
    expect(repeat.alertsSuppressed).toBe(1);
  });

  it('keeps delivered and list-price alert histories separate', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 299,
      lastCheckedAt: longAgo(),
    });
    await createTestOffer(productId, context.storeId, {
      countryCode: 'FI',
      storeCountryCode: 'FI',
      productPrice: 299,
      shippingPrice: 9.9,
    });

    // Two targets on one product: a delivered one for Finland, and a plain
    // list-price one. Neither may mute the other.
    await trackProduct(context, productId, {
      destinationCountry: 'FI',
      targetDeliveredPrice: 320,
    });
    await trackProduct(context, productId, {
      destinationCountry: 'DE',
      targetPrice: 400,
    });

    const mail = createMailSpy();
    const summary = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 299 }),
      send: mail.send,
    });

    expect(summary.alertsSent).toBe(2);
    const notifications = await prisma.notification.findMany({ where: { productId } });
    expect(notifications).toHaveLength(2);
    // The list-price alert records no destination at all, which is what keeps it
    // in its own bucket for the duplicate check.
    const destinations = notifications.map((row) => row.destinationCountry);
    expect(destinations).toContain('FI');
    expect(destinations).toContain(null);
  });

  it('leaves list-price monitoring exactly as it was', async () => {
    const productId = await createTestProduct(context, {
      currentPrice: 200,
      lastCheckedAt: longAgo(),
    });
    await trackProduct(context, productId, { targetPrice: 150 });

    const mail = createMailSpy();
    const summary = await runPriceCheck({
      prisma,
      userIds: [context.userId],
      fetchPrice: fixedPrice({ currentPrice: 140 }),
      send: mail.send,
    });

    expect(summary.alertsSent).toBe(1);
    const notification = await prisma.notification.findFirst({ where: { productId } });
    expect(notification?.destinationCountry).toBeNull();
    expect(notification?.deliveredPriceAtAlert).toBeNull();
    expect(Number(notification?.priceAtAlert)).toBe(140);
    // No destination language in an email that is not about a destination.
    expect(mail.sent[0]?.subject).not.toContain('delivered to');
  });
});
