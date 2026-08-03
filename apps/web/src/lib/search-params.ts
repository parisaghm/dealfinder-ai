import {
  DEAL_GROUPING_OPTIONS,
  DEAL_SORT_OPTIONS,
  type DealGrouping,
  type DealSort,
  type DealsQuery,
} from '@deal-finder/shared';
import type { FilterValues } from '../components/deals/FilterPanel';
import type { SearchFormValues } from '../components/deals/SearchForm';

/**
 * Search state lives in the URL.
 *
 * Deliberate: a result set is then shareable, bookmarkable, and correct under
 * browser back/forward. Keeping filters in component state instead would break
 * all three, and the back button silently doing nothing is one of the most
 * common complaints about search UIs.
 *
 * These helpers are the single translation layer between URL params, form
 * values and the API query.
 */

export function buildSearchParams(
  values: Partial<SearchFormValues> & { sort?: DealSort; page?: number; group?: DealGrouping },
): URLSearchParams {
  const params = new URLSearchParams();

  if (values.query?.trim()) params.set('query', values.query.trim());
  if (values.maximumPrice) params.set('maximumPrice', values.maximumPrice);
  if (values.minimumDiscount) params.set('minimumDiscount', values.minimumDiscount);
  if (values.category) params.set('category', values.category);
  if (values.stores && values.stores.length > 0) params.set('stores', values.stores.join(','));
  if (values.sort && values.sort !== 'best-discount') params.set('sort', values.sort);
  // Written only when non-default, matching the `sort` convention above: a URL
  // that says nothing means "the defaults", which keeps shared links short and
  // keeps every existing link working unchanged.
  if (values.group && values.group !== 'none') params.set('group', values.group);
  if (values.page && values.page > 1) params.set('page', String(values.page));

  return params;
}

function parsePositiveNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function isDealSort(value: string | null): value is DealSort {
  return value != null && (DEAL_SORT_OPTIONS as readonly string[]).includes(value);
}

function isDealGrouping(value: string | null): value is DealGrouping {
  return value != null && (DEAL_GROUPING_OPTIONS as readonly string[]).includes(value);
}

/** URL params → the query sent to `GET /api/deals`. */
export function paramsToDealsQuery(params: URLSearchParams, limit = 12): Partial<DealsQuery> {
  const stores = params.get('stores');

  return {
    query: params.get('query') ?? undefined,
    maximumPrice: parsePositiveNumber(params.get('maximumPrice')),
    minimumDiscount: parsePositiveNumber(params.get('minimumDiscount')),
    category: params.get('category') ?? undefined,
    stores: stores ? stores.split(',').filter(Boolean) : undefined,
    sort: isDealSort(params.get('sort')) ? (params.get('sort') as DealSort) : 'best-discount',
    page: parsePositiveNumber(params.get('page')) ?? 1,
    group: paramsToGrouping(params),
    limit,
  };
}

/** URL params → filter-panel form values (all strings, as inputs require). */
export function paramsToFilterValues(params: URLSearchParams): FilterValues {
  const stores = params.get('stores');
  return {
    maximumPrice: params.get('maximumPrice') ?? '',
    minimumDiscount: params.get('minimumDiscount') ?? '',
    category: params.get('category') ?? '',
    stores: stores ? stores.split(',').filter(Boolean) : [],
  };
}

export function paramsToSort(params: URLSearchParams): DealSort {
  const sort = params.get('sort');
  return isDealSort(sort) ? sort : 'best-discount';
}

/**
 * How results are presented.
 *
 * Defaults to `none`. Grouping is one visible click away rather than the
 * landing state, which is what lets every existing link, bookmark and test keep
 * rendering exactly what it rendered before.
 */
export function paramsToGrouping(params: URLSearchParams): DealGrouping {
  const group = params.get('group');
  return isDealGrouping(group) ? group : 'none';
}
