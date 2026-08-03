import { ProviderBlockedError, ProviderTimeoutError } from '../errors';

/**
 * HTTP access for live providers.
 *
 * Every outbound request is bounded by a timeout and identifies itself
 * honestly via User-Agent. A hung third-party socket must never be able to
 * hold an API request open indefinitely.
 */

export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Identify the client truthfully and give operators a way to reach us. Do not
 * change this to impersonate a browser — see docs/legal-and-ethics.md.
 */
export const USER_AGENT =
  'DealFinderAI/0.1 (+https://github.com/your-org/deal-finder; price-comparison bot)';

export interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function fetchWithTimeout(
  provider: string,
  url: string,
  options: FetchOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Honour a caller-supplied signal in addition to our own timeout.
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fi,en;q=0.8',
        ...options.headers,
      },
    });

    // 403/429 mean "stop", not "try again immediately".
    if (response.status === 403 || response.status === 429) {
      throw new ProviderBlockedError(
        provider,
        `${provider} responded ${response.status} for ${url}. Backing off; check rate limits and terms of service.`,
      );
    }

    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderTimeoutError(provider, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/** Fetch and parse JSON, with the same timeout guarantees. */
export async function fetchJson<T = unknown>(
  provider: string,
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  const response = await fetchWithTimeout(provider, url, options);
  if (!response.ok) {
    throw new Error(`${provider} responded ${response.status} for ${url}`);
  }
  return (await response.json()) as T;
}

export async function fetchText(
  provider: string,
  url: string,
  options: FetchOptions = {},
): Promise<string> {
  const response = await fetchWithTimeout(provider, url, options);
  if (!response.ok) {
    throw new Error(`${provider} responded ${response.status} for ${url}`);
  }
  return await response.text();
}
