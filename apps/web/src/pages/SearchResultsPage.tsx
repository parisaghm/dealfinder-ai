import {
  DEAL_SORT_OPTIONS,
  formatMoney,
  type CountryCode,
  type Currency,
  type DealGrouping,
  type DestinationProductSummary,
} from '@deal-finder/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingIndicator,
  ProductCardSkeleton,
  SegmentedControl,
} from '@deal-finder/ui';
import { BookmarkPlus, SearchX, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilterPanel, SortSelect, type FilterValues } from '../components/deals/FilterPanel';
import {
  GroupedProductCard,
  type GroupDestinationSummary,
} from '../components/deals/GroupedProductCard';
import { ProductCard } from '../components/deals/ProductCard';
import { DestinationSummary } from '../components/layout/DestinationControls';
import { applyDestinationToParams, useActiveDestination } from '../lib/destination';
import { useAddToWatchlist, useCreateSavedSearch, useDeals, useMeta } from '../lib/queries';
import {
  buildSearchParams,
  paramsToDealsQuery,
  paramsToFilterValues,
  paramsToGrouping,
  paramsToSort,
} from '../lib/search-params';

const PAGE_SIZE = 12;

/**
 * Search results.
 *
 * All state is derived from the URL, so the browser's back button, a shared
 * link and a refresh all behave. "Load more" accumulates pages by requesting
 * successive pages and appending — the URL keeps the page count so returning to
 * the page restores what the user had loaded.
 */
export function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: meta } = useMeta();

  const addToWatchlist = useAddToWatchlist();
  const createSavedSearch = useCreateSavedSearch();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  /**
   * The active destination, or null.
   *
   * Null is what keeps this page's legacy behaviour intact: `paramsToDealsQuery`
   * then adds no destination fields, the API takes its legacy path, and every
   * card receives `null` and renders as it always did.
   */
  const destination = useActiveDestination();

  const query = paramsToDealsQuery(searchParams, PAGE_SIZE, destination);
  const filters = paramsToFilterValues(searchParams);
  const sort = paramsToSort(searchParams);
  const grouping = paramsToGrouping(searchParams);
  const page = query.page ?? 1;

  // Requesting page N returns N × PAGE_SIZE rows so "load more" keeps earlier
  // results on screen without holding a growing array in component state,
  // which would desynchronise from the URL on navigation.
  const deals = useDeals({ ...query, page: 1, limit: page * PAGE_SIZE });

  /**
   * Re-attach the destination to a freshly built parameter set.
   *
   * `buildSearchParams` constructs a new `URLSearchParams` from the filter form,
   * so on its own it would silently drop `country`, `currency` and `region` every
   * time a filter, sort or grouping changed — the user's destination would
   * evaporate on their next click. The destination is owned by the provider, so it
   * is re-applied through the provider's own helper rather than copied by hand.
   */
  const withDestination = (next: URLSearchParams): URLSearchParams =>
    destination ? applyDestinationToParams(next, destination) : next;

  const updateParams = (next: URLSearchParams) => {
    setSearchParams(withDestination(next), { replace: false });
  };

  const applyFilters = (values: FilterValues) => {
    updateParams(
      buildSearchParams({
        query: searchParams.get('query') ?? '',
        ...values,
        sort,
        group: grouping,
      }),
    );
    setDrawerOpen(false);
  };

  const clearFilters = () => {
    const next = new URLSearchParams();
    const text = searchParams.get('query');
    if (text) next.set('query', text);
    if (grouping !== 'none') next.set('group', grouping);
    // Clearing *filters* must not clear the destination: they are different
    // decisions, and one button should undo only the one it names.
    updateParams(next);
    setDrawerOpen(false);
  };

  const items = deals.data?.items ?? [];
  const pagination = deals.data?.pagination;
  const applied = deals.data?.appliedFilters;

  // In grouped mode the page is unchanged; the response simply also says which
  // of its products turned out to be the same thing. Anything in no group is
  // still rendered as an ordinary card, so nothing silently disappears.
  const groups = deals.data?.groups ?? [];
  const groupedProductIds = new Set(groups.flatMap((group) => group.productIds));
  const ungroupedItems =
    grouping === 'canonical' ? items.filter((item) => !groupedProductIds.has(item.id)) : items;

  /**
   * Destination facts per group, aggregated from the offers already on the page.
   *
   * No extra request: a grouped card decorates a page that has already been
   * selected and ordered, and one request per group would be an N+1 on the most
   * frequently rendered component in the product.
   */
  const destinationByGroup = new Map<string, GroupDestinationSummary>();
  if (destination) {
    for (const group of groups) {
      const groupItems = items.filter((item) => group.productIds.includes(item.id));
      destinationByGroup.set(
        group.canonicalProductId,
        summariseGroupDestination(groupItems, group.canonical.storeCount, destination),
      );
    }
  }

  // Announce result counts to screen readers when they change.
  const resultSummary = pagination
    ? grouping === 'canonical'
      ? `${pagination.total} ${pagination.total === 1 ? 'offer' : 'offers'} found across ${groups.length + ungroupedItems.length} ${groups.length + ungroupedItems.length === 1 ? 'product' : 'products'}`
      : `${pagination.total} ${pagination.total === 1 ? 'deal' : 'deals'} found`
    : '';

  return (
    <div className="flex flex-col gap-6">
      <SearchHeader
        initialQuery={searchParams.get('query') ?? ''}
        onSearch={(text) => {
          const next = buildSearchParams({ ...filters, query: text, sort, group: grouping });
          updateParams(next);
        }}
      />

      {/* ── Summary row ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-ink-700" role="status" aria-live="polite">
            {deals.isPending ? 'Searching…' : resultSummary}
          </p>

          {/*
            The destination is named on the results page itself, not only in the
            header. A delivered total with no destination attached to it is not a
            number anyone can act on.
          */}
          {destination && (
            <DestinationSummary country={destination.country} currency={destination.currency} />
          )}

          {applied && (applied.interpretation.length > 0 || hasActiveFilters(applied)) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {applied.interpretation.map((note) => (
                <Badge key={note} tone="accent">
                  {note}
                </Badge>
              ))}
              {applied.query && <Badge tone="muted">Text: “{applied.query}”</Badge>}
              {applied.maximumPrice != null && applied.interpretation.length === 0 && (
                <Badge tone="muted">Max {formatMoney(applied.maximumPrice)}</Badge>
              )}
              {applied.stores.length > 0 && (
                <Badge tone="muted">
                  {applied.stores.length === 1 ? applied.stores[0] : `${applied.stores.length} stores`}
                </Badge>
              )}
            </div>
          )}

          {/*
            What the destination filters removed, stated rather than applied
            silently. An offer that vanishes without explanation reads as an offer
            that does not exist, which is a different and false claim.
          */}
          {applied?.destination && (
            <div className="flex flex-wrap items-center gap-1.5">
              {applied.destination.excludedNotShipping > 0 && (
                <Badge tone="warn">
                  {applied.destination.excludedNotShipping}{' '}
                  {applied.destination.excludedNotShipping === 1 ? 'product' : 'products'} cannot be
                  delivered to {applied.destination.countryName}
                </Badge>
              )}
              {applied.destination.excludedUnknownShipping > 0 && (
                <Badge tone="warn">
                  {applied.destination.excludedUnknownShipping} hidden for unknown delivery cost
                </Badge>
              )}
            </div>
          )}
        </div>

        {/*
          `flex-wrap`, because at 320px the view toggle and the sort select
          together are wider than the viewport and would otherwise scroll the
          whole page sideways rather than stacking.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="lg:hidden"
            onClick={() => setDrawerOpen(true)}
            leadingIcon={<SlidersHorizontal className="size-4" aria-hidden="true" />}
            aria-expanded={drawerOpen}
          >
            Filters
          </Button>

          {/*
            Grouping and sorting are both "how the result set is shaped", so
            they live in one control cluster. A segmented control rather than a
            checkbox: a checkbox reads as a filter and hides what the other
            state even is.
          */}
          <SegmentedControl
            legend="Result view"
            hideLegend
            name="result-view"
            value={grouping}
            options={[
              { value: 'none', label: 'Individual offers' },
              { value: 'canonical', label: 'Grouped by product' },
            ]}
            onChange={(next: DealGrouping) =>
              updateParams(
                buildSearchParams({
                  ...filters,
                  query: searchParams.get('query') ?? '',
                  sort,
                  group: next,
                }),
              )
            }
          />

          <SortSelect
            value={sort}
            // `lowest-delivered` is offered only when there is a destination to
            // deliver to. Without one it would have nothing to sort on, and a
            // sort option that cannot do what its name says is worse than none.
            options={destination ? DEAL_SORT_OPTIONS : undefined}
            onChange={(next) =>
              updateParams(
                buildSearchParams({
                  ...filters,
                  query: searchParams.get('query') ?? '',
                  sort: next,
                  group: grouping,
                }),
              )
            }
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        {/* ── Sidebar (desktop) ──────────────────────────────────────────── */}
        <aside className="hidden lg:block">
          <Card className="sticky top-24">
            <FilterPanel
              meta={meta}
              values={filters}
              onApply={applyFilters}
              onClear={clearFilters}
              destination={destination}
            />
          </Card>

          <Button
            variant="ghost"
            size="sm"
            className="mt-3 w-full"
            leadingIcon={<BookmarkPlus className="size-4" aria-hidden="true" />}
            loading={createSavedSearch.isPending}
            onClick={() => {
              createSavedSearch.mutate(
                {
                  name: describeSearch(searchParams),
                  query: searchParams.get('query') || null,
                  maximumPrice: filters.maximumPrice ? Number(filters.maximumPrice) : null,
                  minimumDiscount: filters.minimumDiscount ? Number(filters.minimumDiscount) : null,
                  category: filters.category || null,
                  stores: filters.stores,
                },
                {
                  onSuccess: () => setSavedNotice('Search saved to your dashboard.'),
                  onError: (error) =>
                    setSavedNotice(error instanceof Error ? error.message : 'Could not save search.'),
                },
              );
            }}
          >
            Save this search
          </Button>
          {savedNotice && (
            <p className="mt-2 text-xs text-ink-500" role="status">
              {savedNotice}
            </p>
          )}
        </aside>

        {/* ── Results ────────────────────────────────────────────────────── */}
        <section aria-label="Search results">
          {deals.isPending && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => (
                <ProductCardSkeleton key={index} />
              ))}
            </div>
          )}

          {deals.isError && (
            <ErrorState
              message={
                deals.error instanceof Error
                  ? deals.error.message
                  : 'We could not run that search just now.'
              }
              onRetry={() => void deals.refetch()}
            />
          )}

          {deals.data && items.length === 0 && (
            <EmptyState
              icon={<SearchX className="size-8" aria-hidden="true" />}
              title="No deals match these filters"
              description="Try widening the price range, lowering the minimum discount, or removing a store."
              action={
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          )}

          {items.length > 0 && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {groups.map((group) => (
                  <GroupedProductCard
                    key={group.canonicalProductId}
                    group={group.canonical}
                    destination={destinationByGroup.get(group.canonicalProductId) ?? null}
                    trackPending={
                      addToWatchlist.isPending &&
                      addToWatchlist.variables?.productId === group.canonical.bestOffer?.id
                    }
                    onTrackBest={(offer) =>
                      addToWatchlist.mutate({
                        productId: offer.id,
                        alertsEnabled: true,
                        // A tracked target belongs to a destination. Sending the
                        // selected one means "notify me about getting it *here*",
                        // which is the only question the user actually asked.
                        ...(destination
                          ? {
                              destinationCountry: destination.country,
                              preferredCurrency: destination.currency,
                            }
                          : {}),
                      })
                    }
                  />
                ))}
                {ungroupedItems.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    delivery={product.destinationOffer ?? null}
                    displayCurrency={destination?.currency ?? null}
                    isDemoStore={product.isDemoStore ?? false}
                    trackPending={
                      addToWatchlist.isPending && addToWatchlist.variables?.productId === product.id
                    }
                    onTrack={(target) =>
                      addToWatchlist.mutate({
                        productId: target.id,
                        alertsEnabled: true,
                        ...(destination
                          ? {
                              destinationCountry: destination.country,
                              preferredCurrency: destination.currency,
                            }
                          : {}),
                      })
                    }
                  />
                ))}
              </div>

              {deals.isFetching && <LoadingIndicator label="Loading more deals" />}

              {pagination?.hasMore && !deals.isFetching && (
                <div className="mt-6 flex justify-center">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const next = new URLSearchParams(searchParams);
                      next.set('page', String(page + 1));
                      updateParams(next);
                    }}
                  >
                    Load more ({pagination.total - items.length} remaining)
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* ── Filter drawer (mobile) ───────────────────────────────────────── */}
      {drawerOpen && (
        <FilterDrawer onClose={() => setDrawerOpen(false)}>
          <FilterPanel
            meta={meta}
            values={filters}
            onApply={applyFilters}
            onClear={clearFilters}
            onClose={() => setDrawerOpen(false)}
            destination={destination}
          />
        </FilterDrawer>
      )}
    </div>
  );
}

/**
 * Aggregate one group's destination facts from the offers on this page.
 *
 * Deliberately counts `storesShipping` from offers that carry
 * `shipsToDestination`, never from any store's declared delivery list: a store
 * can declare a country and still have no offer for this particular product
 * there, and repeating the declaration as a delivery promise is the one claim
 * this feature must never make.
 *
 * `storesTotal` is the group's full store count from the canonical record, so
 * "4 of 7" compares against every store that sells the thing rather than only
 * those that happened to survive the destination filter.
 */
function summariseGroupDestination(
  groupItems: readonly DestinationProductSummary[],
  storesTotal: number,
  destination: { country: CountryCode; currency: Currency },
): GroupDestinationSummary {
  const offers = groupItems
    .map((item) => item.destinationOffer)
    .filter((offer): offer is NonNullable<typeof offer> => offer != null);

  const shippable = offers.filter((offer) => offer.shipsToDestination);

  const deliveredTotals = shippable
    .map((offer) => offer.totalDeliveredPrice)
    .filter((amount): amount is NonNullable<typeof amount> => amount != null);
  const listedPrices = shippable
    .map((offer) => offer.productPrice.converted)
    .filter((amount): amount is NonNullable<typeof amount> => amount != null);

  const lowestBy = <T extends { minorUnits: number }>(values: readonly T[]): T | null =>
    values.reduce<T | null>(
      (best, value) => (best == null || value.minorUnits < best.minorUnits ? value : best),
      null,
    );

  return {
    country: destination.country,
    currency: destination.currency,
    lowestDelivered: lowestBy(deliveredTotals),
    lowestListed: lowestBy(listedPrices),
    storesShipping: shippable.length,
    // Never report fewer stores in total than are shipping: the page can only
    // hold offers it was sent, and a stale canonical count must not produce
    // "5 of 3".
    storesTotal: Math.max(storesTotal, shippable.length),
    offersWithUnknownShipping: shippable.filter((offer) => offer.totalDeliveredPrice == null).length,
    hasDemoStore: groupItems.some((item) => item.isDemoStore === true),
  };
}

function hasActiveFilters(applied: {
  maximumPrice: number | null;
  minimumDiscount: number | null;
  category: string | null;
  stores: string[];
}): boolean {
  return (
    applied.maximumPrice != null ||
    applied.minimumDiscount != null ||
    applied.category != null ||
    applied.stores.length > 0
  );
}

function describeSearch(params: URLSearchParams): string {
  const parts: string[] = [];
  const text = params.get('query');
  if (text) parts.push(`“${text}”`);
  if (params.get('category')) parts.push(params.get('category')!);
  if (params.get('maximumPrice')) parts.push(`under €${params.get('maximumPrice')}`);
  if (params.get('minimumDiscount')) parts.push(`${params.get('minimumDiscount')}%+ off`);
  return parts.length > 0 ? parts.join(' · ') : 'All deals';
}

/** Search box at the top of the results page. */
function SearchHeader({
  initialQuery,
  onSearch,
}: {
  initialQuery: string;
  onSearch: (query: string) => void;
}) {
  const [text, setText] = useState(initialQuery);

  // Keep the box in step with the URL (back button, example-search links).
  useEffect(() => setText(initialQuery), [initialQuery]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(text.trim());
  };

  return (
    <form onSubmit={submit} role="search" className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Search deals</h1>
      <div className="flex gap-2">
        <Field label="Search deals" hideLabel className="flex-1">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="query"
              type="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Wireless headphones, laptop under €1,000…"
              enterKeyHint="search"
              autoComplete="off"
            />
          )}
        </Field>
        <Button type="submit">Search</Button>
      </div>
    </form>
  );
}

/**
 * Mobile filter drawer.
 *
 * Closes on Escape and on backdrop click, and locks background scrolling while
 * open — the minimum a modal surface owes a keyboard or touch user.
 */
function FilterDrawer({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        className="absolute inset-0 bg-ink-900/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        className="absolute inset-y-0 right-0 w-[min(20rem,90vw)] overflow-y-auto bg-surface p-5 shadow-raised"
      >
        {children}
      </div>
    </div>
  );
}
