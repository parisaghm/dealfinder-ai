import { countryName, formatMoney, humanise, type OfferSort } from '@deal-finder/shared';
import { Badge, Card, ErrorState, SectionHeading, Skeleton } from '@deal-finder/ui';
import { ArrowLeft, ImageOff, Store } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { DeliveredComparisonTable } from '../components/deals/DeliveredComparisonTable';
import { OfferComparisonTable } from '../components/deals/OfferComparisonTable';
import { CrossStorePriceChart } from '../components/product/CrossStorePriceChart';
import {
  DestinationPriceChart,
  type DeliveredStoreSeries,
} from '../components/product/DestinationPriceChart';
import { MatchExplanationPanel } from '../components/product/MatchExplanationPanel';
import { DestinationSummary } from '../components/layout/DestinationControls';
import {
  buildCompareParams,
  paramsToOfferSort,
  paramsToVisibleStores,
} from '../lib/compare-params';
import { applyDestinationToParams, useActiveDestination } from '../lib/destination';
import {
  useCanonicalHistory,
  useCanonicalOffers,
  useCanonicalProduct,
  useDestinationHistories,
  useProductOffers,
} from '../lib/queries';

const HISTORY_DAYS = 90;

/**
 * One product, every store that sells it.
 *
 * Ordered the way `ProductDetailsPage` is — identity, then the answer, then the
 * evidence, then the caveats — because a reader who stops after the first
 * screen should still have been told the thing they came for: which shop is
 * cheapest once delivery is counted.
 */
export function CompareProductPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const sort = paramsToOfferSort(searchParams);
  const product = useCanonicalProduct(id);
  const offers = useCanonicalOffers(id, sort);
  const history = useCanonicalHistory(id, HISTORY_DAYS);

  const destination = useActiveDestination();

  /**
   * Destination offers for this product group.
   *
   * Keyed on any one member listing: the API resolves the whole canonical group
   * from it, so one request covers every store rather than one per offer. Disabled
   * entirely when no destination is selected, so the pre-expansion page issues
   * exactly the requests it always did.
   */
  const destinationOffers = useProductOffers(
    destination ? offers.data?.offers[0]?.id : undefined,
    destination,
  );

  /**
   * One delivered-price series per store.
   *
   * The history endpoint answers per *listing* — one offer per destination — so a
   * chart with a line per store needs one request per listing. The listings come
   * from the offers already loaded above, so no extra lookup is needed to find
   * them, and each response is cached under the same key the product detail page
   * uses.
   */
  const listingIds = useMemo(
    () => (destination ? (offers.data?.offers ?? []).map((offer) => offer.id) : []),
    [destination, offers.data],
  );
  const destinationHistories = useDestinationHistories(listingIds, destination, HISTORY_DAYS);

  const deliveredSeries = useMemo<DeliveredStoreSeries[]>(() => {
    if (!destination) return [];
    const offerList = offers.data?.offers ?? [];

    return destinationHistories
      .map((result, index): DeliveredStoreSeries | null => {
        const offer = offerList[index];
        if (!offer || !result.data) return null;
        return {
          storeSlug: offer.store.slug,
          storeName: offer.store.name,
          hasDestinationOffer: result.data.hasDestinationOffer,
          currency: result.data.currency,
          points: result.data.points,
        };
      })
      .filter((entry): entry is DeliveredStoreSeries => entry !== null);
  }, [destination, destinationHistories, offers.data]);

  const allStoreSlugs = useMemo(
    () => (history.data?.series ?? []).map((entry) => entry.storeSlug),
    [history.data],
  );
  const deliveredStoreSlugs = useMemo(
    () => deliveredSeries.filter((entry) => entry.hasDestinationOffer).map((entry) => entry.storeSlug),
    [deliveredSeries],
  );
  const visibleStores = paramsToVisibleStores(searchParams, allStoreSlugs);
  const visibleDeliveredStores = paramsToVisibleStores(searchParams, deliveredStoreSlugs);

  if (product.isPending) return <CompareSkeleton />;

  if (product.isError || !product.data) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <ErrorState
          title="We could not load this comparison"
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
  const offerData = offers.data ?? { offers: data.offers, comparison: data.comparison };
  const comparison = offerData.comparison;

  const cheapest = offerData.offers.find(
    (offer) => offer.id === comparison.cheapestTotalOfferId,
  );

  /**
   * `buildCompareParams` returns a *fresh* query string, so anything not rebuilt
   * is dropped. The destination has to be re-applied or changing the sort would
   * silently strip `country` from a link the user may be about to share — and the
   * page would fall back to the stored choice, which is not the same promise.
   */
  const withDestination = (params: URLSearchParams) =>
    destination ? applyDestinationToParams(params, destination) : params;

  /** The slug universe the visibility param is relative to, for this mode. */
  const chartSlugs = destination ? deliveredStoreSlugs : allStoreSlugs;

  const setSort = (next: OfferSort) => {
    setSearchParams(
      withDestination(
        buildCompareParams({ sort: next, visibleStores, allStoreSlugs: chartSlugs }),
      ),
      { replace: false },
    );
  };

  const setVisibleStores = (slugs: string[]) => {
    // `replace` because toggling a chart series is not navigation — filling the
    // back stack with it would make the browser's back button useless here.
    setSearchParams(
      withDestination(buildCompareParams({ sort, visibleStores: slugs, allStoreSlugs: chartSlugs })),
      { replace: true },
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <BackLink />

      {/* ── Identity and the answer ───────────────────────────────────────── */}
      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:gap-6">
          <div className="flex w-full shrink-0 items-center justify-center rounded-lg bg-surface-muted sm:size-44">
            {data.imageUrl ? (
              <img src={data.imageUrl} alt={data.name} className="max-h-44 object-contain p-4" />
            ) : (
              <ImageOff className="size-8 text-ink-400" aria-hidden="true" />
            )}
          </div>

          <div className="flex flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral" icon={<Store className="size-3" aria-hidden="true" />}>
                {data.storeCount} {data.storeCount === 1 ? 'store' : 'stores'}
              </Badge>
              <Badge tone="muted">{humanise(data.category)}</Badge>
              {data.brand && <Badge tone="muted">{data.brand}</Badge>}
            </div>

            <h1 className="text-xl leading-snug font-bold sm:text-2xl">{data.name}</h1>

            {/*
              The destination is stated next to the title, because every number
              below it is destination-specific and a delivered total with no
              destination attached is not a figure anyone can act on.
            */}
            {destination && (
              <DestinationSummary
                country={destination.country}
                currency={destination.currency}
                className="text-sm"
              />
            )}

            {cheapest ? (
              <p className="text-lg font-semibold">
                Cheapest total{' '}
                <span className="tabular text-accent-800">
                  {formatMoney(cheapest.totalPrice ?? cheapest.currentPrice, data.currency)}
                </span>{' '}
                at {cheapest.store.name}
              </p>
            ) : (
              <p className="text-sm text-ink-500">
                No offer currently publishes both a price and a delivery cost, so no total can be
                compared.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile
                label="Cross-store low"
                value={
                  history.data?.crossStoreLow
                    ? formatMoney(history.data.crossStoreLow.price, data.currency)
                    : '—'
                }
                hint={history.data?.crossStoreLow?.storeName}
              />
              <StatTile
                label="Current cheapest"
                value={
                  comparison.lowestTotalPrice != null
                    ? formatMoney(comparison.lowestTotalPrice, data.currency)
                    : '—'
                }
                hint="delivery included"
              />
              <StatTile
                label="Current spread"
                value={
                  comparison.priceSpread != null
                    ? formatMoney(comparison.priceSpread, data.currency)
                    : '—'
                }
                hint={
                  comparison.priceSpreadPercent != null
                    ? `${Math.round(comparison.priceSpreadPercent)}% between stores`
                    : undefined
                }
              />
            </div>
          </div>
        </div>
      </Card>

      {/* ── The comparison ────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        {destination && destinationOffers.data ? (
          <>
            <SectionHeading
              title={`Compare delivered totals to ${countryName(destination.country)}`}
              description="Each total is the product price plus delivery to your destination, with tax and any import charges stated. The cheapest row is chosen by that total, not by the shelf price."
            />
            <DeliveredComparisonTable
              offers={destinationOffers.data.offers}
              unavailableHere={destinationOffers.data.unavailableHere}
              comparison={destinationOffers.data.comparison}
              country={destination.country}
              currency={destination.currency}
            />
          </>
        ) : (
          <>
            <SectionHeading
              title="Compare offers"
              description="Total price includes delivery, which is what the cheapest row is chosen by."
            />
            <OfferComparisonTable
              offers={offerData.offers}
              currency={data.currency}
              productName={data.name}
              sort={sort}
              onSortChange={setSort}
              comparison={comparison}
            />
          </>
        )}
      </section>

      {/* ── The evidence ──────────────────────────────────────────────────── */}
      <Card className="flex flex-col gap-4">
        {destination ? (
          /*
            A different series, not a relabelled one: `StoreOfferPriceHistory`
            records the delivered total per destination, while the chart below it
            records shelf prices with no destination at all. Substituting one for
            the other would present a sticker price as a doorstep price.
          */
          destinationHistories.some((result) => result.isPending) ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <DestinationPriceChart
              series={deliveredSeries}
              country={destination.country}
              displayCurrency={destination.currency}
              visibleStoreSlugs={visibleDeliveredStores}
              onVisibleStoresChange={setVisibleStores}
            />
          )
        ) : (
          <>
            <SectionHeading
              title="Price history across stores"
              description="What each store has charged while we have been tracking this product."
            />
            {history.isPending ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <CrossStorePriceChart
                series={history.data?.series ?? []}
                currency={data.currency}
                visibleStoreSlugs={visibleStores}
                onVisibleStoresChange={setVisibleStores}
                crossStoreLow={history.data?.crossStoreLow?.price ?? null}
              />
            )}
          </>
        )}
      </Card>

      {Object.keys(data.specifications).length > 0 && (
        <Card className="flex flex-col gap-3">
          <SectionHeading title="Specifications" />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {Object.entries(data.specifications).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 border-b border-line py-1.5">
                <dt className="text-ink-500">{label}</dt>
                <dd className="text-right font-medium text-ink-900">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {/* ── The caveats ───────────────────────────────────────────────────── */}
      <MatchExplanationPanel
        score={bestMatchScore(data.offers)}
        confidence={data.matchConfidence}
        reasons={matchReasonsFrom(data.offers)}
        conflicts={[]}
        identifiers={data.identifiers}
        variantNotes={data.variantNotes}
      />

      {data.pendingCandidateCount > 0 && (
        <p className="text-xs text-ink-500">
          {data.pendingCandidateCount} further{' '}
          {data.pendingCandidateCount === 1 ? 'listing is' : 'listings are'} awaiting review for
          this product and {data.pendingCandidateCount === 1 ? 'is' : 'are'} not shown above.
        </p>
      )}
    </div>
  );
}

function bestMatchScore(offers: readonly { match: { score: number | null } }[]): number {
  return offers.reduce((best, offer) => Math.max(best, offer.match.score ?? 0), 0);
}

/**
 * One reason per distinct grouping method.
 *
 * Deduplicated because three offers matched on the same EAN is one fact, not
 * three; repeating it would pad the panel and make it read as advocacy.
 */
function matchReasonsFrom(
  offers: readonly { store: { name: string }; match: { method: string | null; explanation: string | null } }[],
) {
  const byMethod = new Map<string, { stores: string[]; detail: string }>();

  for (const offer of offers) {
    if (!offer.match.method || !offer.match.explanation) continue;
    const entry = byMethod.get(offer.match.method) ?? {
      stores: [],
      detail: offer.match.explanation,
    };
    entry.stores.push(offer.store.name);
    byMethod.set(offer.match.method, entry);
  }

  return [...byMethod.entries()].map(([method, entry]) => ({
    key: `method:${method}`,
    label: `${entry.stores.join(', ')}`,
    detail: entry.detail,
    weight: 0,
    score: null,
  }));
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

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-surface-muted p-3">
      <span className="text-xs text-ink-500">{label}</span>
      <span className="text-base font-semibold tabular">{value}</span>
      {hint && <span className="text-xs text-ink-400">{hint}</span>}
    </div>
  );
}

function CompareSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-4 w-28" />
      <Card>
        <div className="flex flex-col gap-5 sm:flex-row">
          <Skeleton className="size-44 shrink-0 rounded-lg" />
          <div className="flex flex-1 flex-col gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      </Card>
      <Card>
        <Skeleton className="mb-4 h-4 w-32" />
        <Skeleton className="h-48 w-full" />
      </Card>
    </div>
  );
}
