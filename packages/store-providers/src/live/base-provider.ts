import { DEFAULT_VERTICAL_ID, matchCategory, type Availability } from '@deal-finder/shared';
// Type-only: erased at compile time, so mock mode still never loads Playwright.
import type { Page } from 'playwright';
import { ProviderInvalidDataError, ProviderNotFoundError } from '../errors';
import { fetchText } from '../http/fetch-with-timeout';
import type {
  ExternalProduct,
  ExternalProductDetails,
  ProductSearchInput,
  StoreProvider,
} from '../types';
import { withPage } from './browser';
import { assertCrawlAllowed } from './robots';
import { parseStructuredProduct, type StructuredProduct } from './structured-data';

/**
 * Shared behaviour for live adapters.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LEGAL AND ETHICAL NOTICE — READ BEFORE ENABLING `PROVIDER_MODE=live`
 * ─────────────────────────────────────────────────────────────────────────────
 * The code below can fetch pages from third-party websites. Running it is a
 * decision with legal consequences, and it is disabled by default for that
 * reason. Before enabling it you are responsible for:
 *
 *  • reading each site's Terms of Service, and not proceeding where automated
 *    access or price extraction is prohibited — a permissive robots.txt is NOT
 *    permission, and this code checking robots.txt does NOT make scraping
 *    lawful;
 *  • preferring an official API, affiliate feed or data licence. Every store in
 *    this MVP is reachable through affiliate networks; that is the correct
 *    production route, and these adapters exist mainly to prove the interface
 *    is not coupled to mock data;
 *  • respecting rate limits, `Crawl-delay`, and the load you place on someone
 *    else's infrastructure;
 *  • complying with applicable law, including the EU Database Directive
 *    (96/9/EC) sui generis database right, national implementations, copyright,
 *    and the GDPR if any personal data is encountered;
 *  • not circumventing access controls, bot protection, CAPTCHAs, paywalls or
 *    login walls. This code deliberately contains no such capability, and none
 *    should be added.
 *
 * Design commitments that follow from the above:
 *  • the crawler identifies itself honestly and never spoofs a browser UA;
 *  • robots.txt is checked and obeyed before every fetch, failing closed;
 *  • structured data (JSON-LD) is preferred over DOM scraping;
 *  • a plain HTTP GET is tried before a headless browser;
 *  • requests are serialised per store with a delay honouring `Crawl-delay`.
 *
 * See docs/legal-and-ethics.md for the full discussion.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface LiveProviderConfig {
  name: string;
  slug: string;
  websiteUrl: string;
  logoUrl?: string | null;
  /** Builds a search URL. Live search is optional — see `searchProducts`. */
  buildSearchUrl?: (query: ProductSearchInput) => string;
  /** CSS selector that must appear before the DOM fallback reads the page. */
  readySelector?: string;
  /** Last-resort DOM extraction, used only when JSON-LD is absent. */
  extractFromDom?: (page: Page) => Promise<Partial<StructuredProduct>>;
  timeoutMs?: number;
  /** Minimum delay between requests to this store, in milliseconds. */
  minRequestIntervalMs?: number;
}

/** Per-store request pacing. Requests to one store never overlap. */
class RequestPacer {
  private queue: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(private minIntervalMs: number) {}

  setMinInterval(ms: number): void {
    this.minIntervalMs = Math.max(this.minIntervalMs, ms);
  }

  /** Serialise `work`, waiting out the remaining interval first. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    const scheduled = this.queue.then(async () => {
      const elapsed = Date.now() - this.lastRequestAt;
      const wait = this.minIntervalMs - elapsed;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();
    });

    // Keep the chain alive even if this call throws.
    this.queue = scheduled.catch(() => undefined);
    await scheduled;
    return work();
  }
}

export function createLiveProvider(config: LiveProviderConfig): StoreProvider {
  const timeoutMs = config.timeoutMs ?? 15_000;
  const pacer = new RequestPacer(config.minRequestIntervalMs ?? 1_500);

  /**
   * Fetch a product page and extract what we need.
   *
   * Two-stage on purpose: a plain GET plus JSON-LD covers most retail pages and
   * costs the store a fraction of a rendered page load. Chromium is only
   * started when that fails.
   */
  async function readProductPage(url: string): Promise<StructuredProduct> {
    const rules = await assertCrawlAllowed(config.name, url);
    if (rules.crawlDelaySeconds != null) {
      pacer.setMinInterval(rules.crawlDelaySeconds * 1000);
    }

    // Stage 1: static HTML + structured data.
    const html = await pacer.run(() => fetchText(config.name, url, { timeoutMs }));
    const structured = parseStructuredProduct(html);
    if (structured) return structured;

    // Stage 2: render, then try structured data again, then the DOM.
    if (!config.extractFromDom && !config.readySelector) {
      throw new ProviderInvalidDataError(
        config.name,
        `${url} published no schema.org/Product data and this adapter has no DOM fallback configured.`,
      );
    }

    return pacer.run(async () =>
      withPage(async (page) => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

        if (config.readySelector) {
          await page.waitForSelector(config.readySelector, { timeout: timeoutMs }).catch(() => {
            // Fall through: the DOM extractor may still find what it needs.
          });
        }

        const rendered = parseStructuredProduct(await page.content());
        if (rendered) return rendered;

        if (!config.extractFromDom) {
          throw new ProviderInvalidDataError(
            config.name,
            `${url} published no structured data even after rendering.`,
          );
        }

        const fromDom = await config.extractFromDom(page);
        if (fromDom.price == null) {
          throw new ProviderInvalidDataError(
            config.name,
            `Could not read a price from ${url}. The page markup has probably changed.`,
          );
        }
        return fromDom as StructuredProduct;
      }, { timeoutMs }),
    );
  }

  function toExternalProduct(url: string, data: StructuredProduct): ExternalProduct {
    if (data.price == null) {
      throw new ProviderInvalidDataError(config.name, `No price found at ${url}.`);
    }

    // Derive a stable id from the URL when the page publishes no SKU: the
    // upsert key must not change between checks.
    const externalId = data.sku ?? deriveExternalId(url);

    return {
      externalId,
      name: data.name ?? externalId,
      brand: data.brand ?? null,
      // Live pages rarely map onto our taxonomy directly, so guess from the
      // title and fall back to a catch-all rather than inventing a category.
      category: guessCategory(data.name) ?? 'accessories',
      vertical: DEFAULT_VERTICAL_ID,
      imageUrl: data.image ?? null,
      productUrl: url,
      currentPrice: data.price,
      // Structured data carries the current price; a claimed "original" price
      // is marketing copy that JSON-LD does not model, so we do not invent one.
      originalPrice: null,
      shippingPrice: data.shippingPrice ?? null,
      currency: (data.currency as ExternalProduct['currency']) ?? 'EUR',
      availability: (data.availability as Availability | undefined) ?? 'UNKNOWN',
      attributes: null,
    };
  }

  return {
    name: config.name,
    slug: config.slug,
    vertical: DEFAULT_VERTICAL_ID,
    websiteUrl: config.websiteUrl,
    logoUrl: config.logoUrl ?? null,
    sourceKind: 'structured-data',

    /**
     * Live keyword search is intentionally not implemented.
     *
     * Crawling a store's search results to build a catalogue is the most
     * aggressive thing this system could do, and the least defensible: it is
     * high-volume, it is what ToS clauses target, and an affiliate product feed
     * provides the same data with permission. Live mode therefore refreshes
     * *known* products (which is what price tracking actually needs) and leaves
     * catalogue building to a licensed feed.
     */
    async searchProducts(): Promise<ExternalProduct[]> {
      return [];
    },

    async getProductDetails(url: string): Promise<ExternalProductDetails> {
      if (!url.startsWith(config.websiteUrl)) {
        throw new ProviderNotFoundError(config.name, url);
      }

      const data = await readProductPage(url);
      return {
        ...toExternalProduct(url, data),
        description: data.description ?? null,
      };
    },
  };
}

/** Stable id from a URL: the last meaningful path segment. */
export function deriveExternalId(url: string): string {
  try {
    const { pathname } = new URL(url);
    const segments = pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? pathname;
  } catch {
    return url;
  }
}

/** Best-effort category from a product title, using the vertical's synonyms. */
export function guessCategory(name: string | undefined): string | undefined {
  if (!name) return undefined;
  for (const word of name.toLowerCase().split(/[\s,/()]+/)) {
    const category = matchCategory(word);
    if (category) return category.id;
  }
  return undefined;
}
