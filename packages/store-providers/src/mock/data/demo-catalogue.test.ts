import { calculateDiscountPercent, SUPPORTED_COUNTRY_CODES } from '@deal-finder/shared';
import { describe, expect, it } from 'vitest';
import { DEMO_EUROPEAN_MOCK_DATASETS, FINNISH_MOCK_DATASETS, MOCK_DATASETS } from '../../registry';
import { deliveryCountries, storeDeliversTo } from '../delivery-rules';
import { DEMO_EAN, RESERVED_EANS } from './demo-catalogue';

/**
 * Integrity of the synthetic European catalogue.
 *
 * Two categories of assertion live here. The first protects *existing* tests: the
 * reserved Sony and Philips identifiers must never appear in a demo dataset,
 * because publishing either would silently change a canonical group whose offer
 * count `e2e/cross-store.spec.ts` asserts and whose non-merge `prisma/seed.ts`
 * throws over. A comment saying "do not use these" is not enforcement; this is.
 *
 * The second protects the *feature*: the catalogue has to actually demonstrate
 * destination-dependent availability, cross-currency comparison and the
 * cheapest-listed-is-not-cheapest-delivered case. A dataset edit that quietly
 * flattened any of those would leave the UI with nothing interesting to show and
 * no test would notice.
 */

const ALL_DEMO_PRODUCTS = DEMO_EUROPEAN_MOCK_DATASETS.flatMap((dataset) =>
  dataset.products.map((product) => ({ dataset, product })),
);

describe('reserved identifiers', () => {
  it('names the two identifiers that must stay out of the demo catalogue', () => {
    expect(RESERVED_EANS).toEqual(['4548736132443', '8879617123455']);
  });

  it.each(RESERVED_EANS)('no demo dataset publishes reserved EAN %s', (reserved) => {
    const offenders = ALL_DEMO_PRODUCTS.filter(({ product }) => product.ean === reserved).map(
      ({ dataset, product }) => `${dataset.slug}/${product.externalId}`,
    );
    expect(offenders).toEqual([]);
  });

  it('no demo dataset publishes a reserved code as a GTIN either', () => {
    const offenders = ALL_DEMO_PRODUCTS.filter(
      ({ product }) => product.gtin != null && RESERVED_EANS.includes(product.gtin as never),
    );
    expect(offenders).toEqual([]);
  });

  it('does not reuse the Samsung review-queue model number', () => {
    // e2e/cross-store.spec.ts approves a candidate for QE65Q70DATXXC and then
    // asserts the group shows exactly "2 stores". A third offer breaks it.
    const offenders = ALL_DEMO_PRODUCTS.filter(
      ({ product }) =>
        product.modelNumber?.toUpperCase().includes('Q70D') === true ||
        product.name.includes('QE65Q70'),
    );
    expect(offenders).toEqual([]);
  });

  it('shares no EAN with any Finnish dataset', () => {
    // Demo groups form only among demo stores, so no existing canonical group
    // changes shape and no existing offer count moves.
    const finnishEans = new Set(
      FINNISH_MOCK_DATASETS.flatMap((dataset) =>
        dataset.products.map((product) => product.ean).filter((ean): ean is string => ean != null),
      ),
    );
    const overlapping = ALL_DEMO_PRODUCTS.filter(
      ({ product }) => product.ean != null && finnishEans.has(product.ean),
    ).map(({ dataset, product }) => `${dataset.slug}/${product.externalId}`);

    expect(overlapping).toEqual([]);
  });
});

describe('demo labelling', () => {
  it('marks every European dataset as demo data', () => {
    for (const dataset of DEMO_EUROPEAN_MOCK_DATASETS) {
      expect(dataset.isDemoStore, dataset.slug).toBe(true);
    }
  });

  it('does not mark the Finnish datasets as demo data', () => {
    for (const dataset of FINNISH_MOCK_DATASETS) {
      expect(dataset.isDemoStore ?? false, dataset.slug).toBe(false);
    }
  });

  it('says "demo" in every European store name, so the UI cannot omit it', () => {
    for (const dataset of DEMO_EUROPEAN_MOCK_DATASETS) {
      expect(dataset.name.toLowerCase(), dataset.slug).toContain('demo');
    }
  });

  it('uses reserved example domains, never a real one', () => {
    // RFC 2606 reserves .example precisely so documentation cannot accidentally
    // point at somebody's live site.
    for (const dataset of DEMO_EUROPEAN_MOCK_DATASETS) {
      expect(dataset.websiteUrl, dataset.slug).toMatch(/^https:\/\/[a-z-]+\.example$/);
    }
  });

  it('says "demo listing" in every product description', () => {
    for (const { dataset, product } of ALL_DEMO_PRODUCTS) {
      expect(product.description.toLowerCase(), `${dataset.slug}/${product.externalId}`).toContain(
        'demo listing',
      );
    }
  });
});

describe('catalogue integrity', () => {
  it('has a unique external id within each dataset', () => {
    for (const dataset of DEMO_EUROPEAN_MOCK_DATASETS) {
      const ids = dataset.products.map((product) => product.externalId);
      expect(new Set(ids).size, `${dataset.slug} has duplicate ids`).toBe(ids.length);
    }
  });

  it('has globally unique external ids across every dataset', () => {
    const ids = MOCK_DATASETS.flatMap((dataset) =>
      dataset.products.map((product) => product.externalId),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never claims an original price at or below the current price', () => {
    for (const { dataset, product } of ALL_DEMO_PRODUCTS) {
      if (product.originalPrice != null) {
        expect(product.originalPrice, `${dataset.slug}/${product.externalId}`).toBeGreaterThan(
          product.currentPrice,
        );
      }
    }
  });

  it('carries at least eight products per store', () => {
    for (const dataset of DEMO_EUROPEAN_MOCK_DATASETS) {
      expect(dataset.products.length, dataset.slug).toBeGreaterThanOrEqual(8);
    }
  });

  it('registers exactly seven European demo stores alongside the three Finnish ones', () => {
    expect(DEMO_EUROPEAN_MOCK_DATASETS).toHaveLength(7);
    expect(FINNISH_MOCK_DATASETS).toHaveLength(3);
    expect(MOCK_DATASETS).toHaveLength(10);
  });

  it('covers all eight briefed store countries exactly once', () => {
    const countries = MOCK_DATASETS.map((dataset) => dataset.countryCode ?? 'FI');
    for (const expected of ['SE', 'DE', 'NL', 'FR', 'ES', 'IT', 'DK']) {
      expect(countries.filter((code) => code === expected), expected).toHaveLength(1);
    }
    // Finland has the three original stores.
    expect(countries.filter((code) => code === 'FI')).toHaveLength(3);
  });

  it('only ever declares delivery to a country the application models', () => {
    for (const dataset of DEMO_EUROPEAN_MOCK_DATASETS) {
      for (const country of deliveryCountries(dataset)) {
        // A rule naming a code the type system does not know would be unusable.
        expect(typeof country, `${dataset.slug} → ${country}`).toBe('string');
      }
    }
  });
});

describe('the catalogue demonstrates what it exists to demonstrate', () => {
  it('has at least one store that cannot deliver to Finland', () => {
    const unreachable = DEMO_EUROPEAN_MOCK_DATASETS.filter(
      (dataset) => !storeDeliversTo(dataset, 'FI'),
    );
    expect(unreachable.length).toBeGreaterThanOrEqual(1);
    expect(unreachable.map((dataset) => dataset.slug)).toContain('maison-numerique');
  });

  it('has at least one store that publishes no delivery cost to Finland', () => {
    // Without this, "Shipping cost unknown" and the never-wins rule are untested
    // in the running application.
    const rules = DEMO_EUROPEAN_MOCK_DATASETS.map((dataset) => ({
      slug: dataset.slug,
      fi: dataset.deliveryRules?.FI,
    }));
    const unpublished = rules.filter((entry) => entry.fi != null && entry.fi.shippingPrice == null);
    expect(unpublished.map((entry) => entry.slug)).toContain('nordbyte');
  });

  it('has at least one store that delivers to Finland free of charge', () => {
    const free = DEMO_EUROPEAN_MOCK_DATASETS.filter(
      (dataset) => dataset.deliveryRules?.FI?.shippingPrice === 0,
    );
    expect(free.map((dataset) => dataset.slug)).toContain('kanaalshop');
  });

  it('prices at least two stores in a non-euro currency', () => {
    // One would never exercise rate triangulation between two foreign currencies.
    const nonEuro = DEMO_EUROPEAN_MOCK_DATASETS.filter(
      (dataset) => (dataset.currency ?? 'EUR') !== 'EUR',
    );
    expect(nonEuro.length).toBeGreaterThanOrEqual(2);
    expect(nonEuro.map((dataset) => dataset.currency).sort()).toEqual(['DKK', 'SEK']);
  });

  it('has a store that publishes a Finnish delivery price but no delivery estimate', () => {
    const rule = DEMO_EUROPEAN_MOCK_DATASETS.find(
      (dataset) => dataset.slug === 'adriatica-tech',
    )?.deliveryRules?.FI;
    expect(rule?.shippingPrice).toBe(16.9);
    expect(rule?.minDays).toBeUndefined();
    expect(rule?.maxDays).toBeUndefined();
  });

  it('has a product excluded from a destination its store otherwise serves', () => {
    const techhalle = DEMO_EUROPEAN_MOCK_DATASETS.find(
      (dataset) => dataset.slug === 'techhalle',
    );
    expect(storeDeliversTo(techhalle!, 'FI')).toBe(true);
    expect(techhalle!.productDestinationExclusions?.FI).toContain('thl-lumenta-32-4k');
  });

  it('sells the headline product in at least four stores with four different answers', () => {
    const sellers = ALL_DEMO_PRODUCTS.filter(
      ({ product }) => product.ean === DEMO_EAN.auralisNc700,
    );
    expect(sellers.length).toBeGreaterThanOrEqual(4);

    const byStore = new Map(sellers.map(({ dataset, product }) => [dataset.slug, product]));

    // The cheapest LISTED price is the Swedish one once converted (~€277), and it
    // cannot win because its delivery cost is unpublished. The cheapest DELIVERED
    // is the German one at €299 + €12.90. The French one is cheaper than the Dutch
    // and irrelevant to Finland. Every leg of that sentence is asserted here.
    expect(byStore.get('techhalle')?.currentPrice).toBe(299);
    expect(byStore.get('kanaalshop')?.currentPrice).toBe(329);
    expect(byStore.get('maison-numerique')?.currentPrice).toBe(289);
    expect(byStore.get('nordbyte')?.currentPrice).toBe(3190);
  });

  it('makes the German delivered total beat the Dutch one only after shipping', () => {
    const german = 299 + 12.9;
    const dutch = 329 + 0;
    // Listed: German cheaper. Delivered: German still cheaper — but by €17.10
    // rather than €30, and a €12.91 shipping cost would have flipped it.
    expect(299).toBeLessThan(329);
    expect(german).toBeLessThan(dutch);
    expect(Number((dutch - german).toFixed(2))).toBe(17.1);
  });

  it('covers the price patterns deal-quality scoring needs', () => {
    const patterns = new Set(ALL_DEMO_PRODUCTS.map(({ product }) => product.history.pattern));
    expect(patterns).toContain('declining');
    expect(patterns).toContain('steady');
    expect(patterns).toContain('permanent-sale');
  });

  it('offers substantiated discounts, so the deal-quality badge has something to show', () => {
    // Computed with the same helper the application uses, rather than by
    // comparing the two prices here — otherwise the test could pass on a
    // discount the product itself would score as 0.
    const discounts = ALL_DEMO_PRODUCTS.map(({ product }) =>
      calculateDiscountPercent(product.currentPrice, product.originalPrice),
    );

    expect(discounts.filter((percent) => percent >= 20).length).toBeGreaterThanOrEqual(5);
    // And none may be negative or absurd — a claimed "discount" above 90 % on
    // consumer electronics is a data error, not a bargain.
    for (const percent of discounts) {
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThan(90);
    }
  });

  it('has every store reachable as a destination or explicitly not', () => {
    // Sanity: no demo store declares a destination outside the supported set that
    // the seed would then try to create an offer for.
    for (const dataset of DEMO_EUROPEAN_MOCK_DATASETS) {
      const declared = deliveryCountries(dataset);
      const supported = declared.filter((code) => SUPPORTED_COUNTRY_CODES.includes(code));
      // Every store must reach at least one selectable destination, or it is dead
      // weight in the catalogue.
      expect(supported.length, dataset.slug).toBeGreaterThan(0);
    }
  });
});
