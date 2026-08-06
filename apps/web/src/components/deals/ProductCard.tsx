import {
  formatAvailability,
  formatDiscount,
  formatMoney,
  formatRelativeTime,
  type Currency,
  type DeliveryToDestination,
  type ProductSummary,
} from '@deal-finder/shared';
import { Badge, Button, cn } from '@deal-finder/ui';
import { AlertTriangle, Bookmark, BookmarkCheck, ExternalLink, ImageOff } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { destinationPath } from '../../lib/destination';
import { DeliveryDetails } from './DeliveryDetails';

/**
 * Product card.
 *
 * Price is the loudest element on the card, because price is why the user is
 * here. Everything else — store, availability, shipping, last checked — is
 * present but quiet.
 *
 * Note the two distinct actions: "View deal" leaves for the store (a real
 * external link, opened in a new tab with `rel="noreferrer"`), while "Track
 * price" stays in the app. They are visually distinguished so a user who wants
 * to buy and a user who wants to wait are not funnelled into the same button.
 */

export interface ProductCardProps {
  product: ProductSummary;
  onTrack?: (product: ProductSummary) => void;
  trackPending?: boolean;
  /**
   * Delivery to the selected destination, when one is selected.
   *
   * Nullable and defaulted to null, which is the entire compatibility strategy:
   * with null this card renders exactly what it rendered before the product knew
   * what a country was, so every existing card assertion still describes real
   * behaviour rather than a legacy branch nobody reaches.
   */
  delivery?: DeliveryToDestination | null;
  /** Required alongside `delivery`; see `DeliveryDetails`. */
  displayCurrency?: Currency | null;
  /** A fictional retailer. Disclosed on the card, never only in a tooltip. */
  isDemoStore?: boolean;
}

export function ProductCard({
  product,
  onTrack,
  trackPending = false,
  delivery = null,
  displayCurrency = null,
  isDemoStore = false,
}: ProductCardProps) {
  const discountLabel = formatDiscount(product.discountPercent);
  const untrustworthy = !product.dealQuality.claimedDiscountTrustworthy;
  const outOfStock = product.availability === 'OUT_OF_STOCK';

  /*
    The destination follows the click, for the reason given in GroupedProductCard:
    a URL-only destination has nothing in storage to fall back on, so dropping it
    here would answer the detail page for the wrong country.
  */
  const detailsTo = destinationPath(`/products/${product.id}`, delivery ? { country: delivery.destinationCountry, currency: displayCurrency ?? 'EUR' } : null);

  return (
    <article className="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-shadow duration-150 hover:shadow-raised">
      <Link
        to={detailsTo}
        className="group relative block bg-surface-muted"
        aria-label={`View details for ${product.name}`}
      >
        <ProductImage src={product.imageUrl} alt={product.name} />

        {discountLabel && (
          <span
            className={cn(
              'absolute top-3 left-3 rounded-md px-2 py-1 text-xs font-bold tabular',
              untrustworthy ? 'bg-warn-800 text-white' : 'bg-accent-700 text-white',
            )}
          >
            {discountLabel}
          </span>
        )}

        {untrustworthy && (
          <span
            className="absolute top-3 right-3 flex size-6 items-center justify-center rounded-full bg-warn-50 text-warn-800 ring-1 ring-warn-200"
            title="This discount does not match our price records"
          >
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            <span className="sr-only">This discount does not match our price records</span>
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium text-ink-500">{product.store.name}</span>
          <span
            className={cn(
              'shrink-0 text-xs',
              outOfStock ? 'font-medium text-rise-700' : 'text-ink-500',
            )}
          >
            {formatAvailability(product.availability)}
          </span>
        </div>

        <h3 className="text-sm leading-snug font-semibold">
          <Link to={detailsTo} className="hover:text-accent-700">
            {product.name}
          </Link>
        </h3>

        <div className="mt-auto flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {/*
              A stable test hook. The E2E suite asserts sort ordering by reading
              prices, and keying that off a utility class silently scooped up the
              discount badge (which is also tabular) and produced nonsense.
            */}
            <span
              data-testid="current-price"
              data-price={product.currentPrice}
              className="text-xl font-bold tabular tracking-tight"
            >
              {formatMoney(product.currentPrice, product.currency)}
            </span>
            {product.originalPrice != null && product.discountPercent > 0 && (
              <span className="text-sm text-ink-400 line-through tabular">
                {formatMoney(product.originalPrice, product.currency)}
              </span>
            )}
          </div>

          <span className="text-xs text-ink-500">
            {product.shippingPrice == null
              ? 'Delivery cost not listed'
              : product.shippingPrice === 0
                ? 'Free delivery'
                : `+ ${formatMoney(product.shippingPrice, product.currency)} delivery · ${formatMoney(product.effectivePrice, product.currency)} total`}
          </span>
        </div>

        {/*
          The destination block sits below the store's own price rather than
          replacing it. Both numbers matter and they answer different questions —
          "what does this shop charge" and "what would it cost me, here" — and
          collapsing them would hide the very gap this feature exists to show.
        */}
        {delivery && displayCurrency && (
          <div className="border-t border-line pt-3">
            <DeliveryDetails
              delivery={delivery}
              displayCurrency={displayCurrency}
              isDemoStore={isDemoStore}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <DealQualityInline product={product} />
        </div>

        <p className="text-xs text-ink-400">
          Checked {formatRelativeTime(product.lastCheckedAt)}
        </p>

        <div className="flex gap-2 pt-1">
          {/*
            A real anchor, not a button with an onClick: this navigates to
            another site, so it must be middle-clickable, copyable and
            announced as a link. rel="noreferrer" keeps our URL out of the
            store's referrer logs.
          */}
          <a
            href={product.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-ink-900 transition-colors hover:bg-surface-muted"
          >
            View deal
            <ExternalLink className="size-3.5" aria-hidden="true" />
            <span className="sr-only">(opens {product.store.name} in a new tab)</span>
          </a>

          {onTrack && (
            <Button
              variant={product.isTracked ? 'ghost' : 'primary'}
              size="sm"
              className="flex-1"
              loading={trackPending}
              disabled={product.isTracked}
              onClick={() => onTrack(product)}
              leadingIcon={
                product.isTracked ? (
                  <BookmarkCheck className="size-3.5" aria-hidden="true" />
                ) : (
                  <Bookmark className="size-3.5" aria-hidden="true" />
                )
              }
            >
              {product.isTracked ? 'Tracking' : 'Track price'}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

/** Badge plus its one-line justification, which is what makes it trustworthy. */
function DealQualityInline({ product }: { product: ProductSummary }) {
  const { dealQuality } = product;
  const tone =
    dealQuality.label === 'EXCELLENT'
      ? 'drop'
      : dealQuality.label === 'GOOD'
        ? 'accent'
        : dealQuality.label === 'PRICE_INCREASED'
          ? 'rise'
          : 'neutral';

  const text =
    dealQuality.label === 'EXCELLENT'
      ? 'Excellent deal'
      : dealQuality.label === 'GOOD'
        ? 'Good deal'
        : dealQuality.label === 'PRICE_INCREASED'
          ? 'Price increased'
          : 'Average price';

  return (
    <>
      <Badge tone={tone}>{text}</Badge>
      <span className="text-xs text-ink-500">{dealQuality.headline}</span>
    </>
  );
}

/**
 * Product image with a graceful fallback.
 *
 * Sample images are local SVGs, but a live provider's CDN URL can 404 or be
 * blocked. A broken-image icon is never acceptable, so failures fall back to a
 * neutral placeholder.
 */
function ProductImage({ src, alt }: { src: string | null; alt: string }) {
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
