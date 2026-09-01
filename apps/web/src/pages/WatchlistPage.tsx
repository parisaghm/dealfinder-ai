import type {
  CreateWatchlistItemPayload,
  UpdateWatchlistItemInput,
} from '@deal-finder/shared';
import { Card, EmptyState, ErrorState, Skeleton } from '@deal-finder/ui';
import { BookmarkX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  WATCHLIST_COPY,
  WatchlistProductGroup,
  groupWatchlistByProduct,
  readTargetConflict,
  type WatchlistTargetConflict,
} from '../components/watchlist/WatchlistProductGroup';
import {
  useAddToWatchlist,
  useCountryOptions,
  useRemoveWatchlistItem,
  useStores,
  useUpdateWatchlistItem,
  useWatchlist,
} from '../lib/queries';

/**
 * Watchlist.
 *
 * Grouped by product rather than flat, because tracking identity is
 * `(user, product, destination, currency)` and one product therefore has as many
 * rows as the user has destinations for it. Four visually identical rows for the
 * same headphones read as a bug; four rows under one heading, each naming its
 * destination and currency, read as four deliberate targets.
 *
 * The page owns the mutations and the per-product error state; the group
 * component is presentational, which is what makes it testable without a query
 * client or a router-driven fetch.
 */
export function WatchlistPage() {
  const watchlist = useWatchlist();
  /**
   * Only to answer "is this a demo store?".
   *
   * `productSummarySchema.store` has no `isDemoStore` — it is the shape the legacy
   * `/api/deals` payload uses and must stay byte-identical — so the flag is looked
   * up from the stores endpoint, which does carry it, rather than being inferred
   * from a name or omitted. Cached, so this costs one request per session.
   */
  const stores = useStores(null, null);

  const addTarget = useAddToWatchlist();
  const updateItem = useUpdateWatchlistItem();
  const removeItem = useRemoveWatchlistItem();

  /** Keyed by product, because two groups can each be mid-conflict. */
  const [conflicts, setConflicts] = useState<Record<string, WatchlistTargetConflict | null>>({});
  const [confirmations, setConfirmations] = useState<Record<string, string | null>>({});

  const groups = useMemo(
    () => groupWatchlistByProduct(watchlist.data?.items ?? []),
    [watchlist.data],
  );

  const demoStoreSlugs = useMemo(
    () =>
      new Set(
        (stores.data?.items ?? []).filter((store) => store.isDemoStore).map((store) => store.slug),
      ),
    [stores.data],
  );

  // The static table is the same source the API mirrors, so the form is usable
  // before that request resolves rather than showing an empty select.
  const countryOptions = useCountryOptions();

  const handleAdd = (productId: string, input: CreateWatchlistItemPayload) => {
    setConflicts((current) => ({ ...current, [productId]: null }));
    setConfirmations((current) => ({ ...current, [productId]: null }));

    addTarget.mutate(input, {
      onSuccess: (item) =>
        setConfirmations((current) => ({
          ...current,
          [productId]: WATCHLIST_COPY.added(item.destinationCountryName, item.preferredCurrency),
        })),
      onError: (error) =>
        setConflicts((current) => ({
          ...current,
          // A 409 carries the existing item's id and is rendered with an offer to
          // update it; anything else is reported as itself.
          [productId]: readTargetConflict(error) ?? {
            message: error instanceof Error ? error.message : 'Could not add that target.',
            reason: null,
            existingItemId: null,
            existingCurrency: null,
            requestedCurrency: null,
          },
        })),
    });
  };

  const handleUpdate = (productId: string, id: string, input: UpdateWatchlistItemInput) => {
    setConflicts((current) => ({ ...current, [productId]: null }));
    updateItem.mutate(
      { id, input },
      {
        onSuccess: (item) =>
          setConfirmations((current) => ({
            ...current,
            [productId]: WATCHLIST_COPY.updated(
              item.destinationCountryName,
              item.preferredCurrency,
            ),
          })),
        onError: (error) =>
          setConflicts((current) => ({
            ...current,
            [productId]: {
              message: error instanceof Error ? error.message : 'Could not save that target.',
              reason: null,
              existingItemId: null,
              existingCurrency: null,
              requestedCurrency: null,
            },
          })),
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold">Watchlist</h1>
        <p className="text-sm text-ink-500">
          Products you are tracking, and where you want them delivered. We check them on a schedule
          and email you when a target is reached. Each destination and currency is its own target.
        </p>
        {/*
          Stated because the page looks wrong when it is right: the header can be
          browsing Germany while a saved row says "Delivered to Finland · EUR".
          Changing the header must not rewrite a target the user chose.
        */}
        <p className="text-sm text-ink-500" data-testid="watchlist-destination-note">
          {WATCHLIST_COPY.independentDestinations}
        </p>
      </div>

      {watchlist.isPending && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Card key={index}>
              <div className="flex gap-4">
                <Skeleton className="size-16 rounded-lg" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {watchlist.isError && (
        <ErrorState
          message={
            watchlist.error instanceof Error
              ? watchlist.error.message
              : 'We could not load your watchlist.'
          }
          onRetry={() => void watchlist.refetch()}
        />
      )}

      {watchlist.data && watchlist.data.items.length === 0 && (
        <EmptyState
          icon={<BookmarkX className="size-8" aria-hidden="true" />}
          title="You are not tracking anything yet"
          description="Find a product you want and choose “Track price”. Set a target and we will email you when it gets there."
          action={
            <Link
              to="/search"
              className="inline-flex h-9 items-center rounded-lg bg-accent-700 px-4 text-sm font-semibold text-white hover:bg-accent-800"
            >
              Browse deals
            </Link>
          }
        />
      )}

      {watchlist.data && watchlist.data.items.length > 0 && (
        <>
          <p className="text-sm text-ink-500" role="status">
            {groups.length} tracked {groups.length === 1 ? 'product' : 'products'} ·{' '}
            {watchlist.data.total} {watchlist.data.total === 1 ? 'target' : 'targets'}
          </p>
          <ul className="flex flex-col gap-4">
            {groups.map((group) => (
              <li key={group.productId}>
                <WatchlistProductGroup
                  group={group}
                  countryOptions={countryOptions}
                  isDemoStore={demoStoreSlugs.has(group.product.store.slug)}
                  pending={addTarget.isPending || updateItem.isPending || removeItem.isPending}
                  conflict={conflicts[group.productId] ?? null}
                  confirmation={confirmations[group.productId] ?? null}
                  onDismissConflict={() =>
                    setConflicts((current) => ({ ...current, [group.productId]: null }))
                  }
                  onUpdate={(id, input) => handleUpdate(group.productId, id, input)}
                  onRemove={(id) => removeItem.mutate(id)}
                  onAddTarget={(input) => handleAdd(group.productId, input)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
