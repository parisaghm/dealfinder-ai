import { OFFER_SORT_OPTIONS, type OfferSort } from '@deal-finder/shared';

/**
 * Comparison-page state, in the URL.
 *
 * Same reasoning as the search page: a comparison someone wants to send to a
 * friend should survive being pasted into a message.
 *
 * The default sort is `lowest-total`, not `lowest-price`. Ordering by the
 * number printed on a store's page recommends the wrong shop whenever delivery
 * differs, and that is the single thing this page exists to get right.
 */

export const DEFAULT_OFFER_SORT: OfferSort = 'lowest-total';

function isOfferSort(value: string | null): value is OfferSort {
  return value != null && (OFFER_SORT_OPTIONS as readonly string[]).includes(value);
}

export function paramsToOfferSort(params: URLSearchParams): OfferSort {
  const sort = params.get('sort');
  return isOfferSort(sort) ? sort : DEFAULT_OFFER_SORT;
}

/**
 * Which store series are plotted.
 *
 * An absent `series` param means "all of them" rather than "none": a fresh
 * visit must show the whole picture, and an empty chart is never the right
 * default.
 */
export function paramsToVisibleStores(
  params: URLSearchParams,
  allStoreSlugs: readonly string[],
): string[] {
  const raw = params.get('series');
  if (!raw) return [...allStoreSlugs];

  const requested = new Set(raw.split(',').filter(Boolean));
  const visible = allStoreSlugs.filter((slug) => requested.has(slug));
  // A stale link naming stores this product is no longer sold by would
  // otherwise render an empty chart with no way back.
  return visible.length > 0 ? visible : [...allStoreSlugs];
}

export function buildCompareParams(values: {
  sort?: OfferSort;
  visibleStores?: readonly string[];
  allStoreSlugs?: readonly string[];
}): URLSearchParams {
  const params = new URLSearchParams();

  if (values.sort && values.sort !== DEFAULT_OFFER_SORT) params.set('sort', values.sort);

  const { visibleStores, allStoreSlugs } = values;
  if (visibleStores && allStoreSlugs && visibleStores.length !== allStoreSlugs.length) {
    params.set('series', [...visibleStores].sort().join(','));
  }

  return params;
}
