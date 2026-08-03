import {
  formatAvailability,
  formatDiscount,
  formatMoney,
  formatRelativeTime,
  OFFER_SORT_OPTIONS,
  type CanonicalOffer,
  type Currency,
  type OfferComparisonDto,
  type OfferSort,
} from '@deal-finder/shared';
import { Badge, Field, Select, cn } from '@deal-finder/ui';
import { ExternalLink } from 'lucide-react';
import { SM_BREAKPOINT_QUERY, useMediaQuery } from '../../lib/use-media-query';

/**
 * Every offer for one product, side by side.
 *
 * The single most important thing on this page is *which row is highlighted*,
 * and it is the cheapest **total** — product price plus delivery — not the
 * cheapest listed price. Those routinely name different stores, and a
 * comparison tool that highlights the listed price recommends the wrong shop
 * with total confidence. Everything else here is in service of making that
 * claim checkable: shipping and total get their own columns, an offer with no
 * published delivery cost says so and can never win, and when a cheaper offer
 * was passed over the reason is printed under the table rather than omitted.
 */

const SORT_LABELS: Record<OfferSort, string> = {
  'lowest-total': 'Lowest total price',
  'lowest-price': 'Lowest product price',
  'best-discount': 'Best discount',
  'best-deal-quality': 'Best deal quality',
  'recently-updated': 'Recently updated',
};

export interface OfferComparisonTableProps {
  offers: readonly CanonicalOffer[];
  currency: Currency;
  productName: string;
  sort: OfferSort;
  onSortChange: (sort: OfferSort) => void;
  comparison: OfferComparisonDto;
}

export function OfferComparisonTable({
  offers,
  currency,
  productName,
  sort,
  onSortChange,
  comparison,
}: OfferComparisonTableProps) {
  const wide = useMediaQuery(SM_BREAKPOINT_QUERY);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-ink-500">
          {offers.length} {offers.length === 1 ? 'offer' : 'offers'}
        </p>
        <Field label="Sort offers by" className="w-56">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              value={sort}
              onChange={(event) => onSortChange(event.target.value as OfferSort)}
            >
              {OFFER_SORT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {SORT_LABELS[option]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {wide ? (
        <WideTable
          offers={offers}
          currency={currency}
          productName={productName}
          comparison={comparison}
        />
      ) : (
        <NarrowList offers={offers} currency={currency} comparison={comparison} />
      )}

      {comparison.cheapestTotalCaveat && (
        <p className="rounded-lg bg-warn-50 p-2.5 text-xs text-warn-800 ring-1 ring-warn-200">
          {comparison.cheapestTotalCaveat}
        </p>
      )}
    </div>
  );
}

/** The badge is real text, so the highlight survives greyscale and screen readers. */
function CheapestBadge() {
  return <Badge tone="accent">Cheapest total</Badge>;
}

function totalLabel(offer: CanonicalOffer, currency: Currency): string {
  return offer.totalPrice == null
    ? 'Total unknown'
    : formatMoney(offer.totalPrice, currency);
}

function shippingLabel(offer: CanonicalOffer, currency: Currency): string {
  if (offer.shippingPrice == null) return 'Not listed';
  if (offer.shippingPrice === 0) return 'Free';
  return formatMoney(offer.shippingPrice, currency);
}

function WideTable({
  offers,
  currency,
  productName,
  comparison,
}: {
  offers: readonly CanonicalOffer[];
  currency: Currency;
  productName: string;
  comparison: OfferComparisonDto;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <caption className="sr-only">Offers for {productName}, one row per store</caption>
        <thead className="bg-surface-muted">
          <tr>
            <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-ink-700">
              Store
            </th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-semibold text-ink-700">
              Product price
            </th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-semibold text-ink-700">
              Shipping
            </th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-semibold text-ink-700">
              Total
            </th>
            <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-ink-700">
              Availability
            </th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-semibold text-ink-700">
              Discount
            </th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-semibold text-ink-700">
              Deal quality
            </th>
            <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-ink-700">
              Last checked
            </th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-semibold text-ink-700">
              <span className="sr-only">View deal</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer) => {
            const winner = offer.id === comparison.cheapestTotalOfferId;
            return (
              <tr
                key={offer.id}
                className={cn(
                  'border-t border-line',
                  winner && 'bg-accent-50 ring-1 ring-accent-100 ring-inset',
                )}
              >
                <th scope="row" className="px-3 py-2.5 text-left font-medium text-ink-900">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {offer.store.name}
                    {winner && <CheapestBadge />}
                  </span>
                </th>
                <td className="px-3 py-2.5 text-right tabular">
                  {formatMoney(offer.currentPrice, currency)}
                </td>
                <td className="px-3 py-2.5 text-right tabular text-ink-700">
                  {shippingLabel(offer, currency)}
                </td>
                <td
                  className={cn(
                    'px-3 py-2.5 text-right tabular',
                    winner ? 'font-bold text-accent-800' : 'text-ink-900',
                    offer.totalPrice == null && 'text-ink-400',
                  )}
                >
                  {totalLabel(offer, currency)}
                </td>
                <td
                  className={cn(
                    'px-3 py-2.5 text-xs',
                    offer.availability === 'OUT_OF_STOCK'
                      ? 'font-medium text-rise-700'
                      : 'text-ink-700',
                  )}
                >
                  {formatAvailability(offer.availability)}
                </td>
                <td className="px-3 py-2.5 text-right text-xs tabular text-ink-700">
                  {formatDiscount(offer.discountPercent) ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-right text-xs tabular text-ink-700">
                  {offer.dealQuality.score}/100
                </td>
                <td className="px-3 py-2.5 text-xs text-ink-500">
                  {formatRelativeTime(offer.lastCheckedAt)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <a
                    href={offer.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-accent-700 hover:text-accent-800"
                  >
                    View deal
                    <ExternalLink className="size-3" aria-hidden="true" />
                    <span className="sr-only">at {offer.store.name} (opens in a new tab)</span>
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The mobile treatment: one card per store, transposed.
 *
 * A nine-column table is about two and a half screen-widths of horizontal
 * panning at 375px, and a horizontal scroller nested inside a vertically
 * scrolling page is a known touch-gesture conflict. Worse, it never shows
 * Shipping and Total together — which is the exact pair the highlight is
 * about. A card holds one store's whole offer at once, and the list is already
 * in the reader's chosen sort order, so "cheapest first" *is* the reading
 * order.
 */
function NarrowList({
  offers,
  currency,
  comparison,
}: {
  offers: readonly CanonicalOffer[];
  currency: Currency;
  comparison: OfferComparisonDto;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {offers.map((offer) => {
        const winner = offer.id === comparison.cheapestTotalOfferId;
        return (
          <li
            key={offer.id}
            className={cn(
              'rounded-lg border p-3',
              winner ? 'border-accent-700 bg-accent-50' : 'border-line bg-surface',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink-900">{offer.store.name}</h3>
              {winner && <CheapestBadge />}
            </div>

            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <Row label="Product price" value={formatMoney(offer.currentPrice, currency)} />
              <Row label="Shipping" value={shippingLabel(offer, currency)} />
              <Row
                label="Total"
                value={totalLabel(offer, currency)}
                emphasis={winner}
                muted={offer.totalPrice == null}
              />
              <Row label="Availability" value={formatAvailability(offer.availability)} />
              <Row label="Discount" value={formatDiscount(offer.discountPercent) ?? '—'} />
              <Row label="Deal quality" value={`${offer.dealQuality.score}/100`} />
              <Row label="Last checked" value={formatRelativeTime(offer.lastCheckedAt)} />
            </dl>

            <a
              href={offer.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-ink-900"
            >
              View deal
              <ExternalLink className="size-3.5" aria-hidden="true" />
              <span className="sr-only">at {offer.store.name} (opens in a new tab)</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function Row({
  label,
  value,
  emphasis,
  muted,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-ink-500">{label}</dt>
      <dd
        className={cn(
          'tabular',
          emphasis ? 'font-bold text-accent-800' : 'font-medium text-ink-900',
          muted && 'font-normal text-ink-400',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
