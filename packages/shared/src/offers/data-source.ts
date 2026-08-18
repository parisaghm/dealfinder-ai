/**
 * Where an offer's data came from, and whether that permits sending a shopper to
 * the retailer.
 *
 * This is deliberately a *different* question from `Store.isDemoStore`, and
 * conflating the two is the bug this module exists to prevent:
 *
 *   - `isDemoStore` says the **store** is invented. The seven European retailers
 *     are; Gigantti is not.
 *   - `dataSourceType` says the **offer data** is invented. In the default mock
 *     mode every offer is, including the ones attributed to Gigantti, Power and
 *     Verkkokauppa.com.
 *
 * A real retailer name is not evidence that the price, the availability or the
 * product URL under it is real. The mock catalogues build their URLs by
 * interpolating a synthetic id into the retailer's genuine URL shape, so
 * `https://www.gigantti.fi/product/gig-sony-wh1000xm5` is well-formed, sits on a
 * real domain, and is a 404. Presenting that as "View deal" tells a shopper we
 * have seen a listing we have never seen.
 *
 * So the external link is gated here, in one function, rather than by each
 * component deciding for itself.
 */

/**
 * How a listing or offer was obtained.
 *
 * Mirrored by `ProviderSourceKind` in `@deal-finder/store-providers`, which
 * re-exports these values rather than declaring its own: the providers package
 * already depends on this one, and two hand-maintained copies of a trust
 * vocabulary would eventually disagree about which values are safe.
 */
export const DATA_SOURCE_TYPES = [
  /** Bundled sample data. No network access, and never externally linked. */
  'mock',
  /** Official or partner HTTP API. */
  'api',
  /** Affiliate network product feed. */
  'affiliate-feed',
  /** Merchant-supplied product feed. */
  'merchant-feed',
  /** Structured data published by the page itself (JSON-LD, microdata). */
  'structured-data',
  /** Rendered DOM read through a headless browser. */
  'browser',
] as const;

export type DataSourceType = (typeof DATA_SOURCE_TYPES)[number];

/**
 * The sources whose product URL came from an integration that actually fetched
 * it, and may therefore be opened.
 *
 * `browser` is included: that adapter navigated to the exact URL it reports, so
 * the URL is verified even though the price around it was scraped rather than
 * published. `mock` is excluded because nothing was ever fetched.
 *
 * Membership is opt-in. A source kind added to `DATA_SOURCE_TYPES` and forgotten
 * here is treated as untrusted, which is the failure direction we want.
 */
const EXTERNALLY_LINKABLE: ReadonlySet<string> = new Set<DataSourceType>([
  'api',
  'affiliate-feed',
  'merchant-feed',
  'structured-data',
  'browser',
]);

/**
 * Hostname suffixes reserved by RFC 6761 and RFC 2606, which can never resolve
 * to a real shop.
 *
 * The seven synthetic European stores use `*.example` precisely so that nothing
 * in the demo catalogue can accidentally reach a live host. Rejecting them here
 * is a second line of defence behind the source check, not the primary one — a
 * demo offer is refused for being demo, whatever its URL looks like.
 */
const RESERVED_HOST_SUFFIXES = ['.example', '.test', '.invalid', '.localhost'] as const;

/** True only for bundled sample data. Deliberately distinct from "unrecognised". */
export function isDemoDataSource(value: string | null | undefined): boolean {
  return value === 'mock';
}

/**
 * True when the value is one we recognise at all.
 *
 * An unknown string is neither demo nor trusted: it means data arrived from a
 * path this build does not know about, and the honest response is to say nothing
 * about it and offer no link.
 */
export function isKnownDataSource(value: string | null | undefined): boolean {
  return value != null && (DATA_SOURCE_TYPES as readonly string[]).includes(value);
}

/** Narrowing companion to `isKnownDataSource`, for the few places that need the type. */
export function asDataSourceType(value: string | null | undefined): DataSourceType | null {
  return isKnownDataSource(value) ? (value as DataSourceType) : null;
}

/**
 * Whether a URL is fit to put behind a link a shopper will click.
 *
 * Absolute `http`/`https` only — a relative path, a `javascript:` URL or an
 * unparseable string are all rejected rather than rendered and hoped for.
 */
export function isPresentableProductUrl(url: string | null | undefined): boolean {
  if (url == null || url.trim() === '') return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost') return false;
  return !RESERVED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Combine two provenances, keeping the weaker one.
 *
 * A destination quote and the listing it quotes each carry their own source, and
 * they can legitimately differ. Trust cannot be taken from whichever is higher: a
 * live-API quote attached to a listing whose `productUrl` came from a fixture is
 * still pointing at a fabricated URL. So an offer is never more trustworthy than
 * the listing beneath it.
 *
 * Unrecognised values are returned as-is, because they fail closed downstream and
 * a caller reading the result should see the value that caused it.
 */
export function leastTrustedDataSource(
  a: string | null | undefined,
  b: string | null | undefined,
): string {
  for (const value of [a, b]) {
    if (!isKnownDataSource(value)) return value ?? '';
  }
  return isDemoDataSource(a) || isDemoDataSource(b) ? 'mock' : (a as string);
}

/**
 * The single decision: may this offer be presented as an external "View deal"?
 *
 * Fails closed. Demo data, an unrecognised source, a missing URL and an
 * unusable URL all return false, so the only way to get a link is to satisfy
 * every condition explicitly.
 *
 * The parameter is structural rather than a union of DTO types so that one
 * function serves `ProductSummary`, `ProductDetails`, `CanonicalOffer` and
 * `DestinationOffer` without importing any of them, and keeps working when a
 * future payload carries the same two fields.
 */
export function canOpenExternalDeal(offer: {
  dataSourceType?: string | null;
  productUrl?: string | null;
}): boolean {
  if (!EXTERNALLY_LINKABLE.has(offer.dataSourceType ?? '')) return false;
  return isPresentableProductUrl(offer.productUrl);
}
