import { describe, expect, it, vi } from 'vitest';
import { ProviderBlockedError, ProviderError, ProviderNotFoundError } from '../errors';
import { mapWithConcurrency, withRetry } from './retry';

/** No real waiting: the backoff delay is asserted, not slept through. */
const noSleep = () => Promise.resolve();

describe('withRetry', () => {
  it('returns the first successful result without retrying', async () => {
    const operation = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(operation, { sleep: noSleep })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable failure and succeeds', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('p', 'timeout', 'slow'))
      .mockResolvedValue('recovered');

    await expect(withRetry(operation, { sleep: noSleep })).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('stops after the retry budget and rethrows the last error', async () => {
    const operation = vi.fn().mockRejectedValue(new ProviderError('p', 'network', 'down'));

    await expect(withRetry(operation, { maxRetries: 2, sleep: noSleep })).rejects.toThrow('down');
    // One initial attempt plus two retries.
    expect(operation).toHaveBeenCalledTimes(3);
  });

  // Retrying a store that just rate-limited us is what gets a crawler banned.
  it('never retries a blocked (403/429) response', async () => {
    const operation = vi.fn().mockRejectedValue(new ProviderBlockedError('p', 'rate limited'));

    await expect(withRetry(operation, { maxRetries: 5, sleep: noSleep })).rejects.toThrow(
      'rate limited',
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('never retries a 404 or malformed markup, which cannot fix themselves', async () => {
    const notFound = vi.fn().mockRejectedValue(new ProviderNotFoundError('p', '/x'));
    await expect(withRetry(notFound, { maxRetries: 3, sleep: noSleep })).rejects.toThrow();
    expect(notFound).toHaveBeenCalledTimes(1);

    const invalid = vi.fn().mockRejectedValue(new ProviderError('p', 'invalid-data', 'bad html'));
    await expect(withRetry(invalid, { maxRetries: 3, sleep: noSleep })).rejects.toThrow();
    expect(invalid).toHaveBeenCalledTimes(1);
  });

  it('retries an AbortError from a timed-out fetch', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const operation = vi.fn().mockRejectedValueOnce(abort).mockResolvedValue('ok');

    await expect(withRetry(operation, { sleep: noSleep })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('backs off exponentially, with jitter kept inside sane bounds', async () => {
    const delays: number[] = [];
    const operation = vi.fn().mockRejectedValue(new ProviderError('p', 'network', 'down'));

    await expect(
      withRetry(operation, {
        maxRetries: 3,
        baseDelayMs: 100,
        sleep: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toThrow();

    expect(delays).toHaveLength(3);
    // Jitter is 50–100% of the exponential value: 100, 200, 400.
    expect(delays[0]).toBeGreaterThanOrEqual(50);
    expect(delays[0]).toBeLessThanOrEqual(100);
    expect(delays[2]).toBeGreaterThanOrEqual(200);
    expect(delays[2]).toBeLessThanOrEqual(400);
  });

  it('respects a maximum delay ceiling', async () => {
    const delays: number[] = [];
    const operation = vi.fn().mockRejectedValue(new ProviderError('p', 'network', 'down'));

    await expect(
      withRetry(operation, {
        maxRetries: 6,
        baseDelayMs: 1000,
        maxDelayMs: 2000,
        sleep: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toThrow();

    expect(Math.max(...delays)).toBeLessThanOrEqual(2000);
  });

  it('does not retry when the budget is zero', async () => {
    const operation = vi.fn().mockRejectedValue(new ProviderError('p', 'timeout', 'slow'));
    await expect(withRetry(operation, { maxRetries: 0, sleep: noSleep })).rejects.toThrow();
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order in the results', async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => value * 10);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it('never exceeds the concurrency ceiling', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    });

    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
