/// <reference lib="dom" />
// The `page.evaluate()` callbacks below execute inside the browser, so they
// reference `document`. Pulling in the DOM lib here keeps it scoped to this
// file: apps/api compiles these sources too, and must NOT get browser globals.
import { registerLiveProviderFactory, type RegistryOptions } from '../registry';
import type { StoreProvider } from '../types';
import { createLiveProvider } from './base-provider';

/**
 * Live store adapters.
 *
 * Importing this module is what turns live mode on, and it is imported from
 * exactly one place — the API's startup path, only when `PROVIDER_MODE=live`.
 * Nothing else in the codebase references it, so the default install never
 * loads Playwright and never issues an outbound request.
 *
 * ⚠️  Read the notice at the top of base-provider.ts and docs/legal-and-ethics.md
 *     before enabling this. Each store's Terms of Service governs whether you
 *     may run it; prefer an official API or affiliate feed.
 *
 * Each adapter below is a thin descriptor. The shared base does the work:
 * robots.txt enforcement, request pacing, JSON-LD extraction, and a rendered
 * fallback. Adding a fourth store is a new descriptor, not new machinery.
 */

/** Selectors are a last resort and *will* break when a site is redesigned. */
export function createLiveProviders(options: RegistryOptions = {}): StoreProvider[] {
  const timeoutMs = options.timeoutMs ?? 15_000;

  return [
    createLiveProvider({
      name: 'Gigantti',
      slug: 'gigantti',
      websiteUrl: 'https://www.gigantti.fi',
      logoUrl: '/images/stores/gigantti.svg',
      timeoutMs,
      minRequestIntervalMs: 2_000,
      readySelector: '[data-testid="product-price"], .product-price',
      async extractFromDom(page) {
        return page.evaluate(() => {
          const text = (selector: string): string | undefined =>
            document.querySelector(selector)?.textContent?.trim() || undefined;

          const priceText = text('[data-testid="product-price"]') ?? text('.product-price');
          const price = priceText
            ? Number.parseFloat(
                priceText.replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'),
              )
            : undefined;

          return {
            name: text('h1'),
            price: Number.isFinite(price) ? price : undefined,
            currency: 'EUR',
          };
        });
      },
    }),

    createLiveProvider({
      name: 'Power',
      slug: 'power',
      websiteUrl: 'https://www.power.fi',
      logoUrl: '/images/stores/power.svg',
      timeoutMs,
      minRequestIntervalMs: 2_000,
      readySelector: '[itemprop="price"], .product-price',
      async extractFromDom(page) {
        return page.evaluate(() => {
          const element = document.querySelector('[itemprop="price"]');
          const raw =
            element?.getAttribute('content') ??
            element?.textContent ??
            document.querySelector('.product-price')?.textContent ??
            '';
          const price = Number.parseFloat(
            raw.replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'),
          );

          return {
            name: document.querySelector('h1')?.textContent?.trim() || undefined,
            price: Number.isFinite(price) ? price : undefined,
            currency: 'EUR',
          };
        });
      },
    }),

    createLiveProvider({
      name: 'Verkkokauppa.com',
      slug: 'verkkokauppa',
      websiteUrl: 'https://www.verkkokauppa.com',
      logoUrl: '/images/stores/verkkokauppa.svg',
      timeoutMs,
      minRequestIntervalMs: 2_000,
      // Verkkokauppa publishes schema.org/Product, so the DOM fallback is
      // rarely reached; it exists so a markup change degrades rather than fails.
      readySelector: '[data-test-id="product-price"], h1',
      async extractFromDom(page) {
        return page.evaluate(() => {
          const priceText =
            document.querySelector('[data-test-id="product-price"]')?.textContent ?? '';
          const price = Number.parseFloat(
            priceText.replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'),
          );

          return {
            name: document.querySelector('h1')?.textContent?.trim() || undefined,
            price: Number.isFinite(price) ? price : undefined,
            currency: 'EUR',
          };
        });
      },
    }),
  ];
}

// Registering on import is what makes `PROVIDER_MODE=live` work without the
// registry needing a static dependency on Playwright.
registerLiveProviderFactory(createLiveProviders);

export { closeBrowser, getBrowser, withPage } from './browser';
export * from './robots';
export * from './structured-data';
export { createLiveProvider, deriveExternalId, guessCategory } from './base-provider';
