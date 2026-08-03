/**
 * Discount arithmetic.
 *
 * Pure functions, no I/O: the API and the browser import the same code, so a
 * card in the grid can never disagree with the details page about what "-32%"
 * means. Every function is defensive about missing/absurd inputs because the
 * numbers ultimately originate from third-party stores.
 */

/** Round half-up to `decimals` places, avoiding binary-float artefacts. */
export function roundTo(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Discount implied by a store's crossed-out price, as a whole percentage.
 *
 * Returns 0 — never a negative number — when there is no original price, when
 * the inputs are unusable, or when the "original" is not actually higher than
 * what is being charged. A 0 here means "no discount we can substantiate",
 * which is what the UI should show for a fake sale label.
 */
export function calculateDiscountPercent(
  currentPrice: number,
  originalPrice: number | null | undefined,
): number {
  if (originalPrice == null) return 0;
  if (!Number.isFinite(currentPrice) || !Number.isFinite(originalPrice)) return 0;
  if (originalPrice <= 0 || currentPrice < 0) return 0;
  if (currentPrice >= originalPrice) return 0;
  return Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
}

/** Absolute money saved versus the original price; 0 when there is no saving. */
export function calculateAbsoluteSaving(
  currentPrice: number,
  originalPrice: number | null | undefined,
): number {
  if (originalPrice == null || !Number.isFinite(currentPrice) || !Number.isFinite(originalPrice)) {
    return 0;
  }
  return roundTo(Math.max(0, originalPrice - currentPrice));
}

/**
 * What the product actually costs to receive. Shipping is a real part of the
 * price, and a "cheaper" product with €15 delivery frequently is not.
 */
export function calculateEffectivePrice(
  currentPrice: number,
  shippingPrice: number | null | undefined,
): number {
  const base = Number.isFinite(currentPrice) ? currentPrice : 0;
  const shipping = shippingPrice != null && Number.isFinite(shippingPrice) ? shippingPrice : 0;
  return roundTo(base + Math.max(0, shipping));
}

/**
 * Signed percentage change from `from` to `to`.
 * Positive means it went up. Returns 0 when `from` is not a usable baseline.
 */
export function calculatePercentChange(from: number, to: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return 0;
  return roundTo(((to - from) / from) * 100, 2);
}

/**
 * Difference between a current price and a user's target price.
 * `reached` is true when the product is at or below what the user asked for.
 */
export function compareToTarget(
  currentPrice: number,
  targetPrice: number,
): { difference: number; percentAway: number; reached: boolean } {
  const difference = roundTo(currentPrice - targetPrice);
  return {
    difference,
    percentAway: targetPrice > 0 ? roundTo((difference / targetPrice) * 100, 1) : 0,
    reached: currentPrice <= targetPrice,
  };
}
