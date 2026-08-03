import type { Currency } from '../schemas/common';

/**
 * Presentation helpers shared by the API (email templates, deal-quality
 * explanations) and the browser, so a price is written the same way wherever
 * it appears.
 *
 * Locale is Finnish by default because the MVP covers Finnish stores, but it
 * is a parameter rather than a hard-coded assumption.
 */

export const DEFAULT_LOCALE = 'fi-FI';

const formatterCache = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: Currency, locale: string, decimals: number): Intl.NumberFormat {
  const key = `${locale}:${currency}:${decimals}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/**
 * Currency string for humans, e.g. `24,90 €`.
 *
 * Whole amounts drop the decimals (`1 099 €` reads better than `1 099,00 €`
 * on a product card), while anything with cents keeps them.
 */
export function formatMoney(
  value: number,
  currency: Currency = 'EUR',
  locale: string = DEFAULT_LOCALE,
): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  const decimals = Number.isInteger(rounded) ? 0 : 2;
  return moneyFormatter(currency, locale, decimals).format(rounded);
}

/** `-32 %` style discount label. Returns null when there is nothing to show. */
export function formatDiscount(percent: number): string | null {
  if (!Number.isFinite(percent) || percent <= 0) return null;
  return `-${Math.round(percent)} %`;
}

export function formatPercent(
  value: number,
  locale: string = DEFAULT_LOCALE,
  decimals = 1,
): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatDate(value: Date | string, locale: string = DEFAULT_LOCALE): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Coarse "last checked" phrasing. `now` is injectable so tests are not
 * dependent on the wall clock.
 */
export function formatRelativeTime(
  value: Date | string,
  now: Date | number = Date.now(),
  locale: string = DEFAULT_LOCALE,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const nowMs = typeof now === 'number' ? now : now.getTime();
  const diff = nowMs - date.getTime();

  if (diff < 0) return 'just now';
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) {
    const minutes = Math.floor(diff / MINUTE);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (diff < 30 * DAY) {
    const days = Math.floor(diff / DAY);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
  return formatDate(date, locale);
}

/** Turns `gaming-consoles` into `Gaming consoles` for unknown category ids. */
export function humanise(value: string): string {
  const spaced = value.replace(/[-_]+/g, ' ').trim();
  if (!spaced) return '';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Human labels for stock states.
 *
 * A dedicated map rather than `humanise`, which would render the enum value
 * `IN_STOCK` as "IN STOCK" — technically readable, but it shouts.
 */
const AVAILABILITY_LABELS: Record<string, string> = {
  IN_STOCK: 'In stock',
  LOW_STOCK: 'Only a few left',
  OUT_OF_STOCK: 'Out of stock',
  PREORDER: 'Pre-order',
  DISCONTINUED: 'Discontinued',
  UNKNOWN: 'Stock unknown',
};

export function formatAvailability(value: string): string {
  return AVAILABILITY_LABELS[value] ?? humanise(value.toLowerCase());
}
