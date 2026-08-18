import {
  formatDiscount,
  formatMoney,
  formatAvailability,
  formatRelativeTime,
  humanise,
} from '@deal-finder/shared';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  SectionHeading,
  Skeleton,
} from '@deal-finder/ui';
import { ArrowLeft, ArrowRight, ImageOff, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DealQualityBadge } from '../components/deals/DealQualityBadge';
import { DealCta, DemoOfferNotice } from '../components/deals/DealCta';
import { DemoStoreNotice } from '../components/deals/DeliveryDetails';
import { ProductCard } from '../components/deals/ProductCard';
import { DealQualityExplainer } from '../components/product/DealQualityExplainer';
import { PriceHistoryChart } from '../components/product/PriceHistoryChart';
import { TargetPriceForm } from '../components/product/TargetPriceForm';
import { DestinationSummary } from '../components/layout/DestinationControls';
import { useActiveDestination } from '../lib/destination';
import {
  useAddToWatchlist,
  useProduct,
  useProductOffers,
  useRemoveWatchlistItem,
  useUpdateWatchlistItem,
  useWatchlist,
} from '../lib/queries';

/**
 * Product details.
 *
 * Ordered by what the user came for: the price and whether it is genuinely
 * good, then the evidence (chart + statistics), then the action (target price),
 * then alternatives.
 */
export function ProductDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const product = useProduct(id);
  const watchlist = useWatchlist();

  const addToWatchlist = useAddToWatchlist();
  const updateItem = useUpdateWatchlistItem();
  const removeItem = useRemoveWatchlistItem();

  const [actionError, setActionError] = useState<string | null>(null);

  const destination = useActiveDestination();
  // Only for the delivered total this destination's target is measured against;
  // disabled entirely without a destination, so the legacy page fetches what it
  // always fetched.
  const destinationOffers = useProductOffers(destination ? id : undefined, destination);

  /**
   * The watchlist row for this product.
   *
   * Tracking identity includes destination and currency, so with a destination
   * selected the row for *that* destination is the one this form edits. Falling
   * back to any row would let a Finnish target be silently overwritten while the
   * user was looking at Germany.
   */
  const watchlistItem = destination
    ? (watchlist.data?.items.find(
        (item) =>
          item.productId === id &&
          item.destinationCountry === destination.country &&
          item.preferredCurrency === destination.currency,
      ) ?? null)
    : (watchlist.data?.items.find((item) => item.productId === id) ?? null);

  if (product.isPending) return <ProductSkeleton />;

  if (product.isError || !product.data) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <ErrorState
          title="We could not load this product"
          message={
            product.error instanceof Error
              ? product.error.message
              : 'The product may no longer exist.'
          }
          onRetry={() => void product.refetch()}
        />
      </div>
    );
  }

  const data = product.data;
  const discountLabel = formatDiscount(data.discountPercent);
  const stats = data.priceStatistics;

  /**
   * This listing's own delivered total for the selected destination.
   *
   * Matched on `productId` rather than taken from the head of the list: the
   * offers endpoint answers for the whole canonical group, and the cheapest of
   * those may well belong to a different shop than the one being viewed.
   */
  const deliveredPrice = destination
    ? (destinationOffers.data?.offers.find((offer) => offer.productId === data.id)?.delivery
        .totalDeliveredPrice?.major ?? null)
    : null;

  /**
   * Whether the retailer itself is fictional.
   *
   * Only knowable when a destination is selected, because that is the response
   * carrying `isDemoStore`. Absent, this stays false and the offer-level notice
   * below does the disclosing — which is the right fallback, since the claim that
   * matters here ("this price is sample data") is true either way.
   */
  const isDemoStore =
    destinationOffers.data?.offers.find((offer) => offer.productId === data.id)?.isDemoStore ??
    false;

  /**
   * Where the typed number lands.
   *
   * With a destination it is a delivered target; without one it is the list-price
   * target the form has always set. Deciding it here rather than inside the form
   * keeps the form's contract — and its existing tests — unchanged.
   */
  const handleTarget = (targetPrice: number | null) => {
    setActionError(null);
    const onError = (error: unknown) =>
      setActionError(error instanceof Error ? error.message : 'Something went wrong.');

    if (destination) {
      if (watchlistItem) {
        updateItem.mutate(
          { id: watchlistItem.id, input: { targetDeliveredPrice: targetPrice } },
          { onError },
        );
      } else {
        addToWatchlist.mutate(
          {
            productId: data.id,
            targetDeliveredPrice: targetPrice,
            destinationCountry: destination.country,
            preferredCurrency: destination.currency,
            alertsEnabled: true,
          },
          { onError },
        );
      }
      return;
    }

    if (watchlistItem) {
      updateItem.mutate({ id: watchlistItem.id, input: { targetPrice } }, { onError });
    } else {
      addToWatchlist.mutate(
        { productId: data.id, targetPrice, alertsEnabled: true },
        { onError },
      );
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <BackLink />

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-5">
          <Card padded={false} className="overflow-hidden">
            <div className="flex flex-col gap-5 p-5 sm:flex-row sm:gap-6">
              <div className="flex w-full shrink-0 items-center justify-center rounded-lg bg-surface-muted sm:size-44">
                {data.imageUrl ? (
                  <img
                    src={data.imageUrl}
                    alt={data.name}
                    className="max-h-44 object-contain p-4"
                  />
                ) : (
                  <ImageOff className="size-8 text-ink-400" aria-hidden="true" />
                )}
              </div>

              <div className="flex flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{data.store.name}</Badge>
                  <Badge tone="muted">{humanise(data.category)}</Badge>
                  {data.brand && <Badge tone="muted">{data.brand}</Badge>}
                </div>

                <h1 className="text-xl leading-snug font-bold sm:text-2xl">{data.name}</h1>

                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-3xl font-bold tabular tracking-tight">
                    {formatMoney(data.currentPrice, data.currency)}
                  </span>
                  {data.originalPrice != null && data.discountPercent > 0 && (
                    <>
                      <span className="text-base text-ink-400 line-through tabular">
                        {formatMoney(data.originalPrice, data.currency)}
                      </span>
                      {discountLabel && <Badge tone="accent" size="md">{discountLabel}</Badge>}
                    </>
                  )}
                </div>

                {/*
                  The discovery path a real shopper takes: they land on one
                  store's page from search, and only then wonder whether anyone
                  else sells it cheaper.
                */}
                {data.canonicalProductId && data.canonicalOfferCount > 1 && (
                  <Link
                    to={`/compare/${data.canonicalProductId}`}
                    className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-accent-50 px-3 py-1.5 text-xs font-semibold text-accent-800 hover:bg-accent-100"
                  >
                    Also sold by {data.canonicalOfferCount - 1} other{' '}
                    {data.canonicalOfferCount - 1 === 1 ? 'store' : 'stores'} — compare all offers
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                )}

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                  <MetaItem label="Availability" value={formatAvailability(data.availability)} />
                  <MetaItem
                    label="Delivery"
                    value={
                      data.shippingPrice == null
                        ? 'Not listed'
                        : data.shippingPrice === 0
                          ? 'Free'
                          : formatMoney(data.shippingPrice, data.currency)
                    }
                  />
                  <MetaItem
                    label="Total to receive"
                    value={formatMoney(data.effectivePrice, data.currency)}
                  />
                  <MetaItem label="Last checked" value={formatRelativeTime(data.lastCheckedAt)} />
                  <MetaItem label="Store" value={data.store.name} />
                  <MetaItem
                    label="Observations"
                    value={`${stats.sampleSize} recorded`}
                  />
                </dl>

                {/*
                  This page previously disclosed nothing at all, on any surface —
                  the loudest price in the app with no statement of where it came
                  from. Both notices are rendered: the store-level one when the
                  retailer is fictional, the offer-level one when the retailer is
                  real but its numbers here are not.
                */}
                {isDemoStore && <DemoStoreNotice />}
                <DemoOfferNotice
                  offer={data}
                  storeName={data.store.name}
                  isDemoStore={isDemoStore}
                />

                <div className="flex flex-wrap gap-2 pt-1">
                  {/*
                    No `internalTo`: this *is* the product's own page, so a demo
                    offer has nowhere to send anyone and renders a disabled control
                    rather than a link that goes back to here.
                  */}
                  <DealCta
                    offer={data}
                    storeName={data.store.name}
                    appearance="primary"
                    externalLabel={`View at ${data.store.name}`}
                  />

                  {watchlistItem && (
                    <Button
                      variant="danger"
                      loading={removeItem.isPending}
                      onClick={() => removeItem.mutate(watchlistItem.id)}
                      leadingIcon={<Trash2 className="size-4" aria-hidden="true" />}
                    >
                      Stop tracking
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {data.description && (
              <div className="border-t border-line bg-surface-muted/40 p-5">
                <p className="text-sm leading-relaxed text-ink-700">{data.description}</p>
              </div>
            )}
          </Card>

          {/* ── Price history ──────────────────────────────────────────────── */}
          <Card className="flex flex-col gap-4">
            <SectionHeading
              title="Price history"
              description="What this product has actually cost while we have been tracking it."
            />

            <div className="grid grid-cols-3 gap-3">
              <StatTile
                label="Lowest recorded"
                value={stats.lowest != null ? formatMoney(stats.lowest, data.currency) : '—'}
              />
              <StatTile
                label="Average recorded"
                value={stats.average != null ? formatMoney(stats.average, data.currency) : '—'}
              />
              <StatTile
                label="Highest recorded"
                value={stats.highest != null ? formatMoney(stats.highest, data.currency) : '—'}
              />
            </div>

            <PriceHistoryChart
              points={data.priceHistory}
              statistics={stats}
              currency={data.currency}
              targetPrice={watchlistItem?.targetPrice ?? null}
            />
          </Card>

          <DealQualityExplainer quality={data.dealQuality} />
        </div>

        {/* ── Tracking sidebar ─────────────────────────────────────────────── */}
        <aside className="flex flex-col gap-4">
          <Card className="flex flex-col gap-4 lg:sticky lg:top-24">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base">Track this price</h2>
              <DealQualityBadge quality={data.dealQuality} />
            </div>

            {watchlistItem?.targetComparison && (
              <div className="rounded-lg bg-surface-muted p-3 text-xs">
                {watchlistItem.targetComparison.reached ? (
                  <p className="font-semibold text-drop-700">
                    Your target of {formatMoney(watchlistItem.targetPrice ?? 0, data.currency)} has
                    been reached.
                  </p>
                ) : (
                  <p className="text-ink-700">
                    <span className="font-semibold tabular">
                      {formatMoney(watchlistItem.targetComparison.difference, data.currency)}
                    </span>{' '}
                    above your {formatMoney(watchlistItem.targetPrice ?? 0, data.currency)} target.
                  </p>
                )}
              </div>
            )}

            {destination && (
              <DestinationSummary
                country={destination.country}
                currency={destination.currency}
                className="text-xs"
              />
            )}

            <TargetPriceForm
              currency={data.currency}
              currentPrice={data.currentPrice}
              lowestPrice={stats.lowest}
              averagePrice={stats.average}
              // The delivered target when a destination is active, because that is
              // what the field then edits — showing the list-price target there
              // would pre-fill the wrong number into the wrong threshold.
              initialTarget={
                destination
                  ? (watchlistItem?.targetDeliveredPrice ?? null)
                  : (watchlistItem?.targetPrice ?? null)
              }
              isTracked={Boolean(watchlistItem)}
              pending={addToWatchlist.isPending || updateItem.isPending}
              onSubmit={handleTarget}
              error={actionError}
              destination={
                destination
                  ? {
                      country: destination.country,
                      currency: destination.currency,
                      deliveredPrice,
                    }
                  : null
              }
            />

            {watchlistItem && (
              <p className="border-t border-line pt-3 text-xs text-ink-500">
                Alerts are {watchlistItem.alertsEnabled ? 'active' : 'paused'}. Manage them on your{' '}
                <Link to="/watchlist" className="font-semibold text-accent-700 hover:underline">
                  watchlist
                </Link>
                .
              </p>
            )}
          </Card>
        </aside>
      </div>

      {/* ── Similar products ─────────────────────────────────────────────── */}
      {data.similarProducts.length > 0 && (
        <section className="flex flex-col gap-4">
          <SectionHeading
            title="Similar products"
            description={`Other ${humanise(data.category).toLowerCase()} at a comparable price.`}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.similarProducts.map((similar) => (
              <ProductCard
                key={similar.id}
                product={similar}
                onTrack={(target) =>
                  addToWatchlist.mutate({ productId: target.id, alertsEnabled: true })
                }
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/search"
      className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-accent-700"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to search
    </Link>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-ink-400">{label}</dt>
      <dd className="font-medium text-ink-700">{value}</dd>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-surface-muted p-3">
      <span className="text-xs text-ink-500">{label}</span>
      <span className="text-base font-semibold">{value}</span>
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-4 w-28" />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-5">
          <Card>
            <div className="flex flex-col gap-5 sm:flex-row">
              <Skeleton className="size-44 shrink-0 rounded-lg" />
              <div className="flex flex-1 flex-col gap-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-9 w-40" />
                <Skeleton className="h-16 w-full" />
              </div>
            </div>
          </Card>
          <Card>
            <Skeleton className="mb-4 h-4 w-32" />
            <Skeleton className="h-64 w-full" />
          </Card>
        </div>
        <Card>
          <Skeleton className="mb-4 h-4 w-32" />
          <Skeleton className="h-32 w-full" />
        </Card>
      </div>
    </div>
  );
}
