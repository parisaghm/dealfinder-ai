import type { ProviderFailure } from './types';

/**
 * Provider failures are expected operating conditions, not exceptional ones:
 * stores go down, rate-limit, and change their markup without notice. Each
 * failure carries whether a retry could plausibly help, so the retry helper
 * never hammers a store that has told us to stop.
 */
export class ProviderError extends Error {
  readonly kind: ProviderFailure['kind'];
  readonly retryable: boolean;
  readonly provider: string;

  constructor(
    provider: string,
    kind: ProviderFailure['kind'],
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ProviderError';
    this.provider = provider;
    this.kind = kind;
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE[kind];
  }

  toFailure(): ProviderFailure {
    return { kind: this.kind, message: this.message, retryable: this.retryable };
  }
}

const DEFAULT_RETRYABLE: Record<ProviderFailure['kind'], boolean> = {
  timeout: true,
  network: true,
  unknown: false,
  // Being blocked or rate-limited is a signal to back off, not to try harder.
  blocked: false,
  // A 404 and malformed markup will not fix themselves on a second request.
  'not-found': false,
  'invalid-data': false,
};

export class ProviderTimeoutError extends ProviderError {
  constructor(provider: string, timeoutMs: number) {
    super(provider, 'timeout', `${provider} did not respond within ${timeoutMs}ms`);
    this.name = 'ProviderTimeoutError';
  }
}

/**
 * Thrown when a site's robots.txt disallows the path, or it responds 403/429.
 * Treated as a hard stop: see docs/legal-and-ethics.md.
 */
export class ProviderBlockedError extends ProviderError {
  constructor(provider: string, message: string) {
    super(provider, 'blocked', message);
    this.name = 'ProviderBlockedError';
  }
}

export class ProviderNotFoundError extends ProviderError {
  constructor(provider: string, url: string) {
    super(provider, 'not-found', `${provider} has no product at ${url}`);
    this.name = 'ProviderNotFoundError';
  }
}

/**
 * Thrown when a provider is asked to quote for a destination it does not serve.
 *
 * Non-retryable: a store's delivery network will not change between two requests
 * a second apart. Reusing the `not-found` kind is deliberate — a provider with no
 * rule for a country has nothing to return, and the caller's correct response is
 * the same as for a missing product: record the absence and move on. It must
 * never be papered over with a guessed shipping cost, because a guess reaches the
 * shopper indistinguishable from a fact.
 */
export class ProviderUnsupportedDestinationError extends ProviderError {
  readonly destinationCountry: string;

  constructor(provider: string, destinationCountry: string) {
    super(
      provider,
      'not-found',
      `${provider} does not publish delivery to ${destinationCountry}`,
    );
    this.name = 'ProviderUnsupportedDestinationError';
    this.destinationCountry = destinationCountry;
  }
}

export class ProviderInvalidDataError extends ProviderError {
  constructor(provider: string, message: string, cause?: unknown) {
    super(provider, 'invalid-data', message, { cause });
    this.name = 'ProviderInvalidDataError';
  }
}

/** Normalise anything thrown into a ProviderFailure for logging/aggregation. */
export function toProviderFailure(error: unknown, provider: string): ProviderFailure {
  if (error instanceof ProviderError) return error.toFailure();

  if (error instanceof Error) {
    // AbortController surfaces timeouts as AbortError.
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return { kind: 'timeout', message: error.message, retryable: true };
    }
    return { kind: 'unknown', message: `${provider}: ${error.message}`, retryable: false };
  }

  return { kind: 'unknown', message: `${provider}: ${String(error)}`, retryable: false };
}
