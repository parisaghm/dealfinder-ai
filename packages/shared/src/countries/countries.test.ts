import { describe, expect, it } from 'vitest';
import { CURRENCIES } from '../schemas/common';
import {
  COUNTRIES,
  COUNTRY_CODES,
  DEFAULT_COUNTRY_CODE,
  DEFAULT_STORE_REGION,
  SUPPORTED_COUNTRY_CODES,
  countryName,
  currencyForCountry,
  findCountry,
  importDutyStatusFor,
  isCountryCode,
  isCrossBorder,
  isNonEuRoute,
  isSupportedCountry,
  storeCountriesForRegion,
  taxesIncludedFor,
} from './countries';

describe('the country table', () => {
  it('holds fourteen countries, eight of them supported', () => {
    // These two numbers are asserted by the API integration tests and by
    // GET /api/countries. Changing the table must be a deliberate act.
    expect(COUNTRIES).toHaveLength(14);
    expect(SUPPORTED_COUNTRY_CODES).toHaveLength(8);
  });

  it('supports exactly the eight briefed destinations', () => {
    expect([...SUPPORTED_COUNTRY_CODES].sort()).toEqual([
      'DE',
      'DK',
      'ES',
      'FI',
      'FR',
      'IT',
      'NL',
      'SE',
    ]);
  });

  it('models Norway, Switzerland and the United Kingdom without supporting them', () => {
    for (const code of ['NO', 'CH', 'GB'] as const) {
      expect(findCountry(code)).not.toBeNull();
      expect(isSupportedCountry(code)).toBe(false);
    }
  });

  it('models Belgium, Portugal and Austria so store delivery rules can name them', () => {
    for (const code of ['BE', 'PT', 'AT'] as const) {
      expect(isCountryCode(code)).toBe(true);
      expect(isSupportedCountry(code)).toBe(false);
    }
  });

  it('keeps COUNTRY_CODES in exact correspondence with COUNTRIES', () => {
    // The tuple is declared by hand for z.enum's benefit; this is the guard.
    expect(COUNTRIES.map((country) => country.code)).toEqual([...COUNTRY_CODES]);
  });

  it('has no duplicate codes or names', () => {
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    expect(new Set(COUNTRIES.map((c) => c.name)).size).toBe(COUNTRIES.length);
  });

  it('names a currency that the currency enum actually knows', () => {
    for (const country of COUNTRIES) {
      expect(CURRENCIES).toContain(country.currency);
    }
  });

  it('treats every EU member as an EEA member too', () => {
    for (const country of COUNTRIES) {
      if (country.isEuMember) expect(country.isEeaMember).toBe(true);
    }
  });

  it('carries a plausible standard VAT rate for every country', () => {
    for (const country of COUNTRIES) {
      expect(country.standardVatPercent).toBeGreaterThan(0);
      expect(country.standardVatPercent).toBeLessThan(30);
    }
  });

  it('defaults to Finland and to local stores, preserving the original product', () => {
    expect(DEFAULT_COUNTRY_CODE).toBe('FI');
    expect(DEFAULT_STORE_REGION).toBe('local');
  });

  it('rejects an unknown code', () => {
    expect(isCountryCode('XX')).toBe(false);
    expect(findCountry('XX')).toBeNull();
    expect(currencyForCountry('XX')).toBeNull();
  });
});

describe('countryName', () => {
  it('returns the full name, never only a code', () => {
    expect(countryName('FI')).toBe('Finland');
    expect(countryName('DE')).toBe('Germany');
    expect(countryName('GB')).toBe('United Kingdom');
  });

  it('falls back to the code rather than rendering nothing', () => {
    expect(countryName('XX')).toBe('XX');
  });
});

describe('storeCountriesForRegion', () => {
  it('admits only the destination for the local region', () => {
    // This is what makes region=local + country=FI identical to the
    // pre-expansion Finland-only product.
    expect(storeCountriesForRegion('local', 'FI')).toEqual(['FI']);
    expect(storeCountriesForRegion('local', 'DE')).toEqual(['DE']);
  });

  it('admits the Nordics for the nordic region', () => {
    expect([...storeCountriesForRegion('nordic', 'FI')].sort()).toEqual(['DK', 'FI', 'NO', 'SE']);
  });

  it('includes the destination in the nordic region even when it is not Nordic', () => {
    // "Nordic stores" must not exclude the shopper's own country.
    expect(storeCountriesForRegion('nordic', 'DE')).toContain('DE');
  });

  it('admits every supported country for the european region', () => {
    expect([...storeCountriesForRegion('european', 'FI')].sort()).toEqual([
      ...SUPPORTED_COUNTRY_CODES,
    ].sort());
  });

  it('never returns duplicates', () => {
    for (const region of ['local', 'nordic', 'european'] as const) {
      const codes = storeCountriesForRegion(region, 'FI');
      expect(new Set(codes).size).toBe(codes.length);
    }
  });
});

describe('importDutyStatusFor', () => {
  it('is NONE for a domestic order', () => {
    expect(importDutyStatusFor('FI', 'FI')).toBe('NONE');
  });

  it('is NONE anywhere inside the EU customs union', () => {
    expect(importDutyStatusFor('DE', 'FI')).toBe('NONE');
    expect(importDutyStatusFor('FR', 'ES')).toBe('NONE');
    expect(importDutyStatusFor('SE', 'DK')).toBe('NONE');
  });

  it('is POSSIBLE when the shipment leaves the EU', () => {
    expect(importDutyStatusFor('DE', 'NO')).toBe('POSSIBLE');
    expect(importDutyStatusFor('FR', 'CH')).toBe('POSSIBLE');
  });

  it('is POSSIBLE when the shipment enters the EU', () => {
    expect(importDutyStatusFor('GB', 'FI')).toBe('POSSIBLE');
    expect(importDutyStatusFor('CH', 'IT')).toBe('POSSIBLE');
  });

  it('is POSSIBLE between two non-EU countries', () => {
    expect(importDutyStatusFor('GB', 'CH')).toBe('POSSIBLE');
  });

  it('is UNKNOWN, not NONE, when a country cannot be identified', () => {
    // Defaulting an unrecognised route to NONE would suppress a real warning.
    expect(importDutyStatusFor('XX', 'FI')).toBe('UNKNOWN');
    expect(importDutyStatusFor('FI', 'XX')).toBe('UNKNOWN');
  });

  it('distinguishes POSSIBLE from UNKNOWN', () => {
    // POSSIBLE means "we know it crosses a customs border"; UNKNOWN means "we
    // could not tell". Collapsing them would either hide a warning or cry wolf.
    expect(importDutyStatusFor('GB', 'FI')).not.toBe(importDutyStatusFor('XX', 'FI'));
  });
});

describe('taxesIncludedFor', () => {
  it('is true for a domestic order', () => {
    expect(taxesIncludedFor('FI', 'FI')).toBe(true);
  });

  it('is true across the EU, where consumer prices include destination VAT', () => {
    expect(taxesIncludedFor('DE', 'FI')).toBe(true);
  });

  it('is false when import VAT will be collected on delivery instead', () => {
    expect(taxesIncludedFor('GB', 'FI')).toBe(false);
    expect(taxesIncludedFor('DE', 'CH')).toBe(false);
  });

  it('is null rather than false for an unidentifiable route', () => {
    // null means "we do not know", which the UI must render differently from
    // "tax is not included".
    expect(taxesIncludedFor('XX', 'FI')).toBeNull();
  });
});

describe('route helpers', () => {
  it('detects a cross-border route', () => {
    expect(isCrossBorder('DE', 'FI')).toBe(true);
    expect(isCrossBorder('FI', 'FI')).toBe(false);
  });

  it('detects a route that leaves the EU customs union', () => {
    expect(isNonEuRoute('DE', 'FI')).toBe(false);
    expect(isNonEuRoute('GB', 'FI')).toBe(true);
    expect(isNonEuRoute('DE', 'NO')).toBe(true);
  });

  it('treats an unidentifiable route as non-EU rather than assuming it is safe', () => {
    expect(isNonEuRoute('XX', 'FI')).toBe(true);
  });
});
