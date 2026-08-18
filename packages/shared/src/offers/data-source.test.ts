import { describe, expect, it } from 'vitest';
import {
  asDataSourceType,
  canOpenExternalDeal,
  DATA_SOURCE_TYPES,
  isDemoDataSource,
  isKnownDataSource,
  isPresentableProductUrl,
  leastTrustedDataSource,
} from './data-source';

/** A real retailer URL shape — the positive case has to look like production. */
const REAL_URL = 'https://www.gigantti.fi/product/sony-wh-1000xm5';

describe('isDemoDataSource', () => {
  it('is true only for bundled sample data', () => {
    expect(isDemoDataSource('mock')).toBe(true);
  });

  it('is false for every source that involved a fetch', () => {
    for (const kind of DATA_SOURCE_TYPES.filter((k) => k !== 'mock')) {
      expect(isDemoDataSource(kind)).toBe(false);
    }
  });

  // "Demo" is a claim about the data, so we must not make it about a value we do
  // not recognise. Unknown is its own state, handled by canOpenExternalDeal.
  it('does not claim an unrecognised source is demo data', () => {
    expect(isDemoDataSource('affiliate_feed_v2')).toBe(false);
    expect(isDemoDataSource(null)).toBe(false);
    expect(isDemoDataSource(undefined)).toBe(false);
  });
});

describe('isKnownDataSource', () => {
  it('recognises every declared source kind', () => {
    for (const kind of DATA_SOURCE_TYPES) {
      expect(isKnownDataSource(kind)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(isKnownDataSource('LIVE_API')).toBe(false);
    expect(isKnownDataSource('')).toBe(false);
    expect(isKnownDataSource(null)).toBe(false);
    expect(isKnownDataSource(undefined)).toBe(false);
  });

  it('narrows through asDataSourceType, returning null rather than guessing', () => {
    expect(asDataSourceType('api')).toBe('api');
    expect(asDataSourceType('nonsense')).toBeNull();
    expect(asDataSourceType(null)).toBeNull();
  });
});

describe('isPresentableProductUrl', () => {
  it('accepts an absolute http(s) URL on a real host', () => {
    expect(isPresentableProductUrl(REAL_URL)).toBe(true);
    expect(isPresentableProductUrl('http://www.power.fi/tuote/123')).toBe(true);
  });

  it('rejects a missing or blank URL', () => {
    expect(isPresentableProductUrl(null)).toBe(false);
    expect(isPresentableProductUrl(undefined)).toBe(false);
    expect(isPresentableProductUrl('')).toBe(false);
    expect(isPresentableProductUrl('   ')).toBe(false);
  });

  it('rejects a relative path, which cannot be opened as an external deal', () => {
    expect(isPresentableProductUrl('/product/123')).toBe(false);
    expect(isPresentableProductUrl('www.gigantti.fi/product/123')).toBe(false);
  });

  // A non-http scheme behind a "View deal" button is a script-injection vector,
  // not a shop.
  it('rejects non-http schemes', () => {
    expect(isPresentableProductUrl('javascript:alert(1)')).toBe(false);
    expect(isPresentableProductUrl('data:text/html,hi')).toBe(false);
    expect(isPresentableProductUrl('ftp://example.org/p')).toBe(false);
  });

  // The seven synthetic stores live on *.example for exactly this reason.
  it('rejects reserved hostnames that can never be a real shop', () => {
    expect(isPresentableProductUrl('https://techhalle.example/produkt/1')).toBe(false);
    expect(isPresentableProductUrl('https://store.test/p/ext-1')).toBe(false);
    expect(isPresentableProductUrl('https://shop.invalid/p/1')).toBe(false);
    expect(isPresentableProductUrl('http://localhost:5173/p/1')).toBe(false);
    expect(isPresentableProductUrl('https://app.localhost/p/1')).toBe(false);
  });

  it('does not reject a real host that merely contains a reserved word', () => {
    expect(isPresentableProductUrl('https://www.example-store.fi/p/1')).toBe(true);
    expect(isPresentableProductUrl('https://testers.fi/p/1')).toBe(true);
  });
});

describe('canOpenExternalDeal', () => {
  it('never links a demo offer, however valid its URL looks', () => {
    expect(canOpenExternalDeal({ dataSourceType: 'mock', productUrl: REAL_URL })).toBe(false);
  });

  it('links every verified source when the URL is usable', () => {
    for (const kind of ['api', 'affiliate-feed', 'merchant-feed', 'structured-data', 'browser']) {
      expect(canOpenExternalDeal({ dataSourceType: kind, productUrl: REAL_URL })).toBe(true);
    }
  });

  it('fails closed on an unknown source type', () => {
    expect(canOpenExternalDeal({ dataSourceType: 'LIVE_API', productUrl: REAL_URL })).toBe(false);
    expect(canOpenExternalDeal({ dataSourceType: 'partner-xml', productUrl: REAL_URL })).toBe(
      false,
    );
  });

  it('fails closed when the source is absent entirely', () => {
    expect(canOpenExternalDeal({ productUrl: REAL_URL })).toBe(false);
    expect(canOpenExternalDeal({ dataSourceType: null, productUrl: REAL_URL })).toBe(false);
    expect(canOpenExternalDeal({ dataSourceType: '', productUrl: REAL_URL })).toBe(false);
  });

  it('refuses a verified source with an unusable URL', () => {
    expect(canOpenExternalDeal({ dataSourceType: 'api', productUrl: null })).toBe(false);
    expect(canOpenExternalDeal({ dataSourceType: 'api', productUrl: '/relative' })).toBe(false);
    expect(
      canOpenExternalDeal({ dataSourceType: 'api', productUrl: 'https://a.example/p' }),
    ).toBe(false);
  });

  it('refuses an empty offer', () => {
    expect(canOpenExternalDeal({})).toBe(false);
  });
});

describe('leastTrustedDataSource', () => {
  it('keeps the value when both agree', () => {
    expect(leastTrustedDataSource('api', 'api')).toBe('api');
    expect(leastTrustedDataSource('mock', 'mock')).toBe('mock');
  });

  // The hole this closes: a live quote attached to a fixture-seeded listing.
  it('degrades to mock when either side is mock, in either order', () => {
    expect(leastTrustedDataSource('api', 'mock')).toBe('mock');
    expect(leastTrustedDataSource('mock', 'api')).toBe('mock');
  });

  it('never lets a trusted quote lift a demo listing into a link', () => {
    const resolved = leastTrustedDataSource('api', 'mock');
    expect(
      canOpenExternalDeal({ dataSourceType: resolved, productUrl: REAL_URL }),
    ).toBe(false);
  });

  it('surfaces an unrecognised value rather than masking it', () => {
    expect(leastTrustedDataSource('api', 'partner-xml')).toBe('partner-xml');
    expect(leastTrustedDataSource('partner-xml', 'api')).toBe('partner-xml');
    expect(leastTrustedDataSource('api', null)).toBe('');
    expect(leastTrustedDataSource(undefined, 'api')).toBe('');
  });

  it('produces a value that fails closed whenever either input was untrusted', () => {
    for (const pair of [
      ['api', 'partner-xml'],
      ['api', null],
      [undefined, 'browser'],
      ['mock', 'structured-data'],
    ] as const) {
      const resolved = leastTrustedDataSource(pair[0], pair[1]);
      expect(canOpenExternalDeal({ dataSourceType: resolved, productUrl: REAL_URL })).toBe(false);
    }
  });

  it('keeps a link when both sides are genuinely verified', () => {
    const resolved = leastTrustedDataSource('api', 'structured-data');
    expect(canOpenExternalDeal({ dataSourceType: resolved, productUrl: REAL_URL })).toBe(true);
  });
});
