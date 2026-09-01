import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The destination selector's country list.
 *
 * These exist because of a real failure: with the API down, `/api/countries`
 * 502'd and the control rendered a *single* option — whichever destination was
 * already stored. It read as "we only deliver to the Netherlands" rather than
 * "the server is unreachable", and neither the end-to-end suite nor any unit
 * test could see it, because the e2e specs always run against a live API.
 *
 * So the cases that matter here are the ones where the request has *not*
 * succeeded. Mocked at the transport rather than at the hook, so the real query,
 * the real cache and the real fallback are exercised.
 */

const countries = vi.fn();

vi.mock('../../lib/api-client', () => ({
  api: {
    countries: (...args: unknown[]) => countries(...args),
  },
  // Real enough for `retryPolicy`, which asks `isRetryable` before deciding
  // whether to retry.
  ApiRequestError: class ApiRequestError extends Error {
    readonly status: number;
    constructor(status: number, _code: string, message: string) {
      super(message);
      this.name = 'ApiRequestError';
      this.status = status;
    }
    get isRetryable(): boolean {
      return this.status === 0 || this.status >= 500;
    }
  },
}));

const { ApiRequestError } = await import('../../lib/api-client');
const { DestinationProvider } = await import('../../lib/destination');
const { DestinationControls } = await import('./DestinationControls');

/** The 8 the app supports, and the 6 it models but cannot ship to. */
const SUPPORTED = [
  'Finland',
  'Sweden',
  'Germany',
  'Netherlands',
  'France',
  'Spain',
  'Italy',
  'Denmark',
];
const UNSUPPORTED = ['Belgium', 'Portugal', 'Austria', 'Norway', 'Switzerland', 'United Kingdom'];

function renderControls() {
  const client = new QueryClient({
    defaultOptions: {
      // `useCountries` sets `retry: retryPolicy` per query, which overrides a
      // `retry: false` default. Zeroing the *delay* is what keeps a rejected
      // read inside the test's patience instead of backing off twice.
      queries: { retry: false, retryDelay: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <DestinationProvider>
          <DestinationControls idPrefix="test" layout="panel" />
        </DestinationProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const deliverTo = () => within(screen.getByLabelText('Deliver to'));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DestinationControls country list', () => {
  it('offers every destination before the country request resolves', () => {
    countries.mockReturnValue(new Promise(() => {}));
    renderControls();

    // The regression guard: this used to be exactly one option.
    expect(deliverTo().getAllByRole('option')).toHaveLength(14);
    for (const name of SUPPORTED) {
      expect(deliverTo().getByRole('option', { name })).toBeEnabled();
    }
  });

  it('keeps every destination when the country request fails', async () => {
    countries.mockRejectedValue(
      new ApiRequestError(502, 'HTTP_ERROR', 'Request failed with status 502.'),
    );
    renderControls();

    await waitFor(() => {
      expect(deliverTo().getAllByRole('option')).toHaveLength(14);
    });

    // Selectable destinations stay selectable...
    expect(deliverTo().getByRole('option', { name: 'Finland' })).toBeEnabled();
    expect(deliverTo().getByRole('option', { name: 'Netherlands' })).toBeEnabled();
    // ...and the modelled-but-unavailable ones stay visibly unavailable, rather
    // than vanishing and leaving "why is Norway missing?" unanswerable.
    for (const name of UNSUPPORTED) {
      expect(deliverTo().getByRole('option', { name })).toBeDisabled();
    }
  });

  it('prefers the API list once it arrives', async () => {
    countries.mockResolvedValue({
      items: [
        { code: 'FI', name: 'Finland', isSupported: true },
        { code: 'NO', name: 'Norway', isSupported: false },
      ],
      defaultCountry: 'FI',
    });
    renderControls();

    // Shrinks to the payload rather than merging with the static table, so the
    // fallback can never mask a country the server has withdrawn.
    await waitFor(() => {
      expect(deliverTo().getAllByRole('option')).toHaveLength(2);
    });
    expect(deliverTo().getByRole('option', { name: 'Finland' })).toBeEnabled();
    expect(deliverTo().getByRole('option', { name: 'Norway' })).toBeDisabled();
  });
});
