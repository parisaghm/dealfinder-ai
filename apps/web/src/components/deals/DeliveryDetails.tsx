import {
  countryName,
  formatConverted,
  formatMoneyAmount,
  formatRateAge,
  localeForCountry,
  type Currency,
  type DeliveryToDestination,
} from '@deal-finder/shared';
import { Badge, cn } from '@deal-finder/ui';
import { AlertTriangle, Info, Truck } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * What one offer means for the selected delivery destination.
 *
 * Every sentence this feature is allowed to say about delivery lives here, in one
 * component, for one reason: the difference between "free delivery" and "delivery
 * cost unknown" is the difference between a useful comparison tool and a
 * misleading one, and wording that important must not be re-improvised per
 * screen. Both cards and the comparison table's narrow layout render from this.
 *
 * The rules, each of which exists because the alternative is a specific lie:
 *
 *  - An unpublished delivery cost is **unknown**, never zero and never "free".
 *  - A missing exchange rate makes an offer **incomparable**, not cheap.
 *  - A stale exchange rate produces an estimate that is shown and labelled, and
 *    is never described as the cheapest.
 *  - A cross-border route says import charges *may* apply; it never claims to
 *    have calculated them.
 *  - A fictional store says so, in text, on the card.
 */

export const DELIVERY_COPY = {
  unknownShipping: 'Shipping cost unknown — delivered total cannot be calculated',
  doesNotShip: (country: string) => `This store does not ship to ${country}`,
  noRate: (from: string, to: string) =>
    `No exchange rate available for ${from} → ${to}, so this offer cannot be compared`,
  staleRate: (age: string) =>
    `Exchange rate last updated ${age} — this converted total is an estimate and is not shown as the cheapest`,
  dutyPossible: 'Import charges may apply',
  taxUnknown: (country: string) =>
    `Tax treatment for ${country} not published — this total may not be final`,
  deliveryUnknown: 'Delivery time not published',
  demoStore: 'Demo store — a fictional retailer with synthetic prices, for demonstration only',
  demoCatalogue: 'Synthetic catalogue · Illustrative prices',
} as const;

/**
 * The delivery estimate in words, or the fact that there is none.
 *
 * "Delivery time not published" rather than an empty cell: a blank reads as fast,
 * or as a rendering bug, and it is neither.
 */
export function formatDeliveryWindow(
  minDays: number | null,
  maxDays: number | null,
): string {
  if (minDays == null && maxDays == null) return DELIVERY_COPY.deliveryUnknown;
  if (minDays != null && maxDays != null) {
    return minDays === maxDays
      ? `${String(minDays)} business days`
      : `${String(minDays)}–${String(maxDays)} business days`;
  }
  const single = minDays ?? maxDays;
  return `about ${String(single)} business days`;
}

/**
 * A fictional retailer, said plainly.
 *
 * A badge *and* a line of text, not a tooltip: a disclosure nobody can see
 * without hovering is not a disclosure, and it is unreachable by touch entirely.
 */
export function DemoStoreNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="demo-store-notice">
      <Badge tone="warn">Demo store</Badge>
      <span className="text-xs text-ink-500">
        {compact ? DELIVERY_COPY.demoCatalogue : DELIVERY_COPY.demoStore}
      </span>
    </div>
  );
}

export interface DeliveryDetailsProps {
  delivery: DeliveryToDestination;
  /**
   * The currency the shopper asked to be quoted in.
   *
   * Passed in rather than read off the delivered total, because the case that
   * most needs naming it — no exchange rate — is exactly the case where every
   * converted amount is null and the DTO can no longer say what the target
   * currency was.
   */
  displayCurrency: Currency;
  isDemoStore?: boolean;
  className?: string;
}

/**
 * The delivered price and the caveats that qualify it.
 *
 * Renders the delivered total as the loud number when there is one, because that
 * is the figure a shopper acts on. When there is not, it says so and shows the
 * list price separately, explicitly marked as excluding delivery — the one thing
 * that must never be presented as a total.
 */
export function DeliveryDetails({
  delivery,
  displayCurrency,
  isDemoStore = false,
  className,
}: DeliveryDetailsProps) {
  const locale = localeForCountry(delivery.destinationCountry);
  const destination = countryName(delivery.destinationCountry);
  const total = delivery.totalDeliveredPrice;
  const listed = delivery.productPrice;

  const conversionNote = formatConverted(listed, locale);
  const rateMissing = listed.status === 'rate-missing' || listed.status === 'rate-unusable';
  const rateStale = listed.status === 'converted-stale';

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {delivery.shipsToDestination ? (
        <>
          {total != null ? (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              {/*
                A hook of its own, deliberately not `current-price`. That one has
                an exclusive contract with the list price on ProductCard, and the
                end-to-end suite reads it to assert sort order; overloading it
                would make "the price" mean two different numbers depending on
                whether a destination happened to be selected.
              */}
              <span
                data-testid="delivered-price"
                data-delivered={total.major}
                className="text-xl font-bold tabular tracking-tight"
              >
                {formatMoneyAmount(total, locale)}
              </span>
              <span className="text-xs text-ink-500">delivered to {destination}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {/*
                Present but with no numeric value, so a reader — human or test —
                can tell "no total was computed" from "no destination was asked
                about".
              */}
              <span data-testid="delivered-price" className="text-sm font-semibold text-warn-800">
                No delivered total can be calculated for {destination} yet
              </span>
              <span className="text-xs text-ink-500">
                {formatMoneyAmount(listed.converted ?? listed.original, locale)} before delivery
              </span>
            </div>
          )}

          <dl className="flex flex-col gap-0.5 text-xs text-ink-500">
            <div className="flex justify-between gap-2">
              <dt>Product price</dt>
              <dd className="tabular">
                {formatMoneyAmount(listed.converted ?? listed.original, locale)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Delivery</dt>
              <dd className={cn('tabular', delivery.shippingPrice == null && 'text-warn-800')}>
                {delivery.shippingPrice == null
                  ? 'Not published'
                  : delivery.shippingPrice.major === 0
                    ? 'Free'
                    : formatMoneyAmount(delivery.shippingPrice, locale)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Ships from</dt>
              <dd>
                {delivery.sourceCountryName ?? 'Not published'}
                {delivery.sourceCountry != null &&
                  delivery.sourceCountry !== delivery.destinationCountry &&
                  ' (cross-border)'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Delivery time</dt>
              <dd>{formatDeliveryWindow(delivery.deliveryMinDays, delivery.deliveryMaxDays)}</dd>
            </div>
          </dl>

          {delivery.shippingPrice == null && (
            <Caveat tone="warn" icon={<Truck className="size-3.5" aria-hidden="true" />}>
              {DELIVERY_COPY.unknownShipping}
            </Caveat>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <Caveat tone="warn" icon={<Truck className="size-3.5" aria-hidden="true" />}>
            {DELIVERY_COPY.doesNotShip(destination)}
          </Caveat>
          <span className="text-xs text-ink-500">
            Listed at {formatMoneyAmount(listed.converted ?? listed.original, locale)}
            {delivery.sourceCountryName ? ` in ${delivery.sourceCountryName}` : ''}, delivery to{' '}
            {destination} not offered.
          </span>
        </div>
      )}

      {/* ── Tax and duty ── */}
      {delivery.taxesIncluded === true && (
        <p className="text-xs text-ink-500">Tax included in the price shown.</p>
      )}
      {delivery.taxesIncluded === null && (
        <Caveat tone="warn" icon={<Info className="size-3.5" aria-hidden="true" />}>
          {DELIVERY_COPY.taxUnknown(destination)}
        </Caveat>
      )}
      {(delivery.importDutyStatus === 'POSSIBLE' || delivery.importDutyStatus === 'UNKNOWN') && (
        <Caveat tone="warn" icon={<AlertTriangle className="size-3.5" aria-hidden="true" />}>
          {DELIVERY_COPY.dutyPossible}
        </Caveat>
      )}

      {/* ── Currency ── */}
      {rateMissing && (
        <Caveat tone="warn" icon={<AlertTriangle className="size-3.5" aria-hidden="true" />}>
          {DELIVERY_COPY.noRate(listed.original.currency, displayCurrency)}
        </Caveat>
      )}
      {rateStale && (
        <Caveat tone="warn" icon={<AlertTriangle className="size-3.5" aria-hidden="true" />}>
          {DELIVERY_COPY.staleRate(formatRateAge(listed.rateAgeHours))}
        </Caveat>
      )}
      {conversionNote && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
          <Badge tone="muted">Converted</Badge>
          <span>{conversionNote}</span>
        </p>
      )}

      {isDemoStore && <DemoStoreNotice compact />}
    </div>
  );
}

function Caveat({
  children,
  icon,
  tone,
}: {
  children: ReactNode;
  icon: ReactNode;
  tone: 'warn' | 'muted';
}) {
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 text-xs',
        tone === 'warn' ? 'font-medium text-warn-800' : 'text-ink-500',
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </p>
  );
}
