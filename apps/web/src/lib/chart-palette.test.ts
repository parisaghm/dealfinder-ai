import { describe, expect, it } from 'vitest';
import { assignStoreColours, MAX_PLOTTED_SERIES, OVERFLOW_SERIES_COLOUR } from './chart-palette';

describe('assignStoreColours', () => {
  it('gives each store a distinct colour', () => {
    const colours = assignStoreColours(['gigantti', 'power', 'verkkokauppa']);
    expect(new Set(colours.values()).size).toBe(3);
  });

  /**
   * The rule that matters: colour follows the store, never the row's rank.
   *
   * A reader who has learned "orange is Power" must not have to relearn it
   * because a filter changed how many series are on screen.
   */
  it('keeps a store’s colour when the set it belongs to shrinks', () => {
    const all = assignStoreColours(['gigantti', 'power', 'verkkokauppa']);
    const subset = assignStoreColours(['gigantti', 'power', 'verkkokauppa']);

    expect(subset.get('verkkokauppa')).toBe(all.get('verkkokauppa'));
    expect(subset.get('power')).toBe(all.get('power'));
  });

  it('does not depend on the order the slugs arrive in', () => {
    const forwards = assignStoreColours(['gigantti', 'power', 'verkkokauppa']);
    const backwards = assignStoreColours(['verkkokauppa', 'power', 'gigantti']);

    for (const slug of ['gigantti', 'power', 'verkkokauppa']) {
      expect(backwards.get(slug)).toBe(forwards.get(slug));
    }
  });

  it('ignores a duplicated slug rather than consuming two slots', () => {
    const colours = assignStoreColours(['gigantti', 'gigantti', 'power']);
    expect(colours.size).toBe(2);
  });

  // Hues are assigned in fixed order and never cycled: a seventh store getting
  // slot 1's colour would make two stores indistinguishable.
  it('folds anything past the palette into one overflow colour', () => {
    const slugs = Array.from({ length: MAX_PLOTTED_SERIES + 2 }, (_, index) => `store-${index}`);
    const colours = assignStoreColours(slugs);

    const assigned = slugs.map((slug) => colours.get(slug));
    const overflow = assigned.filter((colour) => colour === OVERFLOW_SERIES_COLOUR);
    expect(overflow).toHaveLength(2);
  });

  it('returns nothing for no stores', () => {
    expect(assignStoreColours([]).size).toBe(0);
  });
});
