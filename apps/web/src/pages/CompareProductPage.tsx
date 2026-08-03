import { formatMoney, humanise, type OfferSort } from '@deal-finder/shared';
import { Badge, Card, ErrorState, SectionHeading, Skeleton } from '@deal-finder/ui';
import { ArrowLeft, ImageOff, Store } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { OfferComparisonTable } from '../components/deals/OfferComparisonTable';
import { CrossStorePriceChart } from '../components/product/CrossStorePriceChart';
import { MatchExplanationPanel } from '../components/product/MatchExplanationPanel';
import {
  buildCompareParams,
  paramsToOfferSort,
  paramsToVisibleStores,
} from '../lib/compare-params';
import { useCanonicalHistory, useCanonicalOffers, useCanonicalProduct } from '../lib/queries';

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

  const allStoreSlugs = useMemo(
    () => (history.data?.series ?? []).map((entry) => entry.storeSlug),
    [history.data],
  );
  const visibleStores = paramsToVisibleStores(searchParams, allStoreSlugs);

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

  const setSort = (next: OfferSort) => {
    setSearchParams(buildCompareParams({ sort: next, visibleStores, allStoreSlugs }), {
      replace: false,
    });
  };

  const setVisibleStores = (slugs: string[]) => {
    // `replace` because toggling a chart series is not navigation — filling the
    // back stack with it would make the browser's back button useless here.
    setSearchParams(buildCompareParams({ sort, visibleStores: slugs, allStoreSlugs }), {
      replace: true,
    });
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
      </section>

      {/* ── The evidence ──────────────────────────────────────────────────── */}
      <Card className="flex flex-col gap-4">
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
