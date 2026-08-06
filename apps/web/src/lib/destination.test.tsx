import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DESTINATION_STORAGE_KEY,
  DestinationProvider,
  applyDestinationToParams,
  paramsToDestination,
  readStoredDestination,
  useDestination,
  type DestinationSelection,
} from './destination';

/**
 * Destination state.
 *
 * Four things here are worth more than the rest of this file put together, because
 * each one is a bug the user would experience rather than an assertion about
 * internals:
 *
 *  1. **Nothing is written to the URL on mount.** An effect that synchronised
 *     state into the URL on first render would push a history entry nobody asked
 *     for, so Back would appear to do nothing.
 *  2. **A first visit is not destination-aware.** With no URL parameter and
 *     nothing stored, `isActive` is false and every component gets `null` — which
 *     is the pre-expansion rendering the existing suites describe.
 *  3. **A corrupt stored value is deleted**, not merely ignored, or it re-fails on
 *     every mount for the life of the browser profile.
 *  4. **Changing destination preserves every unrelated parameter.** Losing the
 *     query and the filters on a dropdown change would be worse than the feature
 *     is worth.
 */

function Probe() {
  const destination = useDestination();
  const location = useLocation();

  return (
    <div>
      <span data-testid="country">{destination.country}</span>
      <span data-testid="currency">{destination.currency}</span>
      <span data-testid="region">{destination.region}</span>
      <span data-testid="active">{String(destination.isActive)}</span>
      <span data-testid="source">{destination.source}</span>
      <span data-testid="search">{location.search}</span>
      <button type="button" onClick={() => destination.setDestination({ country: 'DE' })}>
        Choose Germany
      </button>
      <button type="button" onClick={() => destination.setDestination({ region: 'european' })}>
        Choose European
      </button>
      <button type="button" onClick={() => destination.clearDestination()}>
        Clear
      </button>
    </div>
  );
}

function renderAt(
  path: string,
  settingsDefaults?: Partial<DestinationSelection> | null,
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DestinationProvider settingsDefaults={settingsDefaults ?? null}>
        <Probe />
      </DestinationProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('precedence', () => {
  it('prefers the URL over everything else', () => {
    window.localStorage.setItem(
      DESTINATION_STORAGE_KEY,
      JSON.stringify({ country: 'SE', currency: 'SEK', region: 'nordic' }),
    );

    renderAt('/search?country=DE&currency=EUR&region=european', { country: 'IT' });

    expect(screen.getByTestId('country')).toHaveTextContent('DE');
    expect(screen.getByTestId('source')).toHaveTextContent('url');
    expect(screen.getByTestId('active')).toHaveTextContent('true');
  });

  it('falls back to the stored choice when the URL names no country', () => {
    window.localStorage.setItem(
      DESTINATION_STORAGE_KEY,
      JSON.stringify({ country: 'SE', currency: 'SEK', region: 'nordic' }),
    );

    renderAt('/search?query=headphones');

    expect(screen.getByTestId('country')).toHaveTextContent('SE');
    expect(screen.getByTestId('currency')).toHaveTextContent('SEK');
    expect(screen.getByTestId('source')).toHaveTextContent('storage');
    expect(screen.getByTestId('active')).toHaveTextContent('true');
  });

  it('seeds the controls from user settings without activating destination mode', () => {
    renderAt('/search', { country: 'DE', currency: 'EUR', region: 'european' });

    // The values are there, ready for the controls to display…
    expect(screen.getByTestId('country')).toHaveTextContent('DE');
    expect(screen.getByTestId('region')).toHaveTextContent('european');
    // …but nothing has been chosen, so the legacy view still renders. Every user
    // row carries defaults whether or not anyone picked them.
    expect(screen.getByTestId('active')).toHaveTextContent('false');
    expect(screen.getByTestId('source')).toHaveTextContent('fallback');
  });

  it('falls back to Finland, EUR and local with nothing else to go on', () => {
    renderAt('/search');

    expect(screen.getByTestId('country')).toHaveTextContent('FI');
    expect(screen.getByTestId('currency')).toHaveTextContent('EUR');
    expect(screen.getByTestId('region')).toHaveTextContent('local');
    expect(screen.getByTestId('active')).toHaveTextContent('false');
  });

  it('completes a partial URL rather than leaving a half-configured state', () => {
    // A hand-written or shared link with only a country is a valid link.
    renderAt('/search?country=SE');

    expect(screen.getByTestId('currency')).toHaveTextContent('SEK');
    expect(screen.getByTestId('region')).toHaveTextContent('local');
  });
});

describe('stored value hygiene', () => {
  it('deletes a stored value that is not JSON', () => {
    window.localStorage.setItem(DESTINATION_STORAGE_KEY, 'not json at all');

    renderAt('/search');

    expect(screen.getByTestId('active')).toHaveTextContent('false');
    expect(window.localStorage.getItem(DESTINATION_STORAGE_KEY)).toBeNull();
  });

  it('deletes a stored value whose shape no longer validates', () => {
    window.localStorage.setItem(
      DESTINATION_STORAGE_KEY,
      JSON.stringify({ country: 'ZZ', currency: 'XYZ', region: 'galactic' }),
    );

    expect(readStoredDestination()).toBeNull();
    expect(window.localStorage.getItem(DESTINATION_STORAGE_KEY)).toBeNull();
  });

  it('survives storage being unavailable', () => {
    const original = window.localStorage.getItem;
    // Sandboxed iframes and some privacy modes throw on access rather than
    // returning null.
    Object.defineProperty(window.localStorage, 'getItem', {
      configurable: true,
      value: () => {
        throw new Error('SecurityError');
      },
    });

    try {
      expect(readStoredDestination()).toBeNull();
    } finally {
      Object.defineProperty(window.localStorage, 'getItem', {
        configurable: true,
        value: original,
      });
    }
  });
});

describe('writing to the URL', () => {
  it('writes nothing on the initial mount', () => {
    window.localStorage.setItem(
      DESTINATION_STORAGE_KEY,
      JSON.stringify({ country: 'SE', currency: 'SEK', region: 'nordic' }),
    );

    renderAt('/search?query=headphones');

    // Sweden is active, from storage — and the URL is untouched. Writing it here
    // would add a history entry the user never asked for.
    expect(screen.getByTestId('country')).toHaveTextContent('SE');
    expect(screen.getByTestId('search')).toHaveTextContent('?query=headphones');
    expect(screen.getByTestId('search')).not.toHaveTextContent('country');
  });

  it('writes the country explicitly once the user chooses one', async () => {
    const user = userEvent.setup();
    renderAt('/search?query=headphones&sort=lowest-price');

    await user.click(screen.getByRole('button', { name: 'Choose Germany' }));

    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).toContain('country=DE');
    // Everything unrelated survives: losing the query on a dropdown change would
    // be worse than the feature is worth.
    expect(search).toContain('query=headphones');
    expect(search).toContain('sort=lowest-price');
  });

  it('re-defaults the currency when the country changes', async () => {
    const user = userEvent.setup();
    renderAt('/search?country=FI&currency=EUR');

    await user.click(screen.getByRole('button', { name: 'Choose Germany' }));
    expect(screen.getByTestId('currency')).toHaveTextContent('EUR');

    // Sweden quotes kronor; keeping EUR selected would quietly convert every
    // Swedish price without the user asking.
    render(
      <MemoryRouter initialEntries={['/search?country=SE']}>
        <DestinationProvider settingsDefaults={null}>
          <Probe />
        </DestinationProvider>
      </MemoryRouter>,
    );
    expect(screen.getAllByTestId('currency').at(-1)).toHaveTextContent('SEK');
  });

  it('persists the choice so it survives navigating to a parameterless page', async () => {
    const user = userEvent.setup();
    renderAt('/search');

    await user.click(screen.getByRole('button', { name: 'Choose European' }));

    const stored = window.localStorage.getItem(DESTINATION_STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toMatchObject({ region: 'european' });
  });

  it('clearing forgets the choice and drops the parameters', async () => {
    const user = userEvent.setup();
    renderAt('/search?query=tv&country=DE&region=european');

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).not.toContain('country');
    expect(search).not.toContain('region');
    // …and the search itself is untouched.
    expect(search).toContain('query=tv');
    expect(window.localStorage.getItem(DESTINATION_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId('active')).toHaveTextContent('false');
  });
});

describe('parameter helpers', () => {
  it('reads no destination from a URL without a country', () => {
    expect(paramsToDestination(new URLSearchParams('?currency=SEK&region=nordic'))).toBeNull();
  });

  it('ignores an invalid country rather than guessing', () => {
    expect(paramsToDestination(new URLSearchParams('?country=ZZ'))).toBeNull();
  });

  it('omits a currency and region that the reader would infer anyway', () => {
    const params = applyDestinationToParams(new URLSearchParams('?query=tv'), {
      country: 'SE',
      currency: 'SEK',
      region: 'local',
    });

    expect(params.get('country')).toBe('SE');
    // SEK is Sweden's own currency and `local` is the default, so neither needs
    // saying. The link stays short and loses nothing.
    expect(params.get('currency')).toBeNull();
    expect(params.get('region')).toBeNull();
    expect(params.get('query')).toBe('tv');
  });

  it('writes a currency that differs from the country default', () => {
    const params = applyDestinationToParams(new URLSearchParams(), {
      country: 'SE',
      currency: 'EUR',
      region: 'european',
    });

    expect(params.get('currency')).toBe('EUR');
    expect(params.get('region')).toBe('european');
  });
});
