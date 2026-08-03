import {
  apiErrorSchema,
  canonicalHistoryResponseSchema,
  canonicalOffersResponseSchema,
  canonicalProductDetailsSchema,
  canonicalProductsResponseSchema,
  dashboardResponseSchema,
  dealsResponseSchema,
  priceHistoryResponseSchema,
  matchCandidatesResponseSchema,
  matchDecisionResponseSchema,
  productDetailsSchema,
  rematchResponseSchema,
  savedSearchSchema,
  savedSearchesResponseSchema,
  testAlertResponseSchema,
  userSettingsSchema,
  watchlistItemSchema,
  watchlistResponseSchema,
  type CanonicalHistoryResponse,
  type CanonicalOffersResponse,
  type CanonicalProductDetails,
  type CanonicalProductsQuery,
  type CanonicalProductsResponse,
  type ClearDataInput,
  type ClearDataResponse,
  type CreateSavedSearchInput,
  type CreateWatchlistItemInput,
  type DashboardResponse,
  type DealsQuery,
  type DealsResponse,
  type MatchCandidatesQuery,
  type MatchCandidatesResponse,
  type MatchDecisionBody,
  type MatchDecisionResponse,
  type OfferSort,
  type PriceHistoryResponse,
  type ProductDetails,
  type RematchBody,
  type RematchResponse,
  type SavedSearch,
  type SavedSearchesResponse,
  type TestAlertResponse,
  type UpdateSavedSearchInput,
  type UpdateUserSettingsInput,
  type UpdateWatchlistItemInput,
  type UserSettings,
  type WatchlistItem,
  type WatchlistResponse,
} from '@deal-finder/shared';
import { z } from 'zod';

/**
 * The typed API client.
 *
 * Every response is parsed with the *same* Zod schema the server validated it
 * against. That costs a few microseconds and buys a guarantee: a contract
 * mismatch fails loudly here, at the boundary, with a readable message —
 * instead of surfacing as `undefined.toFixed()` somewhere deep in a component.
 */

/** Empty means same-origin, which the Vite dev proxy forwards to the API. */
const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: unknown; requestId?: string } = {},
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.requestId = options.requestId;
  }

  /** True for failures a retry might fix; used to decide whether to offer one. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Omit to skip response parsing (204 No Content). */
  schema?: z.ZodTypeAny;
  signal?: AbortSignal;
}

/**
 * Shared transport. Returns `unknown`; the two wrappers below give callers a
 * precise type — a conditional return type here would have to be asserted at
 * every call site anyway, which is worse than two small functions.
 */
async function send(path: string, options: RequestOptions = {}): Promise<unknown> {
  const { method = 'GET', body, schema, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    // Network-level failure: no response at all. Status 0 marks it retryable.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiRequestError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Check that the API is running.',
    );
  }

  if (!response.ok) {
    let code = 'HTTP_ERROR';
    let message = `Request failed with status ${response.status}.`;
    let details: unknown;
    let requestId: string | undefined;

    // The API always uses one error envelope, so parse it — but never let a
    // malformed error body mask the original status.
    try {
      const parsed = apiErrorSchema.safeParse(await response.json());
      if (parsed.success) {
        code = parsed.data.error.code;
        message = parsed.data.error.message;
        details = parsed.data.error.details;
        requestId = parsed.data.error.requestId;
      }
    } catch {
      // Non-JSON error body; keep the generic message.
    }

    throw new ApiRequestError(response.status, code, message, { details, requestId });
  }

  if (!schema) return undefined;

  const payload = await response.json();
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    // A shape mismatch is a bug, not a user error: surface it clearly.
    console.error('Response did not match the expected schema', {
      path,
      issues: parsed.error.issues,
    });
    throw new ApiRequestError(
      response.status,
      'INVALID_RESPONSE',
      'The server returned unexpected data. This is a bug — please report it.',
      { details: parsed.error.issues },
    );
  }

  return parsed.data;
}

/** Request a JSON response and parse it with `schema`. */
async function request<TSchema extends z.ZodTypeAny>(
  path: string,
  schema: TSchema,
  options: Omit<RequestOptions, 'schema'> = {},
): Promise<z.output<TSchema>> {
  return (await send(path, { ...options, schema })) as z.output<TSchema>;
}

/** Request an endpoint that returns no body (204). */
async function requestNoContent(
  path: string,
  options: Omit<RequestOptions, 'schema'> = {},
): Promise<void> {
  await send(path, options);
}

/** Build a query string, omitting empty values so URLs stay clean and cacheable. */
export function toSearchParams(query: Partial<DealsQuery>): string {
  const params = new URLSearchParams();

  if (query.query) params.set('query', query.query);
  if (query.maximumPrice != null) params.set('maximumPrice', String(query.maximumPrice));
  if (query.minimumDiscount != null) params.set('minimumDiscount', String(query.minimumDiscount));
  if (query.category) params.set('category', query.category);
  if (query.stores && query.stores.length > 0) params.set('stores', query.stores.join(','));
  if (query.vertical) params.set('vertical', query.vertical);
  if (query.sort) params.set('sort', query.sort);
  if (query.group && query.group !== 'none') params.set('group', query.group);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

const metaResponseSchema = z.object({
  stores: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      websiteUrl: z.string(),
      logoUrl: z.string().nullable(),
      isActive: z.boolean(),
    }),
  ),
  verticals: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      tagline: z.string(),
      currency: z.string(),
      exampleSearches: z.array(z.string()),
      categories: z.array(
        z.object({ id: z.string(), label: z.string(), description: z.string().nullable() }),
      ),
    }),
  ),
});
export type MetaResponse = z.infer<typeof metaResponseSchema>;

const clearDataResponseSchema = z.object({
  scope: z.enum(['watchlist', 'saved-searches', 'notifications', 'all']),
  deleted: z.object({
    watchlistItems: z.number(),
    savedSearches: z.number(),
    notifications: z.number(),
  }),
});

/** Query string for `GET /api/canonical-products`, omitting empty values. */
export function toCanonicalParams(query: Partial<CanonicalProductsQuery>): string {
  const params = new URLSearchParams();
  if (query.query) params.set('query', query.query);
  if (query.category) params.set('category', query.category);
  if (query.brand) params.set('brand', query.brand);
  if (query.minOffers != null) params.set('minOffers', String(query.minOffers));
  if (query.sort) params.set('sort', query.sort);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

/** Query string for `GET /api/match-candidates`. */
export function toMatchCandidateParams(query: Partial<MatchCandidatesQuery>): string {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.confidence) params.set('confidence', query.confidence);
  if (query.minScore != null) params.set('minScore', String(query.minScore));
  if (query.category) params.set('category', query.category);
  if (query.store) params.set('store', query.store);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

export const api = {
  meta: (signal?: AbortSignal): Promise<MetaResponse> =>
    request('/api/meta', metaResponseSchema, { signal }),

  deals: (query: Partial<DealsQuery>, signal?: AbortSignal): Promise<DealsResponse> =>
    request(`/api/deals${toSearchParams(query)}`, dealsResponseSchema, { signal }),

  product: (id: string, signal?: AbortSignal): Promise<ProductDetails> =>
    request(`/api/products/${encodeURIComponent(id)}`, productDetailsSchema, { signal }),

  priceHistory: (id: string, days = 90, signal?: AbortSignal): Promise<PriceHistoryResponse> =>
    request(
      `/api/products/${encodeURIComponent(id)}/history?days=${days}`,
      priceHistoryResponseSchema,
      { signal },
    ),

  watchlist: (signal?: AbortSignal): Promise<WatchlistResponse> =>
    request('/api/watchlist', watchlistResponseSchema, { signal }),

  addToWatchlist: (body: CreateWatchlistItemInput): Promise<WatchlistItem> =>
    request('/api/watchlist', watchlistItemSchema, { method: 'POST', body }),

  updateWatchlistItem: (id: string, body: UpdateWatchlistItemInput): Promise<WatchlistItem> =>
    request(`/api/watchlist/${encodeURIComponent(id)}`, watchlistItemSchema, {
      method: 'PATCH',
      body,
    }),

  removeWatchlistItem: (id: string): Promise<void> =>
    requestNoContent(`/api/watchlist/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  savedSearches: (signal?: AbortSignal): Promise<SavedSearchesResponse> =>
    request('/api/saved-searches', savedSearchesResponseSchema, { signal }),

  createSavedSearch: (body: CreateSavedSearchInput): Promise<SavedSearch> =>
    request('/api/saved-searches', savedSearchSchema, { method: 'POST', body }),

  updateSavedSearch: (id: string, body: UpdateSavedSearchInput): Promise<SavedSearch> =>
    request(`/api/saved-searches/${encodeURIComponent(id)}`, savedSearchSchema, {
      method: 'PATCH',
      body,
    }),

  deleteSavedSearch: (id: string): Promise<void> =>
    requestNoContent(`/api/saved-searches/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  dashboard: (signal?: AbortSignal): Promise<DashboardResponse> =>
    request('/api/dashboard', dashboardResponseSchema, { signal }),

  settings: (signal?: AbortSignal): Promise<UserSettings> =>
    request('/api/settings', userSettingsSchema, { signal }),

  updateSettings: (body: UpdateUserSettingsInput): Promise<UserSettings> =>
    request('/api/settings', userSettingsSchema, { method: 'PATCH', body }),

  clearData: (body: ClearDataInput): Promise<ClearDataResponse> =>
    request('/api/settings/clear-data', clearDataResponseSchema, { method: 'POST', body }),

  // ── Cross-store comparison ────────────────────────────────────────────────

  canonicalProducts: (
    query: Partial<CanonicalProductsQuery>,
    signal?: AbortSignal,
  ): Promise<CanonicalProductsResponse> =>
    request(`/api/canonical-products${toCanonicalParams(query)}`, canonicalProductsResponseSchema, {
      signal,
    }),

  canonicalProduct: (id: string, signal?: AbortSignal): Promise<CanonicalProductDetails> =>
    request(`/api/canonical-products/${encodeURIComponent(id)}`, canonicalProductDetailsSchema, {
      signal,
    }),

  canonicalOffers: (
    id: string,
    sort: OfferSort,
    signal?: AbortSignal,
  ): Promise<CanonicalOffersResponse> =>
    request(
      `/api/canonical-products/${encodeURIComponent(id)}/offers?sort=${sort}`,
      canonicalOffersResponseSchema,
      { signal },
    ),

  canonicalHistory: (
    id: string,
    days = 90,
    signal?: AbortSignal,
  ): Promise<CanonicalHistoryResponse> =>
    request(
      `/api/canonical-products/${encodeURIComponent(id)}/history?days=${days}`,
      canonicalHistoryResponseSchema,
      { signal },
    ),

  // ── Match review ──────────────────────────────────────────────────────────

  matchCandidates: (
    query: Partial<MatchCandidatesQuery>,
    signal?: AbortSignal,
  ): Promise<MatchCandidatesResponse> =>
    request(`/api/match-candidates${toMatchCandidateParams(query)}`, matchCandidatesResponseSchema, {
      signal,
    }),

  approveMatchCandidate: (id: string, body: MatchDecisionBody = {}): Promise<MatchDecisionResponse> =>
    request(
      `/api/match-candidates/${encodeURIComponent(id)}/approve`,
      matchDecisionResponseSchema,
      { method: 'POST', body },
    ),

  rejectMatchCandidate: (id: string, body: MatchDecisionBody = {}): Promise<MatchDecisionResponse> =>
    request(`/api/match-candidates/${encodeURIComponent(id)}/reject`, matchDecisionResponseSchema, {
      method: 'POST',
      body,
    }),

  rematchProduct: (id: string, body: RematchBody = { force: false }): Promise<RematchResponse> =>
    request(`/api/products/${encodeURIComponent(id)}/rematch`, rematchResponseSchema, {
      method: 'POST',
      body,
    }),

  sendTestAlert: (productId?: string): Promise<TestAlertResponse> =>
    request('/api/alerts/test', testAlertResponseSchema, {
      method: 'POST',
      body: productId ? { productId } : {},
    }),
};
