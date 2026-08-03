import { formatMoney, type DealGrouping } from '@deal-finder/shared';
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
import { GroupedProductCard } from '../components/deals/GroupedProductCard';
import { ProductCard } from '../components/deals/ProductCard';
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

  const query = paramsToDealsQuery(searchParams, PAGE_SIZE);
  const filters = paramsToFilterValues(searchParams);
  const sort = paramsToSort(searchParams);
  const grouping = paramsToGrouping(searchParams);
  const page = query.page ?? 1;

  // Requesting page N returns N × PAGE_SIZE rows so "load more" keeps earlier
  // results on screen without holding a growing array in component state,
  // which would desynchronise from the URL on navigation.
  const deals = useDeals({ ...query, page: 1, limit: page * PAGE_SIZE });

  const updateParams = (next: URLSearchParams) => {
    setSearchParams(next, { replace: false });
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
        </div>

        <div className="flex items-center gap-2">
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
                    trackPending={
                      addToWatchlist.isPending &&
                      addToWatchlist.variables?.productId === group.canonical.bestOffer?.id
                    }
                    onTrackBest={(offer) =>
                      addToWatchlist.mutate({ productId: offer.id, alertsEnabled: true })
                    }
                  />
                ))}
                {ungroupedItems.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    trackPending={
                      addToWatchlist.isPending && addToWatchlist.variables?.productId === product.id
                    }
                    onTrack={(target) =>
                      addToWatchlist.mutate({ productId: target.id, alertsEnabled: true })
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
          />
        </FilterDrawer>
      )}
    </div>
  );
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
