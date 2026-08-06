import {
  countryName,
  formatMoney,
  formatMoneyAmount,
  localeForCountry,
  type CanonicalProductSummary,
  type CountryCode,
  type Currency,
  type MoneyAmountDto,
  type ProductSummary,
} from '@deal-finder/shared';
import { Button, cn } from '@deal-finder/ui';
import { AlertTriangle, ArrowLeftRight, Bookmark, ImageOff, Store } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { destinationPath } from '../../lib/destination';
import { DealQualityBadge } from './DealQualityBadge';
import { DemoStoreNotice } from './DeliveryDetails';

/**
 * One product, several stores.
 *
 * The grouped counterpart to `ProductCard`, and deliberately its sibling rather
 * than a mode of it: the two answer different questions. A product card says
 * "here is an offer"; this says "here is a product, and here is the spread".
 *
 * Two things it will not do:
 *
 *  - **Hide uncertainty.** When the group was assembled on a judgement rather
 *    than a published identifier, or when the offers differ in some way that
 *    did not block the merge, that is stated on the card in words. Grouping is
 *    the feature most able to mislead, so it is the one that has to volunteer
 *    its own doubts.
 *  - **Emit `data-testid="current-price"`.** That hook means "one store's
 *    current price", and the existing sort-ordering E2E test reads every
 *    instance of it on the page. A grouped card publishing one would poison
 *    that read the moment anyone combined grouping with a sort.
 */

/**
 * What a group of offers means for one destination.
 *
 * Aggregated by the page from the destination offers on the current page, rather
 * than fetched: the grouped card is a decoration of a page that has already been
 * selected and ordered, and issuing a request per group would be an N+1 on the
 * most-rendered component in the product.
 *
 * `storesShipping` is counted from offers. It is never derived from a store's own
 * declared delivery list, because a store can declare a country and still have no
 * offer for this particular product there.
 */
export interface GroupDestinationSummary {
  country: CountryCode;
  currency: Currency;
  /** Lowest delivered total among offers that can actually reach the country. */
  lowestDelivered: MoneyAmountDto | null;
  /** Lowest listed price among those offers, for the "before delivery" line. */
  lowestListed: MoneyAmountDto | null;
  storesShipping: number;
  storesTotal: number;
  offersWithUnknownShipping: number;
  hasDemoStore: boolean;
}

export interface GroupedProductCardProps {
  group: CanonicalProductSummary;
  onTrackBest?: (offer: ProductSummary) => void;
  trackPending?: boolean;
  /** Null when no destination is selected, which restores the original card. */
  destination?: GroupDestinationSummary | null;
}

export function GroupedProductCard({
  group,
  onTrackBest,
  trackPending,
  destination = null,
}: GroupedProductCardProps) {
  const [notesOpen, setNotesOpen] = useState(false);

  const uncertain = group.matchConfidence !== 'HIGH';
  const hasNotes = group.variantNotes.length > 0;
  const [firstNote, ...remainingNotes] = group.variantNotes;

  const showsRange =
    group.lowestPrice != null && group.highestPrice != null && group.highestPrice > group.lowestPrice;

  /*
    The destination travels with the click. Without it, following a card from a
    destination-aware search lands on a comparison that has to guess — and with a
    link someone shared there is nothing stored to guess from, so it would quietly
    answer for the reader's own country rather than the one the link named.
  */
  const compareTo = destinationPath(`/compare/${group.id}`, destination);

  return (
    <article className="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-shadow duration-150 hover:shadow-raised">
      <Link
        to={compareTo}
        className="group relative block bg-surface-muted"
        // Distinct from the "Compare offers" action below, which goes to the
        // same place: two links with the same accessible name in one card are
        // ambiguous to anyone navigating by link list.
        aria-label={`${group.name} — all offers`}
      >
        <GroupImage src={group.imageUrl} alt={group.name} />
        <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-md bg-ink-900/80 px-2 py-1 text-xs font-semibold text-white">
          <Store className="size-3" aria-hidden="true" />
          {destination
            ? /*
                Counted from offers, not from store metadata. "4 of 7 stores ship
                to Finland" is a claim about delivery, and only an offer can
                support it.
              */
              `${String(destination.storesShipping)} of ${String(destination.storesTotal)} ship to ${countryName(destination.country)}`
            : `${String(group.storeCount)} ${group.storeCount === 1 ? 'store' : 'stores'}`}
        </span>
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="text-sm leading-snug font-semibold">
          <Link to={compareTo} className="hover:text-accent-700">
            {group.name}
          </Link>
        </h3>

        <div className="mt-auto flex flex-col gap-1">
          {destination ? (
            <DestinationHeadline destination={destination} />
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-xl font-bold tabular tracking-tight">
                {group.lowestPrice != null ? formatMoney(group.lowestPrice, group.currency) : '—'}
              </span>
              {showsRange && (
                <span className="text-sm text-ink-400 tabular">
                  – {formatMoney(group.highestPrice ?? 0, group.currency)}
                </span>
              )}
            </div>
          )}

          {/*
            Savings against the most expensive *current* offer, never against a
            crossed-out "original". This number is a fact about two live prices,
            which is precisely what a struck-through claim is not.
          */}
          {group.savingsAgainstHighest != null && group.savingsAgainstHighest > 0 && (
            <span className="text-xs font-medium text-drop-700">
              Save {formatMoney(group.savingsAgainstHighest, group.currency)} (
              {Math.round(group.savingsPercentAgainstHighest ?? 0)}%) versus the dearest offer
            </span>
          )}

          {group.bestOffer && !destination && (
            <span className="text-xs text-ink-500">
              Cheapest at{' '}
              <span className="font-medium text-ink-700">{group.bestOffer.store.name}</span>
              {group.bestOffer.shippingPrice != null && group.bestOffer.shippingPrice > 0
                ? ` · ${formatMoney(group.bestOffer.effectivePrice, group.currency)} with delivery`
                : ''}
            </span>
          )}

          {destination && destination.offersWithUnknownShipping > 0 && (
            <span className="text-xs font-medium text-warn-800">
              {destination.offersWithUnknownShipping === 1
                ? '1 offer does not publish a delivery cost, so it cannot be compared.'
                : `${String(destination.offersWithUnknownShipping)} offers do not publish a delivery cost, so they cannot be compared.`}
            </span>
          )}

          {destination?.hasDemoStore && <DemoStoreNotice compact />}
        </div>

        {group.bestOffer && (
          <div className="flex flex-wrap items-center gap-1.5">
            <DealQualityBadge quality={group.bestOffer.dealQuality} />
            <span className="text-xs text-ink-500">{group.bestOffer.dealQuality.headline}</span>
          </div>
        )}

        {(uncertain || hasNotes) && (
          <div className="flex flex-col gap-1 rounded-lg bg-warn-50 p-2.5 ring-1 ring-warn-200">
            {uncertain && (
              <span className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-warn-800">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                Unconfirmed match
              </span>
            )}
            {firstNote && <p className="text-xs text-warn-800">{firstNote}</p>}
            {remainingNotes.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setNotesOpen((open) => !open)}
                  aria-expanded={notesOpen}
                  className="w-fit text-xs font-semibold text-warn-800 underline"
                >
                  {notesOpen
                    ? 'Hide other differences'
                    : `${remainingNotes.length} other difference${remainingNotes.length === 1 ? '' : 's'}`}
                </button>
                {notesOpen && (
                  <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs text-warn-800">
                    {remainingNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {/*
            An internal navigation, so a Link rather than the external anchor a
            product card uses for "View deal".
          */}
          <Link
            to={compareTo}
            className={cn(
              'inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-accent-700 px-3',
              'text-sm font-semibold text-white transition-colors hover:bg-accent-800',
            )}
          >
            <ArrowLeftRight className="size-3.5" aria-hidden="true" />
            Compare offers
          </Link>

          {onTrackBest && group.bestOffer && (
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              loading={trackPending}
              disabled={group.bestOffer.isTracked}
              onClick={() => group.bestOffer && onTrackBest(group.bestOffer)}
              leadingIcon={<Bookmark className="size-3.5" aria-hidden="true" />}
            >
              {group.bestOffer.isTracked ? 'Tracking' : 'Track cheapest'}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * The headline figure for a destination.
 *
 * "From €311,90 delivered to Finland" when a total exists. When none does, it
 * says so first and then shows the list price *labelled as excluding delivery* —
 * never a bare number, because a bare number in the headline slot reads as a
 * total no matter what the small print says.
 *
 * Deliberately emits no `data-testid="current-price"`. That hook means one store's
 * current price and the end-to-end sort assertions read every instance of it;
 * a grouped card publishing one would corrupt that read.
 */
function DestinationHeadline({ destination }: { destination: GroupDestinationSummary }) {
  const locale = localeForCountry(destination.country);
  const country = countryName(destination.country);

  if (destination.lowestDelivered != null) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          data-testid="delivered-price"
          data-delivered={destination.lowestDelivered.major}
          className="text-xl font-bold tabular tracking-tight"
        >
          From {formatMoneyAmount(destination.lowestDelivered, locale)}
        </span>
        <span className="text-sm text-ink-500">delivered to {country}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span data-testid="delivered-price" className="text-sm font-semibold text-warn-800">
        No delivered total can be calculated for {country} yet
      </span>
      {destination.lowestListed != null && (
        <span className="text-base font-semibold tabular">
          From {formatMoneyAmount(destination.lowestListed, locale)}{' '}
          <span className="text-xs font-normal text-ink-500">before delivery</span>
        </span>
      )}
    </div>
  );
}

function GroupImage({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="flex aspect-4/3 w-full items-center justify-center text-ink-400">
        <ImageOff className="size-8" aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="aspect-4/3 w-full object-contain p-4 transition-transform duration-200 group-hover:scale-[1.03]"
    />
  );
}
