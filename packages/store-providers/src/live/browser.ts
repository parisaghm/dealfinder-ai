import type { Browser, BrowserContext, Page } from 'playwright';
import { ProviderError } from '../errors';
import { USER_AGENT } from '../http/fetch-with-timeout';

/**
 * Shared headless-browser lifecycle.
 *
 * One browser per process, launched lazily and only if a page actually needs
 * rendering. Launching Chromium costs hundreds of milliseconds and ~100 MB, so
 * a browser-per-request would be both slow and a good way to exhaust a server.
 *
 * Playwright is imported dynamically so that `PROVIDER_MODE=mock` — the default
 * — never loads it at all.
 *
 * Politeness measures applied to every context:
 *  - the honest User-Agent (we do not pretend to be a person),
 *  - images, fonts, media and analytics blocked: we need the price, not the
 *    creative assets, and not downloading them is materially cheaper for the
 *    store than a full page load,
 *  - hard navigation and operation timeouts.
 */

let browserPromise: Promise<Browser> | undefined;

export interface BrowserOptions {
  timeoutMs?: number;
  /** Set false only when debugging locally. */
  headless?: boolean;
}

async function launch(options: BrowserOptions): Promise<Browser> {
  // Dynamic import: keeps Playwright out of the mock-mode dependency graph.
  const { chromium } = await import('playwright');

  return chromium.launch({
    headless: options.headless ?? true,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  });
}

export async function getBrowser(options: BrowserOptions = {}): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launch(options).catch((error: unknown) => {
      // Clear the memo so a later attempt can retry rather than being stuck
      // with a permanently rejected promise.
      browserPromise = undefined;
      throw new ProviderError(
        'browser',
        'unknown',
        `Could not launch a headless browser. Run \`npx playwright install chromium\`. Original error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    });
  }
  return browserPromise;
}

/** Blocked resource types — none of them affect the price we are reading. */
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'stylesheet']);

/** Third-party hosts with nothing to contribute to a price lookup. */
const BLOCKED_HOST_FRAGMENTS = [
  'google-analytics',
  'googletagmanager',
  'doubleclick',
  'facebook.net',
  'hotjar',
  'segment.io',
  'sentry.io',
];

export async function createContext(options: BrowserOptions = {}): Promise<BrowserContext> {
  const browser = await getBrowser(options);

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'fi-FI',
    timezoneId: 'Europe/Helsinki',
    viewport: { width: 1280, height: 900 },
    // Never persist cookies between runs.
    storageState: undefined,
  });

  context.setDefaultTimeout(options.timeoutMs ?? 15_000);
  context.setDefaultNavigationTimeout(options.timeoutMs ?? 15_000);

  await context.route('**/*', (route) => {
    const request = route.request();
    const url = request.url();

    if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
      void route.abort();
      return;
    }
    if (BLOCKED_HOST_FRAGMENTS.some((fragment) => url.includes(fragment))) {
      void route.abort();
      return;
    }
    void route.continue();
  });

  return context;
}

/**
 * Run `work` against a fresh page and always clean it up.
 *
 * Contexts are per-operation and disposed afterwards, so one store's cookies or
 * storage can never leak into another's.
 */
export async function withPage<T>(
  work: (page: Page) => Promise<T>,
  options: BrowserOptions = {},
): Promise<T> {
  const context = await createContext(options);
  try {
    const page = await context.newPage();
    return await work(page);
  } finally {
    await context.close();
  }
}

/** Close the shared browser. Called during API shutdown. */
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = undefined;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    // Already gone; nothing to do.
  }
}
