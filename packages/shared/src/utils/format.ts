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

/**
 * The symbol to put inside an input where the user types an amount.
 *
 * Derived from `Intl` rather than from a hand-written map, so a currency added to
 * `CURRENCIES` needs no change here and cannot end up quietly wearing a euro
 * sign. The code itself is the fallback: "SEK" in the field is unambiguous, which
 * is the only thing that matters for a price the user is about to commit to.
 */
export function currencySymbol(currency: Currency, locale: string = DEFAULT_LOCALE): string {
  const parts = moneyFormatter(currency, locale, 0).formatToParts(0);
  return parts.find((part) => part.type === 'currency')?.value ?? currency;
}

/**
 * A `MoneyAmount` from the wire, formatted.
 *
 * Takes the whole object rather than a number so the currency travels with the
 * value it belongs to. Passing them separately is how a Swedish price ends up
 * rendered with a euro sign — the exact failure this feature exists to prevent.
 */
export function formatMoneyAmount(
  amount: { readonly major: number; readonly currency: Currency } | null | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  if (amount == null) return '—';
  return formatMoney(amount.major, amount.currency, locale);
}

/**
 * A converted amount, always disclosing that a conversion happened.
 *
 * Returns null when there is nothing to disclose — a same-currency amount was
 * not converted, and labelling it "converted" would be noise that trains people
 * to ignore the label where it matters.
 */
export function formatConverted(
  converted: {
    readonly original: { readonly major: number; readonly currency: Currency };
    readonly converted: { readonly major: number; readonly currency: Currency } | null;
    readonly exchangeRate: number | null;
    readonly exchangeRateTimestamp: string | null;
  },
  locale: string = DEFAULT_LOCALE,
): string | null {
  const { original, exchangeRate, exchangeRateTimestamp } = converted;
  if (converted.converted == null || exchangeRate == null) return null;
  if (original.currency === converted.converted.currency) return null;

  const rate = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(exchangeRate);

  const observed = exchangeRateTimestamp ? formatDate(exchangeRateTimestamp, locale) : null;

  return [
    `Converted from ${formatMoney(original.major, original.currency, locale)}`,
    `at 1 ${original.currency} = ${rate} ${converted.converted.currency}`,
    observed ? `(${observed})` : null,
    `— the store charges in ${original.currency}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * How old an exchange rate is, in words a shopper can weigh.
 *
 * Deliberately vague at the top end: "5 days ago" is the useful signal, and
 * quoting 127 hours implies a precision that does not change any decision.
 */
export function formatRateAge(ageHours: number | null | undefined): string {
  if (ageHours == null || !Number.isFinite(ageHours)) return 'at an unknown time';
  if (ageHours < 1) return 'less than an hour ago';
  if (ageHours < 2) return 'an hour ago';
  if (ageHours < 48) return `${String(Math.round(ageHours))} hours ago`;
  return `${String(Math.round(ageHours / 24))} days ago`;
}

/**
 * The display locale for a delivery country.
 *
 * Only the eight supported destinations are mapped; anything else falls back to
 * `DEFAULT_LOCALE`. Kept as a flat map rather than derived from the country code
 * because the language and the country genuinely differ (Belgium, Switzerland),
 * so `xx-XX` guessing would be wrong precisely where it matters.
 */
const LOCALE_BY_COUNTRY: Record<string, string> = {
  FI: 'fi-FI',
  SE: 'sv-SE',
  DE: 'de-DE',
  NL: 'nl-NL',
  FR: 'fr-FR',
  ES: 'es-ES',
  IT: 'it-IT',
  DK: 'da-DK',
  BE: 'nl-BE',
  PT: 'pt-PT',
  AT: 'de-AT',
  NO: 'nb-NO',
  CH: 'de-CH',
  GB: 'en-GB',
};

export function localeForCountry(code: string | null | undefined): string {
  if (code == null) return DEFAULT_LOCALE;
  return LOCALE_BY_COUNTRY[code] ?? DEFAULT_LOCALE;
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
