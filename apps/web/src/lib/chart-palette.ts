/**
 * Series colours for the cross-store chart.
 *
 * Two rules, both load-bearing:
 *
 *  1. **Colour follows the store, never the row's rank.** Filtering a store out
 *     must not repaint the survivors — a reader who has learned "orange is
 *     Power" should not have to relearn it every time they toggle something.
 *     That is why the mapping is derived from the *complete* store list, sorted,
 *     and never from whatever subset is currently visible.
 *
 *  2. **Hues are assigned in fixed slot order and never cycled or generated.**
 *     Past six stores the chart plots the six cheapest and says so, rather than
 *     inventing a seventh colour nobody validated.
 */

export const SERIES_COLOUR_VARIABLES = [
  'var(--color-series-1)',
  'var(--color-series-2)',
  'var(--color-series-3)',
  'var(--color-series-4)',
  'var(--color-series-5)',
  'var(--color-series-6)',
] as const;

export const MAX_PLOTTED_SERIES = SERIES_COLOUR_VARIABLES.length;

/** Anything beyond the palette gets this, and is named in a note under the chart. */
export const OVERFLOW_SERIES_COLOUR = 'var(--color-ink-400, #98a2b3)';

/**
 * Map every known store slug to a stable colour.
 *
 * Sorting the full slug list before indexing is what makes the mapping stable:
 * the same store gets the same colour for a given product regardless of price
 * changes, availability, or which stores the reader has toggled off.
 */
export function assignStoreColours(allStoreSlugs: readonly string[]): Map<string, string> {
  const colours = new Map<string, string>();
  const ordered = [...new Set(allStoreSlugs)].sort();

  ordered.forEach((slug, index) => {
    colours.set(slug, SERIES_COLOUR_VARIABLES[index] ?? OVERFLOW_SERIES_COLOUR);
  });

  return colours;
}
