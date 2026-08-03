import { describe, expect, it } from 'vitest';
import {
  brandKey,
  hasIdentifierConflict,
  matchIdentifiers,
  normaliseEan,
  normaliseGtin,
  normaliseIdentifiers,
  normaliseModelNumber,
  normaliseMpn,
} from './identifiers';

/** Real GS1 check digits, so the validator is tested against arithmetic and not itself. */
const VALID_EAN13 = '4548736132443';
const VALID_EAN8 = '96385074';
const VALID_UPC12 = '036000291452';

describe('normaliseGtin', () => {
  it('accepts a valid EAN-13 and pads it to the 14-digit GTIN', () => {
    expect(normaliseGtin(VALID_EAN13)).toBe(`0${VALID_EAN13}`);
  });

  it('pads a UPC-A to the same 14-digit key, so the two encodings meet', () => {
    expect(normaliseGtin(VALID_UPC12)).toBe(`00${VALID_UPC12}`);
  });

  it('accepts an EAN-8', () => {
    expect(normaliseGtin(VALID_EAN8)).toBe(VALID_EAN8.padStart(14, '0'));
  });

  it('ignores formatting a store may have added', () => {
    expect(normaliseGtin('4548736-132443')).toBe(`0${VALID_EAN13}`);
    expect(normaliseGtin(' 4548736 132443 ')).toBe(`0${VALID_EAN13}`);
  });

  // A wrong check digit is a typo, and a typo accepted as an identifier
  // produces a *confident* wrong merge. Rejecting is the only safe answer.
  it('rejects a bad check digit', () => {
    expect(normaliseGtin('4548736132444')).toBeNull();
  });

  it.each([null, undefined, '', 'not-a-number', '123', '12345678901234567'])(
    'rejects %s rather than throwing',
    (input) => {
      expect(normaliseGtin(input as string | null | undefined)).toBeNull();
    },
  );

  it('rejects a length GS1 does not define', () => {
    expect(normaliseGtin('1234567890')).toBeNull();
  });
});

describe('normaliseEan', () => {
  it('keeps the published 13- or 8-digit form', () => {
    expect(normaliseEan(VALID_EAN13)).toBe(VALID_EAN13);
    expect(normaliseEan(VALID_EAN8)).toBe(VALID_EAN8);
  });

  it('rejects a 12-digit UPC, which is not an EAN', () => {
    expect(normaliseEan(VALID_UPC12)).toBeNull();
  });
});

describe('normaliseMpn', () => {
  it('uppercases and strips separators', () => {
    expect(normaliseMpn('wh-1000xm5/b')).toBe('WH1000XM5B');
  });

  it('rejects values too short to be an identifier', () => {
    expect(normaliseMpn('A1')).toBeNull();
    expect(normaliseMpn('12')).toBeNull();
  });

  it('rejects short all-numeric values, which are shelf codes not part numbers', () => {
    expect(normaliseMpn('123')).toBeNull();
    expect(normaliseMpn('1234')).toBe('1234');
  });
});

describe('normaliseModelNumber', () => {
  it('uppercases and strips separators', () => {
    expect(normaliseModelNumber('wh-1000xm5')).toBe('WH1000XM5');
    expect(normaliseModelNumber('OLED55C5.4LA')).toBe('OLED55C54LA');
  });

  it('requires a letter and a digit, or four digits', () => {
    expect(normaliseModelNumber('PRO')).toBeNull();
    expect(normaliseModelNumber('C5')).toBe('C5');
    expect(normaliseModelNumber('12345')).toBe('12345');
  });

  // The single most important guard in stage 1. Without the stoplist, "128GB"
  // becomes a model number and every 128 GB device on the market merges.
  it.each([
    '128GB',
    '512 GB',
    '1TB',
    '4K',
    '8K',
    'FHD',
    'UHD',
    'USBC',
    'HDMI2',
    'BLUETOOTH5',
    'WIFI6',
    '2024',
    '1997',
    '165HZ',
    '24000MAH',
    '250OHM',
    '45MM',
    '140W',
    '4200PA',
  ])('refuses to treat %s as a model number', (input) => {
    expect(normaliseModelNumber(input)).toBeNull();
  });

  it('still accepts genuine model numbers that contain digits and letters', () => {
    expect(normaliseModelNumber('QE65Q70DATXXC')).toBe('QE65Q70DATXXC');
    expect(normaliseModelNumber('XM5')).toBe('XM5');
  });
});

describe('brandKey', () => {
  it('lowercases, folds diacritics and collapses whitespace', () => {
    expect(brandKey('  SONY  ')).toBe('sony');
    expect(brandKey('Hewlett  Packard')).toBe('hewlett packard');
  });

  it('returns null for nothing usable', () => {
    expect(brandKey(null)).toBeNull();
    expect(brandKey('   ')).toBeNull();
  });
});

describe('normaliseIdentifiers', () => {
  it('carries an EAN into the GTIN slot, so the two publishing styles meet', () => {
    const onlyEan = normaliseIdentifiers({ ean: VALID_EAN13 });
    const onlyGtin = normaliseIdentifiers({ gtin: VALID_EAN13 });
    expect(onlyEan.gtin).toBe(onlyGtin.gtin);
    expect(onlyEan.ean).toBe(onlyGtin.ean);
  });
});

describe('matchIdentifiers', () => {
  const base = { gtin: null, ean: null, mpn: null, modelNumber: null, brandKey: null };

  it('scores an exact GTIN agreement at 100', () => {
    const match = matchIdentifiers(
      { ...base, gtin: '04548736132443' },
      { ...base, gtin: '04548736132443' },
    );
    expect(match).toMatchObject({ kind: 'gtin', score: 100, method: 'IDENTIFIER' });
  });

  it('scores brand + MPN just below an outright GTIN match', () => {
    const match = matchIdentifiers(
      { ...base, brandKey: 'sony', mpn: 'WH1000XM5B' },
      { ...base, brandKey: 'sony', mpn: 'WH1000XM5B' },
    );
    expect(match).toMatchObject({ kind: 'mpn', score: 98 });
  });

  it('requires the brand to agree before trusting an MPN', () => {
    expect(
      matchIdentifiers(
        { ...base, brandKey: 'sony', mpn: 'X100' },
        { ...base, brandKey: 'philips', mpn: 'X100' },
      ),
    ).toBeNull();
  });

  it('scores brand + model + category as a model match', () => {
    const match = matchIdentifiers(
      { ...base, brandKey: 'lg', modelNumber: 'OLED55C5', category: 'televisions' },
      { ...base, brandKey: 'lg', modelNumber: 'OLED55C5', category: 'televisions' },
    );
    expect(match).toMatchObject({ kind: 'model', score: 92, method: 'MODEL' });
  });

  it('returns null when neither side publishes anything comparable', () => {
    expect(matchIdentifiers(base, base)).toBeNull();
  });

  it('produces a human-readable detail for every hit', () => {
    const match = matchIdentifiers(
      { ...base, gtin: '04548736132443' },
      { ...base, gtin: '04548736132443' },
    );
    expect(match?.detail).toMatch(/GTIN 04548736132443/);
  });
});

describe('hasIdentifierConflict', () => {
  const base = { gtin: null, ean: null, mpn: null, modelNumber: null, brandKey: null };

  it('is true when both publish a GTIN and they differ', () => {
    expect(
      hasIdentifierConflict({ ...base, gtin: '1' }, { ...base, gtin: '2' }),
    ).toBe(true);
  });

  // Silence is not disagreement: one store simply not publishing a code says
  // nothing about whether the products are the same.
  it('is false when only one side publishes an identifier', () => {
    expect(hasIdentifierConflict({ ...base, gtin: '1' }, base)).toBe(false);
  });
});
