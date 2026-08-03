import { describe, expect, it } from 'vitest';
import {
  buildCompareParams,
  DEFAULT_OFFER_SORT,
  paramsToOfferSort,
  paramsToVisibleStores,
} from './compare-params';

const ALL = ['gigantti', 'power', 'verkkokauppa'];

describe('paramsToOfferSort', () => {
  // Ordering by the number printed on a store's page recommends the wrong shop
  // whenever delivery differs, which is the one thing this page must get right.
  it('defaults to the shipping-inclusive total', () => {
    expect(paramsToOfferSort(new URLSearchParams())).toBe('lowest-total');
    expect(DEFAULT_OFFER_SORT).toBe('lowest-total');
  });

  it('reads a valid sort from the URL', () => {
    expect(paramsToOfferSort(new URLSearchParams('sort=best-discount'))).toBe('best-discount');
  });

  it('falls back rather than trusting an unknown value', () => {
    expect(paramsToOfferSort(new URLSearchParams('sort=nonsense'))).toBe('lowest-total');
  });
});

describe('paramsToVisibleStores', () => {
  it('shows every store when the URL says nothing', () => {
    expect(paramsToVisibleStores(new URLSearchParams(), ALL)).toEqual(ALL);
  });

  it('reads a subset, preserving the canonical store order', () => {
    expect(paramsToVisibleStores(new URLSearchParams('series=verkkokauppa,gigantti'), ALL)).toEqual([
      'gigantti',
      'verkkokauppa',
    ]);
  });

  // A stale link naming stores the product is no longer sold by would otherwise
  // render an empty chart with no way back.
  it('falls back to every store when the URL names none that exist', () => {
    expect(paramsToVisibleStores(new URLSearchParams('series=defunct-store'), ALL)).toEqual(ALL);
  });
});

describe('buildCompareParams', () => {
  it('writes nothing for the defaults, so a plain link stays plain', () => {
    expect(
      buildCompareParams({ sort: 'lowest-total', visibleStores: ALL, allStoreSlugs: ALL }).toString(),
    ).toBe('');
  });

  it('writes the sort only when it is not the default', () => {
    expect(buildCompareParams({ sort: 'lowest-price' }).get('sort')).toBe('lowest-price');
  });

  it('writes the series only when some are hidden, and sorts them for stability', () => {
    const params = buildCompareParams({
      visibleStores: ['verkkokauppa', 'gigantti'],
      allStoreSlugs: ALL,
    });
    expect(params.get('series')).toBe('gigantti,verkkokauppa');
  });

  it('round-trips through the readers', () => {
    const params = buildCompareParams({
      sort: 'best-deal-quality',
      visibleStores: ['gigantti'],
      allStoreSlugs: ALL,
    });
    expect(paramsToOfferSort(params)).toBe('best-deal-quality');
    expect(paramsToVisibleStores(params, ALL)).toEqual(['gigantti']);
  });
});
