import { ProviderError } from '../errors';

/**
 * Bounded retry with exponential backoff.
 *
 * Two rules matter more than the backoff curve:
 *  - never retry a failure that cannot succeed (404, malformed markup, 403),
 *  - never retry unboundedly.
 * Retrying a store that just rate-limited us makes the problem worse and is
 * exactly the behaviour that gets a crawler blocked.
 */

export interface RetryOptions {
  /** Attempts *after* the first. 2 means up to three calls in total. */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for tests; defaults to real timers. */
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRetryable(error: unknown): boolean {
  if (error instanceof ProviderError) return error.retryable;
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.name === 'TimeoutError';
  }
  return false;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 4_000;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const canRetry = attempt < maxRetries && isRetryable(error);
      if (!canRetry) break;

      // Exponential backoff with jitter, so concurrent failures do not
      // synchronise into a thundering herd against the same store.
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const delayMs = Math.round(exponential * (0.5 + Math.random() * 0.5));

      options.onRetry?.(attempt + 1, error, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Run tasks with a ceiling on how many are in flight at once.
 *
 * Used when refreshing many products: firing every request simultaneously is
 * both a poor neighbour and a good way to get rate-limited.
 */
export async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<TOutput>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}
