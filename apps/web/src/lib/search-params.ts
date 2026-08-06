import {
  DEAL_GROUPING_OPTIONS,
  DEAL_SORT_OPTIONS,
  type CountryCode,
  type Currency,
  type DealGrouping,
  type DealSort,
  type DealsQuery,
  type StoreRegion,
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
  values: Partial<SearchFormValues> &
    // The filter panel's own value type, which carries the destination bounds.
    // Both forms feed this function and neither is a subset of the other.
    Partial<FilterValues> & { sort?: DealSort; page?: number; group?: DealGrouping },
): URLSearchParams {
  const params = new URLSearchParams();

  if (values.query?.trim()) params.set('query', values.query.trim());
  if (values.maximumPrice) params.set('maximumPrice', values.maximumPrice);
  if (values.minimumDiscount) params.set('minimumDiscount', values.minimumDiscount);
  if (values.category) params.set('category', values.category);
  if (values.stores && values.stores.length > 0) params.set('stores', values.stores.join(','));
  /**
   * The destination-aware bounds.
   *
   * Written only when set, like everything else here. The destination itself
   * (`country`, `currency`, `region`) is *not* written by this function — that
   * belongs to `applyDestinationToParams`, so a filter submit and a destination
   * change cannot each half-write the other's parameters.
   */
  if (values.maximumDeliveredPrice) {
    params.set('maximumDeliveredPrice', values.maximumDeliveredPrice);
  }
  if (values.maximumShippingPrice) params.set('maximumShippingPrice', values.maximumShippingPrice);
  if (values.maxDeliveryDays) params.set('maxDeliveryDays', values.maxDeliveryDays);
  // Only the non-default value is written: both flags default to on, so a URL
  // that says nothing means "show me everything that can get here".
  if (values.shipsToCountryOnly === false) params.set('shipsToCountryOnly', 'false');
  if (values.includeUnknownShipping === false) params.set('includeUnknownShipping', 'false');

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

/** Zero is a real bound for a delivery cost: it means "free delivery only". */
function parseNonNegativeNumber(value: string | null): number | undefined {
  if (value == null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isDealSort(value: string | null): value is DealSort {
  return value != null && (DEAL_SORT_OPTIONS as readonly string[]).includes(value);
}

function isDealGrouping(value: string | null): value is DealGrouping {
  return value != null && (DEAL_GROUPING_OPTIONS as readonly string[]).includes(value);
}

/**
 * URL params → the query sent to `GET /api/deals`.
 *
 * The destination half is added only when the URL names a country, so a URL
 * without one produces the byte-identical query it always produced and the API
 * takes its legacy path. `destination` is passed in rather than re-read from the
 * params because the provider may be resolving it from storage, where the URL has
 * not caught up yet — and a page must not send a country the provider has not
 * settled on.
 */
export function paramsToDealsQuery(
  params: URLSearchParams,
  limit = 12,
  destination?: { country: CountryCode; currency: Currency; region: StoreRegion } | null,
): Partial<DealsQuery> {
  const stores = params.get('stores');

  const base: Partial<DealsQuery> = {
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

  if (!destination) return base;

  return {
    ...base,
    country: destination.country,
    currency: destination.currency,
    region: destination.region,
    maximumDeliveredPrice: parsePositiveNumber(params.get('maximumDeliveredPrice')),
    // Zero is a meaningful maximum delivery cost — "free delivery only" — so this
    // one cannot use the positive-number parser.
    maximumShippingPrice: parseNonNegativeNumber(params.get('maximumShippingPrice')),
    maxDeliveryDays: parsePositiveNumber(params.get('maxDeliveryDays')),
    shipsToCountryOnly: params.get('shipsToCountryOnly') !== 'false',
    includeUnknownShipping: params.get('includeUnknownShipping') !== 'false',
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

    maximumDeliveredPrice: params.get('maximumDeliveredPrice') ?? '',
    maximumShippingPrice: params.get('maximumShippingPrice') ?? '',
    maxDeliveryDays: params.get('maxDeliveryDays') ?? '',
    shipsToCountryOnly: params.get('shipsToCountryOnly') !== 'false',
    includeUnknownShipping: params.get('includeUnknownShipping') !== 'false',
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
