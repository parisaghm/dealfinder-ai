/**
 * Axis-tick arithmetic, shared by the single-product and cross-store charts.
 *
 * Extracted rather than copied: it is the sort of fiddly numeric helper where
 * two divergent copies would drift silently, and the two charts sitting on the
 * same page must agree about what a "round number" is.
 */

/**
 * Pick a padded domain whose ticks land on round numbers.
 *
 * Recharts' automatic ticks follow the data, which produces an axis reading
 * "65,97 € / 85,97 € / 105,97 €". Axis labels carry the values that are not
 * directly labelled, so they have to be numbers a reader can hold in their
 * head — 60 / 80 / 100, not the data's arbitrary offsets.
 */
export function niceScale(
  minValue: number,
  maxValue: number,
  targetTicks = 5,
): { domain: [number, number]; ticks: number[] } {
  const range = Math.max(maxValue - minValue, Math.max(maxValue * 0.05, 1));
  const rawStep = range / Math.max(1, targetTicks - 1);

  // Snap the step to 1, 2, 2.5 or 5 times a power of ten.
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const niceMultiple =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  const step = niceMultiple * magnitude;

  // One step of breathing room, then snap the bounds outward onto the step grid.
  const lower = Math.max(0, Math.floor((minValue - step * 0.5) / step) * step);
  const upper = Math.ceil((maxValue + step * 0.5) / step) * step;

  const ticks: number[] = [];
  for (let value = lower; value <= upper + step / 2; value += step) {
    ticks.push(Math.round(value * 100) / 100);
  }

  return { domain: [lower, upper], ticks };
}

/** Shared axis tick styling, so the two charts are visually the same chart. */
export const AXIS_TICK = { fill: '#667085', fontSize: 11 } as const;

export const GRID_STROKE = '#e4e7ec';
export const ANNOTATION_STROKE = '#98a2b3';
