import { calculateDiscountPercent, calculatePriceStatistics } from '@deal-finder/shared';
import { describe, expect, it } from 'vitest';
import { ProviderError, ProviderNotFoundError } from '../errors';
import { gigantiDataset } from './data/gigantti';
import { powerDataset } from './data/power';
import { verkkokauppaDataset } from './data/verkkokauppa';
import { generatePriceHistory } from './history';
import { createMockProvider } from './mock-provider';

const ALL_DATASETS = [gigantiDataset, powerDataset, verkkokauppaDataset];
const provider = createMockProvider(gigantiDataset, { minLatencyMs: 0, maxLatencyMs: 0 });

describe('sample catalogue integrity', () => {
  it('has a unique external id per store and a full complement of products', () => {
    for (const dataset of ALL_DATASETS) {
      const ids = dataset.products.map((product) => product.externalId);
      expect(new Set(ids).size, `${dataset.slug} has duplicate ids`).toBe(ids.length);
      expect(dataset.products.length).toBeGreaterThanOrEqual(14);
    }
  });

  it('never claims an original price at or below the current price', () => {
    for (const dataset of ALL_DATASETS) {
      for (const product of dataset.products) {
        if (product.originalPrice != null) {
          expect(product.originalPrice, `${product.externalId}`).toBeGreaterThan(
            product.currentPrice,
          );
        }
      }
    }
  });

  it('covers the price patterns the deal-quality scoring needs to be visible', () => {
    const patterns = new Set(
      ALL_DATASETS.flatMap((dataset) => dataset.products.map((product) => product.history.pattern)),
    );
    // A fake permanent sale, a rising price and a genuine all-time low must all
    // be present, or a fresh install shows no interesting scoring at all.
    expect(patterns).toContain('permanent-sale');
    expect(patterns).toContain('rising');
    expect(patterns).toContain('dropped-to-low');
    expect(patterns).toContain('declining');
  });

  it('supports the briefed example searches', () => {
    const all = ALL_DATASETS.flatMap((dataset) => dataset.products);

    // "Philips headphones with at least 30% discount"
    const philips = all.filter(
      (product) =>
        product.brand === 'Philips' &&
        product.category === 'headphones' &&
        calculateDiscountPercent(product.currentPrice, product.originalPrice) >= 30,
    );
    expect(philips.length).toBeGreaterThan(0);

    // "Laptop under €1,000"
    const laptops = all.filter(
      (product) => product.category === 'laptops' && product.currentPrice < 1000,
    );
    expect(laptops.length).toBeGreaterThan(0);
  });
});

describe('searchProducts', () => {
  it('returns the whole catalogue for an empty query', async () => {
    const results = await provider.searchProducts({});
    expect(results).toHaveLength(gigantiDataset.products.length);
  });

  it('filters by category', async () => {
    const results = await provider.searchProducts({ category: 'headphones' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((product) => product.category === 'headphones')).toBe(true);
  });

  it('filters by maximum price', async () => {
    const results = await provider.searchProducts({ maximumPrice: 300 });
    expect(results.every((product) => product.currentPrice <= 300)).toBe(true);
  });

  it('filters by minimum discount', async () => {
    const results = await provider.searchProducts({ minimumDiscount: 30 });
    expect(results.length).toBeGreaterThan(0);
    for (const product of results) {
      expect(calculateDiscountPercent(product.currentPrice, product.originalPrice)).toBeGreaterThanOrEqual(30);
    }
  });

  // "philips headphones" must not return every pair of headphones.
  it('requires every search term to match', async () => {
    const results = await provider.searchProducts({ query: 'philips headphones' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((product) => product.brand === 'Philips')).toBe(true);
  });

  it('honours the limit', async () => {
    const results = await provider.searchProducts({ limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('returns an empty array rather than throwing when nothing matches', async () => {
    expect(await provider.searchProducts({ query: 'definitely-not-a-product' })).toEqual([]);
  });

  it('reports null shipping distinctly from free shipping', async () => {
    const vkk = createMockProvider(verkkokauppaDataset, { minLatencyMs: 0, maxLatencyMs: 0 });
    const results = await vkk.searchProducts({ query: 'marshall' });
    expect(results[0]?.shippingPrice).toBeNull();
  });
});

describe('getProductDetails', () => {
  it('resolves by full product URL and includes history hints', async () => {
    const url = gigantiDataset.productUrlTemplate.replace('{id}', 'gig-sony-wh1000xm5');
    const details = await provider.getProductDetails(url);

    expect(details.externalId).toBe('gig-sony-wh1000xm5');
    expect(details.description).toBeTruthy();
    expect(details.priceHistoryHints?.length).toBeGreaterThan(30);
  });

  it('also resolves by bare external id', async () => {
    const details = await provider.getProductDetails('gig-ps5-slim-1tb');
    expect(details.externalId).toBe('gig-ps5-slim-1tb');
  });

  it('throws a typed, non-retryable error for an unknown product', async () => {
    await expect(provider.getProductDetails('https://example.test/nope')).rejects.toBeInstanceOf(
      ProviderNotFoundError,
    );
    await expect(provider.getProductDetails('nope')).rejects.toMatchObject({ retryable: false });
  });
});

describe('failure injection', () => {
  it('fails when configured to, with a retryable error', async () => {
    const flaky = createMockProvider(gigantiDataset, {
      minLatencyMs: 0,
      maxLatencyMs: 0,
      failureRate: 1,
      random: () => 0,
    });
    await expect(flaky.searchProducts({})).rejects.toBeInstanceOf(ProviderError);
    await expect(flaky.searchProducts({})).rejects.toMatchObject({ retryable: true });
  });
});

describe('generated history', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');

  it('is deterministic for a given product id', () => {
    const spec = { pattern: 'declining' as const, days: 30, startPrice: 200 };
    expect(generatePriceHistory('abc', 150, spec, now)).toEqual(
      generatePriceHistory('abc', 150, spec, now),
    );
  });

  it('differs between products', () => {
    const spec = { pattern: 'steady' as const, days: 30, startPrice: 200 };
    expect(generatePriceHistory('abc', 200, spec, now)).not.toEqual(
      generatePriceHistory('xyz', 200, spec, now),
    );
  });

  it('always ends exactly at the current price', () => {
    for (const pattern of ['steady', 'declining', 'rising', 'volatile', 'spiked'] as const) {
      const points = generatePriceHistory('p', 123.45, { pattern, days: 40, startPrice: 200 }, now);
      expect(points[points.length - 1]?.price).toBe(123.45);
      expect(points[points.length - 1]?.recordedAt).toBe(now.toISOString());
    }
  });

  it('never generates a non-positive price', () => {
    const points = generatePriceHistory('p', 5, { pattern: 'volatile', days: 60, startPrice: 8 }, now);
    expect(points.every((point) => point.price >= 1)).toBe(true);
  });

  // The permanent-sale pattern must actually trip the fake-discount detector:
  // its recorded average has to sit essentially at the "discounted" price.
  it('makes permanent-sale history indistinguishable from the normal price', () => {
    const points = generatePriceHistory('fake', 349, { pattern: 'permanent-sale', days: 120 }, now);
    const stats = calculatePriceStatistics(points);
    expect(stats.average).not.toBeNull();
    expect(349).toBeGreaterThanOrEqual((stats.average ?? 0) * 0.98);
    expect(stats.sampleSize).toBeGreaterThanOrEqual(5);
  });

  it('makes dropped-to-low history end at an all-time low', () => {
    const points = generatePriceHistory('low', 1049, { pattern: 'dropped-to-low', days: 130, startPrice: 1470 }, now);
    const stats = calculatePriceStatistics(points);
    expect(stats.lowest).toBe(1049);
  });
});
