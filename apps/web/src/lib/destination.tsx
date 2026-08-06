import {
  DEFAULT_COUNTRY_CODE,
  DEFAULT_STORE_REGION,
  countryCodeSchema,
  currencyForCountry,
  currencySchema,
  storeRegionSchema,
  type CountryCode,
  type Currency,
  type StoreRegion,
} from '@deal-finder/shared';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';

/**
 * Where the shopper wants things delivered, and in what currency.
 *
 * ## What makes destination mode "active"
 *
 * Two sources can switch it on, and the distinction is load-bearing:
 *
 *  - **A `country` in the URL.** A shared or bookmarked link carries its own
 *    destination, which is the whole reason search state lives in the URL.
 *  - **A stored choice**, written *only* when the user actually changes a
 *    control. That is what makes the destination survive navigating from the
 *    watchlist back to search, where the URL starts empty.
 *
 * `UserSettings` deliberately does **not** activate it. Those columns are
 * defaulted to `FI`/`EUR`/`local` for every user that has ever existed, so
 * treating them as a choice would turn destination mode on for everyone
 * immediately — including a first-time visitor who has expressed no preference,
 * and including every end-to-end run. Settings therefore *seed the controls*
 * and nothing more; the user still has to pick something.
 *
 * The consequence, and it is intentional: with no URL parameter and nothing
 * stored, `isActive` is false and every component receives `null` for its
 * destination prop, which is precisely the pre-expansion rendering.
 *
 * ## Why the URL is never written on mount
 *
 * An effect that synchronised state into the URL on first render would push a
 * history entry the user did not ask for — back would appear to do nothing — and
 * with `useSearchParams` it is one dependency mistake away from an infinite
 * navigation loop. So nothing is written until `setDestination` is called, and
 * when it is, it replaces rather than pushes: changing a dropdown is not a
 * navigation a user wants to walk back through one step at a time.
 */

export const DESTINATION_STORAGE_KEY = 'dealfinder.destination.v1';

export interface DestinationSelection {
  country: CountryCode;
  currency: Currency;
  region: StoreRegion;
}

/** Where the active values came from. Exposed mainly so tests can assert it. */
export type DestinationSource = 'url' | 'storage' | 'fallback';

export interface DestinationContextValue extends DestinationSelection {
  /**
   * False on a first visit with nothing stored. Components must render their
   * pre-expansion output in that case, so pages pass `null` rather than these
   * values down.
   */
  isActive: boolean;
  source: DestinationSource;
  /** Merge a change, persist it, and reflect it in the URL. */
  setDestination: (change: Partial<DestinationSelection>) => void;
  /** Return to the legacy view: forget the choice and drop the URL parameters. */
  clearDestination: () => void;
}

const storedDestinationSchema = z.object({
  country: countryCodeSchema,
  currency: currencySchema,
  region: storeRegionSchema,
});

/** The currency a country is quoted in, which is the sensible default. */
function defaultCurrencyFor(country: CountryCode): Currency {
  return currencyForCountry(country) ?? 'EUR';
}

/**
 * Read the stored choice, discarding anything that does not validate.
 *
 * Synchronous, so the first paint already has the right values and there is no
 * flash of the legacy layout. Every access is guarded: `localStorage` throws on
 * access in a sandboxed iframe and in some privacy modes, and a storage failure
 * must degrade to "no stored preference" rather than break the page.
 *
 * A blob that does not parse is *deleted*, not merely ignored. Leaving a corrupt
 * value in place means re-parsing and re-failing on every mount for as long as
 * the browser profile lives.
 */
export function readStoredDestination(): DestinationSelection | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(DESTINATION_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearStoredDestination();
    return null;
  }

  const result = storedDestinationSchema.safeParse(parsed);
  if (!result.success) {
    clearStoredDestination();
    return null;
  }
  return result.data;
}

function writeStoredDestination(selection: DestinationSelection): void {
  try {
    window.localStorage.setItem(DESTINATION_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Storage unavailable or full. The URL still carries the choice, so the
    // feature degrades to "not remembered between visits" rather than failing.
  }
}

export function clearStoredDestination(): void {
  try {
    window.localStorage.removeItem(DESTINATION_STORAGE_KEY);
  } catch {
    // Nothing to do; see above.
  }
}

/**
 * URL parameters → a destination, or null when the URL names no country.
 *
 * `country` alone is the switch. `currency` and `region` are read when present
 * and defaulted when not, so a hand-written `?country=DE` is a complete,
 * working link rather than a half-configured state.
 */
export function paramsToDestination(params: URLSearchParams): DestinationSelection | null {
  const country = countryCodeSchema.safeParse(params.get('country'));
  if (!country.success) return null;

  const currency = currencySchema.safeParse(params.get('currency'));
  const region = storeRegionSchema.safeParse(params.get('region'));

  return {
    country: country.data,
    currency: currency.success ? currency.data : defaultCurrencyFor(country.data),
    region: region.success ? region.data : DEFAULT_STORE_REGION,
  };
}

/**
 * A destination → the parameters that should appear in the URL.
 *
 * `country` is always written, even when it is the default: a shared link has to
 * carry its destination explicitly or the recipient sees their own. `currency`
 * and `region` are written only when they differ from what `paramsToDestination`
 * would infer, which keeps the common link short without losing anything.
 */
export function applyDestinationToParams(
  params: URLSearchParams,
  selection: DestinationSelection,
): URLSearchParams {
  const next = new URLSearchParams(params);

  next.set('country', selection.country);

  if (selection.currency === defaultCurrencyFor(selection.country)) next.delete('currency');
  else next.set('currency', selection.currency);

  if (selection.region === DEFAULT_STORE_REGION) next.delete('region');
  else next.set('region', selection.region);

  return next;
}

/**
 * A path, plus the destination it should be read in.
 *
 * Needed because a click is a link too. Following a card through to its
 * comparison page must not drop the destination: with a URL-only destination
 * — a link someone shared — there is nothing in storage to fall back on, and the
 * comparison would silently answer for the recipient's own country instead of
 * the one the link named.
 *
 * `currency` travels only when it is not the country's own, matching
 * `applyDestinationToParams`, so the ordinary link stays short.
 */
export function destinationPath(
  path: string,
  selection: Pick<DestinationSelection, 'country' | 'currency'> | null,
): string {
  if (!selection) return path;
  const params = new URLSearchParams({ country: selection.country });
  if (selection.currency !== defaultCurrencyFor(selection.country)) {
    params.set('currency', selection.currency);
  }
  return `${path}?${params.toString()}`;
}

const DestinationContext = createContext<DestinationContextValue | null>(null);

export interface DestinationProviderProps {
  children: ReactNode;
  /**
   * Defaults from `UserSettings`, used to seed the controls only.
   *
   * Never activates destination mode — see the module comment. Arrives
   * asynchronously, which is another reason it cannot be an activator: the first
   * render would show the legacy view and the second would replace it.
   */
  settingsDefaults?: Partial<DestinationSelection> | null;
}

export function DestinationProvider({ children, settingsDefaults }: DestinationProviderProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * The stored choice, read once.
   *
   * State rather than a value read on every render, because `setDestination`
   * has to update it synchronously for the case where the URL is *not* the
   * source of truth for this page.
   */
  const [stored, setStored] = useState<DestinationSelection | null>(() => readStoredDestination());

  const fromUrl = paramsToDestination(searchParams);

  const resolved = useMemo<{ selection: DestinationSelection; source: DestinationSource }>(() => {
    if (fromUrl) return { selection: fromUrl, source: 'url' };
    if (stored) return { selection: stored, source: 'storage' };

    const country = settingsDefaults?.country ?? DEFAULT_COUNTRY_CODE;
    return {
      selection: {
        country,
        currency: settingsDefaults?.currency ?? defaultCurrencyFor(country),
        region: settingsDefaults?.region ?? DEFAULT_STORE_REGION,
      },
      source: 'fallback',
    };
    /*
      The three field dependencies below fully determine `fromUrl`, which is a
      freshly-built object on every render — listing the object itself would make
      the memo recompute every time and defeat the point of it. `exhaustive-deps`
      cannot see that a nullable object is covered by its own fields, so the rule
      is silenced here rather than satisfied by a dependency that would be wrong.
    */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fromUrl?.country,
    fromUrl?.currency,
    fromUrl?.region,
    stored,
    settingsDefaults?.country,
    settingsDefaults?.currency,
    settingsDefaults?.region,
  ]);

  const setDestination = useCallback(
    (change: Partial<DestinationSelection>) => {
      const base = resolved.selection;
      const country = change.country ?? base.country;

      /**
       * Changing country re-defaults the currency unless the currency was named
       * in the same change.
       *
       * Otherwise picking Sweden while EUR is selected silently keeps quoting
       * euros for a shop that charges kronor — technically a conversion we can
       * do, but not what the user meant, and it hides the currency question
       * exactly when it becomes relevant.
       */
      const currency =
        change.currency ??
        (change.country != null && change.country !== base.country
          ? defaultCurrencyFor(country)
          : base.currency);

      const next: DestinationSelection = {
        country,
        currency,
        region: change.region ?? base.region,
      };

      setStored(next);
      writeStoredDestination(next);

      // `replace`, and built from the *current* params, so the query, sort,
      // grouping and every filter survive a change of destination.
      setSearchParams((current) => applyDestinationToParams(current, next), { replace: true });
    },
    [resolved.selection, setSearchParams],
  );

  const clearDestination = useCallback(() => {
    setStored(null);
    clearStoredDestination();
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('country');
        next.delete('currency');
        next.delete('region');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const value = useMemo<DestinationContextValue>(
    () => ({
      ...resolved.selection,
      isActive: resolved.source !== 'fallback',
      source: resolved.source,
      setDestination,
      clearDestination,
    }),
    [resolved, setDestination, clearDestination],
  );

  return <DestinationContext.Provider value={value}>{children}</DestinationContext.Provider>;
}

export function useDestination(): DestinationContextValue {
  const value = useContext(DestinationContext);
  if (!value) {
    throw new Error('useDestination must be used inside a DestinationProvider.');
  }
  return value;
}

/**
 * The destination as a nullable prop, for passing straight into a component.
 *
 * Returns null whenever destination mode is off, which is what every
 * presentational component treats as "render exactly as you did before".
 */
export function useActiveDestination(): DestinationSelection | null {
  const { country, currency, region, isActive } = useDestination();
  return useMemo(
    () => (isActive ? { country, currency, region } : null),
    [isActive, country, currency, region],
  );
}
