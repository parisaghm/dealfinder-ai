import {
  countryName,
  formatAvailability,
  formatDeliveredCaveats,
  formatMoneyAmount,
  formatRateAge,
  formatRelativeTime,
  localeForCountry,
  type CountryCode,
  type Currency,
  type DeliveredComparison,
  type DestinationOffer,
} from '@deal-finder/shared';
import { Badge, cn } from '@deal-finder/ui';
import { ExternalLink } from 'lucide-react';
import { LG_BREAKPOINT_QUERY, SM_BREAKPOINT_QUERY, useMediaQuery } from '../../lib/use-media-query';
import { DELIVERY_COPY, DeliveryDetails, formatDeliveryWindow } from './DeliveryDetails';

/**
 * Every store's offer for one product, delivered to one country.
 *
 * A sibling of `OfferComparisonTable`, not a replacement. That table compares
 * listed price plus published shipping in a single currency with no notion of
 * where the parcel goes; it is still correct, still what the pre-expansion
 * comparison page shows, and its columns are a subset of a *different* question.
 * This one has thirteen columns, three currencies in play and four separate ways
 * an offer can fail to be comparable. Retrofitting one component to do both would
 * have produced a matrix of conditionals around the most safety-critical numbers
 * in the product.
 *
 * ## One DOM representation per breakpoint
 *
 * The layout switch is a JavaScript media query, not `hidden lg:table-cell`, and
 * that is deliberate for a testing reason rather than an aesthetic one: rendering
 * every row twice and hiding one copy puts each store name, price and badge in the
 * DOM twice, and Playwright locators match hidden elements. Every
 * `getByRole('row')` on the page would then trip strict mode, and the fix — `.first()`
 * everywhere — is exactly the brittleness this repo's selector convention avoids.
 *
 * The column list is declared once and mapped by both `<thead>` and `<tbody>`, so
 * a header and its cells cannot drift apart.
 *
 * ## What may be crowned
 *
 * Only the offer the API named as `cheapestDeliveredOfferId`, which has already
 * been through the shared ranking rules: it ships there, its total is known, it is
 * purchasable, and its exchange rate is fresh enough to rely on. Rows failing any
 * of those are shown — hiding a real offer is its own dishonesty — but they are
 * labelled with the reason and can never carry the badge.
 */

export interface DeliveredComparisonTableProps {
  offers: readonly DestinationOffer[];
  /** Offers for the same product that cannot reach this destination. */
  unavailableHere?: readonly DestinationOffer[];
  comparison: DeliveredComparison;
  country: CountryCode;
  currency: Currency;
}

type Tier = 'always' | 'wide';

interface Column {
  key: string;
  label: string;
  tier: Tier;
  numeric?: boolean;
}

/**
 * The thirteen columns, in reading order.
 *
 * `tier: 'wide'` columns are dropped between `sm` and `lg`. The four that survive
 * every width are the ones without which the table cannot answer its own question:
 * which store, what the product costs, what delivery costs, and what the total is.
 */
const COLUMNS: readonly Column[] = [
  { key: 'store', label: 'Store', tier: 'always' },
  { key: 'from', label: 'Ships from', tier: 'wide' },
  { key: 'product', label: 'Product price', tier: 'always', numeric: true },
  { key: 'original', label: 'Store currency', tier: 'wide', numeric: true },
  { key: 'converted', label: 'Converted', tier: 'wide' },
  { key: 'shipping', label: 'Delivery', tier: 'always', numeric: true },
  { key: 'taxes', label: 'Taxes', tier: 'wide' },
  { key: 'duty', label: 'Import charges', tier: 'wide' },
  { key: 'total', label: 'Delivered total', tier: 'always', numeric: true },
  { key: 'eta', label: 'Delivery time', tier: 'wide' },
  { key: 'availability', label: 'Availability', tier: 'always' },
  { key: 'checked', label: 'Last checked', tier: 'wide' },
  { key: 'link', label: 'View deal', tier: 'always' },
];

export function DeliveredComparisonTable({
  offers,
  unavailableHere = [],
  comparison,
  country,
  currency,
}: DeliveredComparisonTableProps) {
  const wide = useMediaQuery(SM_BREAKPOINT_QUERY);
  const full = useMediaQuery(LG_BREAKPOINT_QUERY);
  const locale = localeForCountry(country);

  // Written here rather than on the server, so the amount inside the sentence
  // goes through the same `formatMoney`, locale and currency as the cell it is
  // talking about.
  const caveatText = formatDeliveredCaveats(comparison.cheapestDeliveredCaveats, currency, locale);

  const columns = full ? COLUMNS : COLUMNS.filter((column) => column.tier === 'always');

  // Named once, from every row shown — including the ones that cannot deliver
  // here, since their prices are just as invented.
  const demoStores = [
    ...new Set(
      [...offers, ...unavailableHere]
        .filter((offer) => offer.isDemoStore)
        .map((offer) => offer.store.name),
    ),
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-700" data-testid="comparison-destination">
        Comparing delivered totals to{' '}
        <span className="font-semibold">{countryName(country)}</span>, in {currency}.{' '}
        {comparison.storesShippingToDestination}{' '}
        {comparison.storesShippingToDestination === 1 ? 'store ships' : 'stores ship'} here.
      </p>

      {wide ? (
        /*
          `overflow-x-auto` on the table's own wrapper, never on the page. A wide
          table must be able to scroll inside its container without the whole
          document scrolling sideways at 320px.
        */
        <div className="overflow-x-auto">
          <table className="w-full min-w-full border-collapse text-sm">
            <caption className="sr-only">
              Offers for this product delivered to {countryName(country)}, cheapest delivered total
              first
            </caption>
            <thead>
              <tr className="border-b border-line-strong text-left">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      'px-2 py-2 text-xs font-semibold whitespace-nowrap text-ink-500',
                      column.numeric && 'text-right',
                    )}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => (
                <OfferRow
                  key={offer.id}
                  offer={offer}
                  columns={columns}
                  locale={locale}

                  isWinner={offer.id === comparison.cheapestDeliveredOfferId}
                />
              ))}
              {unavailableHere.map((offer) => (
                <OfferRow
                  key={offer.id}
                  offer={offer}
                  columns={columns}
                  locale={locale}

                  isWinner={false}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {[...offers, ...unavailableHere].map((offer) => (
            <li
              key={offer.id}
              className="rounded-card border border-line bg-surface p-3 shadow-card"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">{offer.store.name}</span>
                {offer.id === comparison.cheapestDeliveredOfferId && <CheapestDeliveredBadge />}
              </div>
              <DeliveryDetails
                delivery={offer.delivery}
                displayCurrency={currency}
                isDemoStore={offer.isDemoStore}
              />
              <ViewDealLink offer={offer} className="mt-3 w-full justify-center" />
            </li>
          ))}
        </ul>
      )}

      {/* ── Caveats, beneath the table where they qualify the whole thing ── */}
      <div className="flex flex-col gap-1.5">
        {caveatText && (
          <p className="text-xs text-warn-800" role="note" data-testid="delivered-caveat">
            {caveatText}
          </p>
        )}
        {comparison.cheapestDeliveredOfferId == null && (
          <p className="text-xs font-medium text-warn-800" role="note">
            No delivered total can be calculated for {countryName(country)} yet, so no offer is shown
            as cheapest.
          </p>
        )}
        {/*
          Reported, not silently dropped. An offer excluded from the comparison
          because its delivery cost is unpublished is a fact about the comparison,
          and a reader who cannot see the exclusion has no way to tell a short
          list from a complete one.
        */}
        {comparison.offersWithUnknownShipping > 0 && (
          <p className="text-xs text-warn-800" role="note">
            {comparison.offersWithUnknownShipping === 1
              ? '1 offer does not publish a delivery cost, so it has no delivered total and cannot be the cheapest.'
              : `${String(comparison.offersWithUnknownShipping)} offers do not publish a delivery cost, so they have no delivered total and cannot be the cheapest.`}
          </p>
        )}
        {comparison.offersNotShippingToDestination > 0 && (
          <p className="text-xs text-ink-500" role="note">
            {comparison.offersNotShippingToDestination === 1
              ? `1 offer does not ship to ${countryName(country)} and is listed separately rather than compared.`
              : `${String(comparison.offersNotShippingToDestination)} offers do not ship to ${countryName(country)} and are listed separately rather than compared.`}
          </p>
        )}
        {comparison.offersBlockedByExchangeRate > 0 && (
          <p className="text-xs text-warn-800" role="note">
            {comparison.offersBlockedByExchangeRate}{' '}
            {comparison.offersBlockedByExchangeRate === 1 ? 'offer is' : 'offers are'} priced in a
            currency whose exchange rate is too old to decide a winner.
          </p>
        )}
        {comparison.lowestListedPrice != null &&
          comparison.lowestDeliveredPrice != null &&
          comparison.lowestListedPrice.minorUnits < comparison.lowestDeliveredPrice.minorUnits && (
            <p className="text-xs text-ink-500">
              The lowest listed price is{' '}
              {formatMoneyAmount(comparison.lowestListedPrice, locale)} before delivery; the lowest
              delivered total is {formatMoneyAmount(comparison.lowestDeliveredPrice, locale)}.
            </p>
          )}

        {/*
          What the "Demo store" badge in the rows actually means, said once in
          full. The badge alone names a category without defining it — a reader
          who has not met the term could reasonably take it for a retailer's
          brand, and every price in those rows is invented. Stated beneath the
          table rather than in a tooltip, so it is reachable by touch and by
          screen reader.
        */}
        {demoStores.length > 0 && (
          <p className="text-xs text-warn-800" data-testid="demo-store-footnote">
            {demoStores.join(', ')}{' '}
            {demoStores.length === 1
              ? 'is a fictional retailer with synthetic prices, shown for demonstration only.'
              : 'are fictional retailers with synthetic prices, shown for demonstration only.'}
          </p>
        )}
      </div>
    </div>
  );
}

function CheapestDeliveredBadge() {
  // "Cheapest delivered total", not "cheapest price": the two routinely name
  // different stores, and the label is what tells the user which claim is being
  // made. The substring "cheapest total" keeps the wording family consistent with
  // the pre-expansion table.
  return <Badge tone="accent">Cheapest delivered total</Badge>;
}

function ViewDealLink({
  offer,
  className,
}: {
  offer: DestinationOffer;
  className?: string;
}) {
  return (
    <a
      href={offer.store.websiteUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 text-xs font-semibold text-ink-900 transition-colors hover:bg-surface-muted',
        className,
      )}
    >
      View deal
      <ExternalLink className="size-3" aria-hidden="true" />
      <span className="sr-only">(opens {offer.store.name} in a new tab)</span>
    </a>
  );
}

function OfferRow({
  offer,
  columns,
  locale,
  isWinner,
}: {
  offer: DestinationOffer;
  columns: readonly Column[];
  locale: string;
  isWinner: boolean;
}) {
  const { delivery } = offer;
  const converted = delivery.productPrice.converted;
  const notDeliverable = !delivery.shipsToDestination;

  const cell = (column: Column) => {
    switch (column.key) {
      case 'store':
        return (
          <div className="flex flex-col gap-1">
            <span className="font-medium whitespace-nowrap">{offer.store.name}</span>
            {isWinner && <CheapestDeliveredBadge />}
            {offer.isDemoStore && <Badge tone="warn">Demo store</Badge>}
          </div>
        );
      case 'from':
        return delivery.sourceCountryName ?? 'Not published';
      case 'product':
        return formatMoneyAmount(converted ?? delivery.productPrice.original, locale);
      case 'original':
        return formatMoneyAmount(delivery.productPrice.original, locale);
      case 'converted':
        return delivery.productPrice.status === 'same-currency' ? (
          <span className="text-ink-400">Not converted</span>
        ) : delivery.productPrice.status === 'converted-stale' ? (
          <span className="text-warn-800">
            Estimate · rate {formatRateAge(delivery.productPrice.rateAgeHours)}
          </span>
        ) : converted == null ? (
          <span className="text-warn-800">No rate</span>
        ) : (
          <Badge tone="muted">Converted</Badge>
        );
      case 'shipping':
        return delivery.shippingPrice == null ? (
          <span className="text-warn-800">Not published</span>
        ) : delivery.shippingPrice.major === 0 ? (
          'Free'
        ) : (
          formatMoneyAmount(delivery.shippingPrice, locale)
        );
      case 'taxes':
        return delivery.taxesIncluded === true
          ? 'Included'
          : delivery.taxesIncluded === false
            ? 'Not included'
            : 'Not published';
      case 'duty':
        return delivery.importDutyStatus === 'NONE'
          ? 'None'
          : delivery.importDutyStatus === 'INCLUDED'
            ? 'Included'
            : DELIVERY_COPY.dutyPossible;
      case 'total':
        return delivery.totalDeliveredPrice == null ? (
          <span className="font-medium text-warn-800">Unknown</span>
        ) : (
          <span
            data-testid="delivered-price"
            data-delivered={delivery.totalDeliveredPrice.major}
            className="font-semibold"
          >
            {formatMoneyAmount(delivery.totalDeliveredPrice, locale)}
          </span>
        );
      case 'eta':
        return formatDeliveryWindow(delivery.deliveryMinDays, delivery.deliveryMaxDays);
      case 'availability':
        return formatAvailability(delivery.availability);
      case 'checked':
        return formatRelativeTime(delivery.lastCheckedAt);
      case 'link':
        return <ViewDealLink offer={offer} />;
      default:
        return null;
    }
  };

  return (
    <tr
      className={cn(
        'border-b border-line align-top',
        isWinner && 'bg-accent-50',
        notDeliverable && 'opacity-70',
      )}
    >
      {columns.map((column) => (
        <td
          key={column.key}
          className={cn(
            'px-2 py-2 text-xs',
            column.numeric && 'text-right tabular whitespace-nowrap',
          )}
        >
          {/*
            A row that cannot reach the destination says so in its first data
            column rather than showing another destination's delivery figures.
          */}
          {notDeliverable && column.key === 'from' ? (
            <span className="text-warn-800">
              {DELIVERY_COPY.doesNotShip(countryName(delivery.destinationCountry))}
            </span>
          ) : (
            cell(column)
          )}
        </td>
      ))}
    </tr>
  );
}
