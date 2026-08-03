import { z } from 'zod';
import { type Currency } from '../schemas/common';

/**
 * The country table.
 *
 * This static table is the source of truth; the `countries` database table
 * mirrors it so that offers can carry a foreign key and be joined on. Keeping
 * the authority here rather than in the database means a code path can never
 * consult a country that the type system does not know about, and the mirror is
 * asserted against this table at startup rather than trusted.
 *
 * `isSupported` distinguishes a destination a user may actually select from one
 * that is merely *modelled*. Modelled countries exist for two honest reasons:
 *
 *  1. A store's delivery rules can legitimately name a country we do not yet
 *     offer as a destination (a Dutch store shipping to Belgium), and those
 *     rules must be expressible without inventing a code.
 *  2. Norway, Switzerland and the United Kingdom sit outside the EU customs
 *     union, so their tax and duty behaviour differs materially. Modelling them
 *     before supporting them is what keeps that difference visible in the type
 *     system instead of discovered in production.
 *
 * A modelled country is never deliverable, because deliverability requires a
 * `StoreOffer` row and offers are only generated for supported destinations.
 */

/**
 * Every code the application knows, as a literal tuple.
 *
 * Declared explicitly rather than derived from `COUNTRIES` because `z.enum`
 * needs a tuple and deriving one from a mapped array requires a cast that
 * defeats the point. `countries.test.ts` asserts the two stay in exact
 * correspondence, so drift fails a test rather than silently type-checking.
 */
export const COUNTRY_CODES = [
  'FI',
  'SE',
  'DE',
  'NL',
  'FR',
  'ES',
  'IT',
  'DK',
  'BE',
  'PT',
  'AT',
  'NO',
  'CH',
  'GB',
] as const;

export const countryCodeSchema = z.enum(COUNTRY_CODES);
export type CountryCode = z.infer<typeof countryCodeSchema>;

export interface CountryDefinition {
  readonly code: CountryCode;
  readonly name: string;
  readonly currency: Currency;
  readonly isEuMember: boolean;
  readonly isEeaMember: boolean;
  readonly isSupported: boolean;
  /**
   * Standard VAT/sales-tax percentage, as a reference value.
   *
   * Representative, not authoritative. Rates change by legislation, reduced
   * rates apply to whole product categories, and nothing here is a tax
   * calculation a shopper or a merchant should rely on. It exists so an
   * estimated import VAT can be shown as an estimate and labelled as one.
   */
  readonly standardVatPercent: number;
}

export const COUNTRIES = [
  {
    code: 'FI',
    name: 'Finland',
    currency: 'EUR',
    isEuMember: true,
    isEeaMember: true,
    isSupported: true,
    standardVatPercent: 25.5,
  },
  {
    code: 'SE',
    name: 'Sweden',
    currency: 'SEK',
    isEuMember: true,
    isEeaMember: true,
    isSupported: true,
    standardVatPercent: 25,
  },
  {
    code: 'DE',
    name: 'Germany',
    currency: 'EUR',
    isEuMember: true,
    isEeaMember: true,
    isSupported: true,
    standardVatPercent: 19,
  },
  {
    code: 'NL',
    name: 'Netherlands',
    currency: 'EUR',
    isEuMember: true,
    isEeaMember: true,
    isSupported: true,
    standardVatPercent: 21,
  },
  {
    code: 'FR',
    name: 'France',
    currency: 'EUR',
    isEuMember: true,
    isEeaMember: true,
    isSupported: true,
    standardVatPercent: 20,
  },
  {
    code: 'ES',
    name: 'Spain',
    currency: 'EUR',
    isEuMember: true,
    isEeaMember: true,
    isSupported: true,
    standardVatPercent: 21,
  },
  {
    code: 'IT',
    name: 'Italy',
    currency: 'EUR',
    isEuMember: true,
    isEeaMember: true,
    isSupported: true,
    standardVatPercent: 22,
  },
  {
    code: 'DK',
    name: 'Denmark',
    currency: 'DKK',
    isEuMember: true,
    isEeaMember: true,
    isSupported: true,
    standardVatPercent: 25,
  },

  // ── Modelled, not yet selectable as a delivery destination ────────────────
  // EU members named by store delivery rules. Adding them as codes keeps those
  // rules expressible and truthful; they are simply not offered as destinations.
  {
    code: 'BE',
    name: 'Belgium',
    currency: 'EUR',
    isEuMember: true,
    isEeaMember: true,
    isSupported: false,
    standardVatPercent: 21,
  },
  {
    code: 'PT',
    name: 'Portugal',
    currency: 'EUR',
    isEuMember: true,
    isEeaMember: true,
    isSupported: false,
    standardVatPercent: 23,
  },
  {
    code: 'AT',
    name: 'Austria',
    currency: 'EUR',
    isEuMember: true,
    isEeaMember: true,
    isSupported: false,
    standardVatPercent: 20,
  },

  // Outside the EU customs union: import VAT and customs duty behave
  // differently, which is why they are modelled separately and early.
  {
    code: 'NO',
    name: 'Norway',
    currency: 'NOK',
    isEuMember: false,
    isEeaMember: true,
    isSupported: false,
    standardVatPercent: 25,
  },
  {
    code: 'CH',
    name: 'Switzerland',
    currency: 'CHF',
    isEuMember: false,
    isEeaMember: false,
    isSupported: false,
    standardVatPercent: 8.1,
  },
  {
    code: 'GB',
    name: 'United Kingdom',
    currency: 'GBP',
    isEuMember: false,
    isEeaMember: false,
    isSupported: false,
    standardVatPercent: 20,
  },
] as const satisfies readonly CountryDefinition[];

const COUNTRY_BY_CODE = new Map<string, CountryDefinition>(
  COUNTRIES.map((country) => [country.code, country]),
);

/** Destinations a user may actually select. */
export const SUPPORTED_COUNTRY_CODES: readonly CountryCode[] = COUNTRIES.filter(
  (country) => country.isSupported,
).map((country) => country.code);

export const DEFAULT_COUNTRY_CODE: CountryCode = 'FI';

/** Nordic countries, for the "Nordic stores" region filter. */
export const NORDIC_COUNTRY_CODES: readonly CountryCode[] = ['FI', 'SE', 'DK', 'NO'];

export function findCountry(code: string): CountryDefinition | null {
  return COUNTRY_BY_CODE.get(code) ?? null;
}

export function isCountryCode(value: string): value is CountryCode {
  return COUNTRY_BY_CODE.has(value);
}

export function isSupportedCountry(code: string): boolean {
  return findCountry(code)?.isSupported ?? false;
}

/**
 * The country's name, always. Never a flag on its own.
 *
 * Flags are not a substitute for a name: several are visually near-identical at
 * small sizes, they are not announced usefully by screen readers, and a handful
 * carry political weight that a shopping tool has no business asserting.
 */
export function countryName(code: string): string {
  return findCountry(code)?.name ?? code;
}

export function currencyForCountry(code: string): Currency | null {
  return findCountry(code)?.currency ?? null;
}

// ── Store regions ───────────────────────────────────────────────────────────

export const STORE_REGIONS = ['local', 'nordic', 'european'] as const;
export const storeRegionSchema = z.enum(STORE_REGIONS);
export type StoreRegion = z.infer<typeof storeRegionSchema>;

export const DEFAULT_STORE_REGION: StoreRegion = 'local';

/**
 * Which store countries a region setting admits, given where the shopper is.
 *
 * The region filter is computed from the destination rather than read off
 * `Store.region`, because "local" has to mean *local to me*. A German store is
 * local to a German shopper and foreign to a Finnish one; no single column on
 * the store can express that.
 *
 * `Store.region` still exists and still means something — it records the
 * breadth of a store's own declared delivery network, which is what the store
 * listing displays. It is not what search filters on.
 *
 * Note that `local` with a Finnish destination admits Finnish stores only. That
 * is what makes the default behaviour identical to the pre-expansion product.
 */
export function storeCountriesForRegion(
  region: StoreRegion,
  destination: CountryCode,
): readonly CountryCode[] {
  switch (region) {
    case 'local':
      return [destination];
    case 'nordic': {
      // The destination is always included, even when it is not Nordic —
      // "Nordic stores" must not exclude the shopper's own country.
      const codes = new Set<CountryCode>(NORDIC_COUNTRY_CODES);
      codes.add(destination);
      return [...codes];
    }
    case 'european':
      return SUPPORTED_COUNTRY_CODES;
  }
}

// ── Tax and duty ────────────────────────────────────────────────────────────

export const IMPORT_DUTY_STATUSES = ['NONE', 'INCLUDED', 'POSSIBLE', 'UNKNOWN'] as const;
export const importDutyStatusSchema = z.enum(IMPORT_DUTY_STATUSES);
export type ImportDutyStatus = z.infer<typeof importDutyStatusSchema>;

/**
 * Whether an order can attract customs duty or import VAT.
 *
 * Deliberately coarse. Real duty depends on commodity code, declared value,
 * origin of manufacture and trade agreements, none of which this application
 * knows. So it answers the only question it honestly can: *might* there be a
 * charge the displayed total does not contain?
 *
 * `POSSIBLE` is not `UNKNOWN`. `POSSIBLE` means "we know the shipment crosses a
 * customs border, so a charge is likely and we are telling you"; `UNKNOWN` means
 * "we could not determine the route at all". Collapsing them would either hide a
 * real warning or cry wolf on every domestic order.
 */
export function importDutyStatusFor(
  storeCountry: string,
  destinationCountry: string,
): ImportDutyStatus {
  const from = findCountry(storeCountry);
  const to = findCountry(destinationCountry);
  if (from == null || to == null) return 'UNKNOWN';

  if (from.code === to.code) return 'NONE';

  // Within the EU customs union goods move without duty or import VAT, and
  // consumer prices already include destination VAT under the OSS rules.
  if (from.isEuMember && to.isEuMember) return 'NONE';

  return 'POSSIBLE';
}

/**
 * Whether the store's displayed price can be taken to already include the tax
 * the shopper will owe.
 *
 * True for EU-to-EU consumer sales. False when the shipment crosses the customs
 * border, where import VAT is normally collected from the buyer on delivery and
 * is therefore *not* in the price shown.
 */
export function taxesIncludedFor(
  storeCountry: string,
  destinationCountry: string,
): boolean | null {
  const from = findCountry(storeCountry);
  const to = findCountry(destinationCountry);
  if (from == null || to == null) return null;
  if (from.code === to.code) return true;
  return from.isEuMember && to.isEuMember;
}

export function isCrossBorder(storeCountry: string, destinationCountry: string): boolean {
  return storeCountry !== destinationCountry;
}

/** True when the route leaves or enters the EU customs union. */
export function isNonEuRoute(storeCountry: string, destinationCountry: string): boolean {
  const from = findCountry(storeCountry);
  const to = findCountry(destinationCountry);
  if (from == null || to == null) return true;
  return !from.isEuMember || !to.isEuMember;
}
