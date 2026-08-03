import type {
  CanonicalProductsQuery,
  ClearDataInput,
  CreateSavedSearchInput,
  CreateWatchlistItemPayload,
  DealsQuery,
  MatchCandidatesQuery,
  MatchDecisionBody,
  OfferSort,
  RematchBody,
  UpdateSavedSearchInput,
  UpdateUserSettingsInput,
  UpdateWatchlistItemInput,
} from '@deal-finder/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { api, ApiRequestError } from './api-client';

/**
 * React Query bindings.
 *
 * Query keys are centralised so invalidation is reliable: adding a product to
 * the watchlist has to refresh the watchlist, the dashboard *and* the deals
 * list (whose rows carry an `isTracked` flag). Scattering key literals across
 * components is how that quietly stops working.
 */

export const queryKeys = {
  meta: ['meta'] as const,
  deals: (query: Partial<DealsQuery>) => ['deals', query] as const,
  product: (id: string) => ['product', id] as const,
  priceHistory: (id: string, days: number) => ['product', id, 'history', days] as const,
  watchlist: ['watchlist'] as const,
  savedSearches: ['saved-searches'] as const,
  dashboard: ['dashboard'] as const,
  settings: ['settings'] as const,

  canonicalProducts: (query: Partial<CanonicalProductsQuery>) =>
    ['canonical-products', query] as const,
  canonicalProduct: (id: string) => ['canonical-product', id] as const,
  canonicalOffers: (id: string, sort: OfferSort) =>
    ['canonical-product', id, 'offers', sort] as const,
  canonicalHistory: (id: string, days: number) =>
    ['canonical-product', id, 'history', days] as const,
  matchCandidates: (query: Partial<MatchCandidatesQuery>) => ['match-candidates', query] as const,
};

/** Retrying a 400 or a 404 is pointless; only server/network faults get a retry. */
function retryPolicy(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && !error.isRetryable) return false;
  return failureCount < 2;
}

export const defaultQueryOptions = {
  retry: retryPolicy,
  staleTime: 30_000,
  refetchOnWindowFocus: false,
} satisfies Partial<UseQueryOptions>;

// ── Reads ───────────────────────────────────────────────────────────────────

export function useMeta() {
  return useQuery({
    queryKey: queryKeys.meta,
    queryFn: ({ signal }) => api.meta(signal),
    // Stores and categories effectively never change during a session.
    staleTime: 10 * 60_000,
    retry: retryPolicy,
  });
}

export function useDeals(query: Partial<DealsQuery>, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.deals(query),
    queryFn: ({ signal }) => api.deals(query, signal),
    ...defaultQueryOptions,
    // Keeps the previous page visible while the next loads, so paging does not
    // flash an empty grid.
    placeholderData: (previous) => previous,
    enabled: options.enabled ?? true,
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.product(id ?? ''),
    queryFn: ({ signal }) => api.product(id!, signal),
    ...defaultQueryOptions,
    enabled: Boolean(id),
  });
}

export function usePriceHistory(id: string | undefined, days: number) {
  return useQuery({
    queryKey: queryKeys.priceHistory(id ?? '', days),
    queryFn: ({ signal }) => api.priceHistory(id!, days, signal),
    ...defaultQueryOptions,
    enabled: Boolean(id),
  });
}

export function useWatchlist() {
  return useQuery({
    queryKey: queryKeys.watchlist,
    queryFn: ({ signal }) => api.watchlist(signal),
    ...defaultQueryOptions,
  });
}

export function useSavedSearches() {
  return useQuery({
    queryKey: queryKeys.savedSearches,
    queryFn: ({ signal }) => api.savedSearches(signal),
    ...defaultQueryOptions,
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: ({ signal }) => api.dashboard(signal),
    ...defaultQueryOptions,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => api.settings(signal),
    ...defaultQueryOptions,
  });
}

// ── Mutations ───────────────────────────────────────────────────────────────

/**
 * Everything a tracking change affects.
 *
 * `deals` and `product` are included because their payloads carry `isTracked`,
 * which drives the Track button's state — omitting them leaves a stale button.
 */
function useTrackingInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.watchlist });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    void queryClient.invalidateQueries({ queryKey: ['deals'] });
    void queryClient.invalidateQueries({ queryKey: ['product'] });
  };
}

export function useAddToWatchlist() {
  const invalidate = useTrackingInvalidation();
  return useMutation({
    mutationFn: (input: CreateWatchlistItemPayload) => api.addToWatchlist(input),
    onSuccess: invalidate,
  });
}

export function useUpdateWatchlistItem() {
  const invalidate = useTrackingInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateWatchlistItemInput }) =>
      api.updateWatchlistItem(id, input),
    onSuccess: invalidate,
  });
}

export function useRemoveWatchlistItem() {
  const invalidate = useTrackingInvalidation();
  return useMutation({
    mutationFn: (id: string) => api.removeWatchlistItem(id),
    onSuccess: invalidate,
  });
}

export function useCreateSavedSearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSavedSearchInput) => api.createSavedSearch(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.savedSearches });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useUpdateSavedSearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSavedSearchInput }) =>
      api.updateSavedSearch(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.savedSearches });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useDeleteSavedSearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSavedSearch(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.savedSearches });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUserSettingsInput) => api.updateSettings(input),
    onSuccess: (settings) => {
      // Seed the cache with the response so the form does not flicker.
      queryClient.setQueryData(queryKeys.settings, settings);
    },
  });
}

export function useClearData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ClearDataInput) => api.clearData(input),
    // A destructive action can affect anything cached.
    onSuccess: () => void queryClient.invalidateQueries(),
  });
}

export function useSendTestAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (productId?: string) => api.sendTestAlert(productId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
  });
}

// ── Cross-store comparison ──────────────────────────────────────────────────

export function useCanonicalProduct(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.canonicalProduct(id ?? ''),
    queryFn: ({ signal }) => api.canonicalProduct(id!, signal),
    ...defaultQueryOptions,
    enabled: Boolean(id),
  });
}

export function useCanonicalOffers(id: string | undefined, sort: OfferSort) {
  return useQuery({
    queryKey: queryKeys.canonicalOffers(id ?? '', sort),
    queryFn: ({ signal }) => api.canonicalOffers(id!, sort, signal),
    ...defaultQueryOptions,
    // Keeps the current table on screen while a re-sort loads, so changing the
    // sort never flashes an empty comparison.
    placeholderData: (previous) => previous,
    enabled: Boolean(id),
  });
}

/**
 * Every store's history, fetched once.
 *
 * The per-store filter is applied in the component rather than in the query.
 * That makes toggling a store instant, and — more importantly — sidesteps the
 * stale-data window that forced the `page.waitForResponse()` dance in the
 * existing E2E suite: there is no request to race.
 */
export function useCanonicalHistory(id: string | undefined, days: number) {
  return useQuery({
    queryKey: queryKeys.canonicalHistory(id ?? '', days),
    queryFn: ({ signal }) => api.canonicalHistory(id!, days, signal),
    ...defaultQueryOptions,
    enabled: Boolean(id),
  });
}

// ── Match review ────────────────────────────────────────────────────────────

export function useMatchCandidates(query: Partial<MatchCandidatesQuery>) {
  return useQuery({
    queryKey: queryKeys.matchCandidates(query),
    queryFn: ({ signal }) => api.matchCandidates(query, signal),
    ...defaultQueryOptions,
    placeholderData: (previous) => previous,
  });
}

/**
 * Everything a match decision affects.
 *
 * Approving moves a store offer into a group, so the grouped search pages, every
 * canonical product and the queue itself are all stale. Omitting `deals` would
 * leave the newly-grouped offer still showing as its own ungrouped card.
 */
function useMatchInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['match-candidates'] });
    void queryClient.invalidateQueries({ queryKey: ['canonical-product'] });
    void queryClient.invalidateQueries({ queryKey: ['canonical-products'] });
    void queryClient.invalidateQueries({ queryKey: ['deals'] });
    void queryClient.invalidateQueries({ queryKey: ['product'] });
  };
}

export function useApproveMatchCandidate() {
  const invalidate = useMatchInvalidation();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: MatchDecisionBody }) =>
      api.approveMatchCandidate(id, body ?? {}),
    onSuccess: invalidate,
  });
}

export function useRejectMatchCandidate() {
  const invalidate = useMatchInvalidation();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: MatchDecisionBody }) =>
      api.rejectMatchCandidate(id, body ?? {}),
    onSuccess: invalidate,
  });
}

export function useRematchProduct() {
  const invalidate = useMatchInvalidation();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: RematchBody }) =>
      api.rematchProduct(id, body ?? { force: false }),
    onSuccess: invalidate,
  });
}
