import { formatMoney, type CanonicalProductSummary, type ProductSummary } from '@deal-finder/shared';
import { Button, cn } from '@deal-finder/ui';
import { AlertTriangle, ArrowLeftRight, Bookmark, ImageOff, Store } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DealQualityBadge } from './DealQualityBadge';

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

export interface GroupedProductCardProps {
  group: CanonicalProductSummary;
  onTrackBest?: (offer: ProductSummary) => void;
  trackPending?: boolean;
}

export function GroupedProductCard({ group, onTrackBest, trackPending }: GroupedProductCardProps) {
  const [notesOpen, setNotesOpen] = useState(false);

  const uncertain = group.matchConfidence !== 'HIGH';
  const hasNotes = group.variantNotes.length > 0;
  const [firstNote, ...remainingNotes] = group.variantNotes;

  const showsRange =
    group.lowestPrice != null && group.highestPrice != null && group.highestPrice > group.lowestPrice;

  return (
    <article className="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-shadow duration-150 hover:shadow-raised">
      <Link
        to={`/compare/${group.id}`}
        className="group relative block bg-surface-muted"
        // Distinct from the "Compare offers" action below, which goes to the
        // same place: two links with the same accessible name in one card are
        // ambiguous to anyone navigating by link list.
        aria-label={`${group.name} — all offers`}
      >
        <GroupImage src={group.imageUrl} alt={group.name} />
        <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-md bg-ink-900/80 px-2 py-1 text-xs font-semibold text-white">
          <Store className="size-3" aria-hidden="true" />
          {group.storeCount} {group.storeCount === 1 ? 'store' : 'stores'}
        </span>
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="text-sm leading-snug font-semibold">
          <Link to={`/compare/${group.id}`} className="hover:text-accent-700">
            {group.name}
          </Link>
        </h3>

        <div className="mt-auto flex flex-col gap-1">
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

          {group.bestOffer && (
            <span className="text-xs text-ink-500">
              Cheapest at{' '}
              <span className="font-medium text-ink-700">{group.bestOffer.store.name}</span>
              {group.bestOffer.shippingPrice != null && group.bestOffer.shippingPrice > 0
                ? ` · ${formatMoney(group.bestOffer.effectivePrice, group.currency)} with delivery`
                : ''}
            </span>
          )}
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
            to={`/compare/${group.id}`}
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
