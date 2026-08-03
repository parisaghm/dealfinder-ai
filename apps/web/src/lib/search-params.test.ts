import { describe, expect, it } from 'vitest';
import { buildSearchParams, paramsToDealsQuery, paramsToGrouping } from './search-params';

/**
 * Grouping is opt-in, and the URL is what makes that true.
 *
 * A link that says nothing about grouping must render exactly what it rendered
 * before the feature existed — that is the whole basis for adding it without
 * touching a single existing test or breaking a single shared link.
 */
describe('grouping in the URL', () => {
  it('defaults to ungrouped', () => {
    expect(paramsToGrouping(new URLSearchParams())).toBe('none');
    expect(paramsToDealsQuery(new URLSearchParams()).group).toBe('none');
  });

  it('reads the grouped mode', () => {
    expect(paramsToGrouping(new URLSearchParams('group=canonical'))).toBe('canonical');
  });

  it('falls back rather than trusting an unknown value', () => {
    expect(paramsToGrouping(new URLSearchParams('group=nonsense'))).toBe('none');
  });

  it('writes nothing to the URL for the default', () => {
    expect(buildSearchParams({ query: 'sony', group: 'none' }).has('group')).toBe(false);
  });

  it('writes the parameter when grouping is on', () => {
    expect(buildSearchParams({ query: 'sony', group: 'canonical' }).get('group')).toBe('canonical');
  });

  it('round-trips alongside the other filters', () => {
    const params = buildSearchParams({
      query: 'sony',
      category: 'headphones',
      sort: 'lowest-price',
      group: 'canonical',
    });
    const query = paramsToDealsQuery(params);

    expect(query.query).toBe('sony');
    expect(query.category).toBe('headphones');
    expect(query.sort).toBe('lowest-price');
    expect(query.group).toBe('canonical');
  });
});
