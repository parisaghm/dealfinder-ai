import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query from React.
 *
 * Used by the offer comparison table, which switches between a real `<table>`
 * and a list of per-store cards at the `sm` breakpoint. That switch is done in
 * JavaScript rather than with `hidden sm:block` for one concrete reason:
 * rendering both and hiding one puts every store name, price and badge in the
 * DOM twice. Playwright locators match hidden elements, so every
 * `getByRole('row')` and `getByText(storeName)` on that page would trip strict
 * mode — and the fix would be defensive `.first()` scoping everywhere, which is
 * exactly the brittleness the repo's role-based selector convention avoids.
 *
 * Returns `true` when `matchMedia` is unavailable, so a non-browser environment
 * degrades to the semantically richer table rather than to the card list.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);

    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `sm` breakpoint, where the comparison table becomes readable. */
export const SM_BREAKPOINT_QUERY = '(min-width: 40rem)';

/**
 * Tailwind's `md` breakpoint, where the header shows its navigation and hides
 * the hamburger.
 *
 * Used to decide *which single copy* of the destination controls is mounted, for
 * the same reason the table switches in JS: `hidden md:block lg:hidden` leaves the
 * band in the DOM at every other width, so two sets of the same labelled selects
 * coexist and `getByLabel('Deliver to')` matches both.
 */
export const MD_BREAKPOINT_QUERY = '(min-width: 48rem)';

/**
 * Tailwind's `lg` breakpoint, where the destination comparison can afford all
 * thirteen columns.
 *
 * Between `sm` and `lg` the same table renders a reduced column set — never a
 * second copy of the rows — for the reason given above: a hidden duplicate row
 * is still a row to a Playwright locator.
 */
export const LG_BREAKPOINT_QUERY = '(min-width: 64rem)';
