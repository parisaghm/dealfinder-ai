import {
  COUNTRIES,
  DEFAULT_COUNTRY_CODE,
  type CountriesResponse,
  type Currency,
} from '@deal-finder/shared';

/**
 * `GET /api/countries`
 *
 * Served from the shared table, not from the `countries` database table, because
 * the shared table is the source of truth and the database one is a mirror kept
 * for foreign keys and joins. Reading the mirror would mean the API could offer a
 * destination the type system does not know about — or, worse, that a drifted
 * mirror row silently changed a country's VAT rate or EU membership.
 *
 * No query, so no database round trip. Every modelled country is returned, each
 * saying for itself whether it is selectable: a client needs the full list to
 * explain *why* Norway is visible but not offered, and hiding the unsupported
 * ones would leave that unexplainable.
 */
export function listCountries(): CountriesResponse {
  return {
    items: COUNTRIES.map((country) => ({
      code: country.code,
      name: country.name,
      currency: country.currency as Currency,
      isEuMember: country.isEuMember,
      isEeaMember: country.isEeaMember,
      isSupported: country.isSupported,
      standardVatPercent: country.standardVatPercent,
    })),
    defaultCountry: DEFAULT_COUNTRY_CODE,
  };
}
