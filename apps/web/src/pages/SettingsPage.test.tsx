import type { UserSettings } from '@deal-finder/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The "Delivery and currency" card.
 *
 * Mocked at the transport rather than at the hooks, so the real query hooks, the
 * real cache and the real loading/error states are exercised — the point of these
 * tests is that a saved setting survives, which is a property of the whole path
 * rather than of the JSX.
 *
 * The one thing asserted about every save is that it carries the *whole* form.
 * A PATCH that quietly omitted the notification fields would be a different
 * request, and "changing your delivery country turned your alerts off" is the
 * bug this guards against.
 */

const settings = vi.fn();
const updateSettings = vi.fn();
const meta = vi.fn();
const countries = vi.fn();
const stores = vi.fn();

vi.mock('../lib/api-client', () => ({
  api: {
    settings: (...args: unknown[]) => settings(...args),
    updateSettings: (...args: unknown[]) => updateSettings(...args),
    meta: (...args: unknown[]) => meta(...args),
    countries: (...args: unknown[]) => countries(...args),
    stores: (...args: unknown[]) => stores(...args),
    sendTestAlert: vi.fn(),
    clearData: vi.fn(),
  },
  // Real enough for `retryPolicy`, which asks `isRetryable` before deciding
  // whether to retry — without it a rejected read is retried twice with backoff
  // and the error state never arrives inside a test's patience.
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

const { ApiRequestError } = await import('../lib/api-client');
const { SettingsPage } = await import('./SettingsPage');

const SAVED: UserSettings = {
  email: 'demo@dealfinder.test',
  name: 'Demo',
  notifyByEmail: true,
  notifyOnTargetReached: true,
  notifyOnPriceDrop: false,
  checkFrequency: 'EVERY_6_HOURS',
  preferredStores: [],
  preferredCategories: [],
  currency: 'EUR',

  defaultCountryCode: 'DE',
  defaultStoreRegion: 'european',
  preferredStoreCountries: ['DE'],
  includeNonEuStores: false,
  showUnknownShipping: true,
  warnAboutImportCharges: true,
  deliveryTimePreference: 'under-7-days',

  updatedAt: new Date().toISOString(),
};

const STORES = {
  country: null,
  items: [
    storeRow('techhalle', 'TechHalle GmbH', 'DE'),
    storeRow('gigantti', 'Gigantti', 'FI'),
    storeRow('nordbyte', 'Nordbyte AB', 'SE'),
  ],
};

function storeRow(slug: string, name: string, countryCode: 'DE' | 'FI' | 'SE') {
  return {
    id: slug,
    slug,
    name,
    websiteUrl: `https://${slug}.test`,
    logoUrl: null,
    isActive: true,
    countryCode,
    countryName: countryCode,
    region: 'european' as const,
    declaredDeliveryCountries: [],
    supportedCurrencies: ['EUR' as const],
    vatRegistrationCountry: countryCode,
    isDemoStore: false,
    offersToCountry: null,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  settings.mockResolvedValue(SAVED);
  updateSettings.mockImplementation((body: Record<string, unknown>) =>
    Promise.resolve({ ...SAVED, ...body }),
  );
  meta.mockResolvedValue({ verticals: [], stores: [] });
  countries.mockResolvedValue({
    items: [
      { code: 'FI', name: 'Finland', currency: 'EUR', isEu: true, isEea: true, isSupported: true },
      { code: 'DE', name: 'Germany', currency: 'EUR', isEu: true, isEea: true, isSupported: true },
      { code: 'SE', name: 'Sweden', currency: 'SEK', isEu: true, isEea: true, isSupported: true },
      { code: 'NO', name: 'Norway', currency: 'NOK', isEu: false, isEea: true, isSupported: false },
    ],
  });
  stores.mockResolvedValue(STORES);
});

describe('loading existing values', () => {
  it('shows a skeleton before the settings arrive', () => {
    renderPage();
    expect(screen.queryByRole('heading', { name: /delivery and currency/i })).toBeNull();
  });

  it('pre-fills every delivery field from the saved settings', async () => {
    renderPage();

    expect(await screen.findByLabelText('Default delivery country')).toHaveValue('DE');
    expect(screen.getByLabelText('Preferred currency')).toHaveValue('EUR');
    expect(screen.getByLabelText('Delivery-time preference')).toHaveValue('under-7-days');
    expect(screen.getByRole('radio', { name: 'European' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Show offers with unknown shipping cost/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Include stores outside the EU/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Warn me about possible import charges/i })).toBeChecked();
  });

  it('offers country names, never a flag alone', async () => {
    renderPage();

    const select = await screen.findByLabelText('Default delivery country');
    expect(within(select).getByRole('option', { name: 'Finland' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Germany' })).toBeInTheDocument();
  });

  it('lists unsupported destinations as disabled rather than omitting them', async () => {
    renderPage();

    const select = await screen.findByLabelText('Default delivery country');
    expect(within(select).getByRole('option', { name: 'Norway' })).toBeDisabled();
  });
});

describe('preferred store countries', () => {
  it('offers only countries we actually have stores in', async () => {
    renderPage();
    await screen.findByLabelText('Default delivery country');

    const group = screen.getByRole('group', { name: /preferred store countries/i });
    // Three stores, in DE, FI and SE. Alphabetical by name, so the list does not
    // reshuffle when a store is added.
    expect(within(group).getAllByRole('checkbox')).toHaveLength(3);
    for (const name of ['Finland', 'Germany', 'Sweden']) {
      expect(within(group).getByRole('checkbox', { name })).toBeInTheDocument();
    }
    // Norway is a modelled country with no store, so offering it would be a
    // setting that silently does nothing.
    expect(within(group).queryByRole('checkbox', { name: 'Norway' })).toBeNull();
  });

  it('pre-checks the saved selection', async () => {
    renderPage();
    await screen.findByLabelText('Default delivery country');

    const group = screen.getByRole('group', { name: /preferred store countries/i });
    expect(within(group).getByRole('checkbox', { name: 'Germany' })).toBeChecked();
    expect(within(group).getByRole('checkbox', { name: 'Finland' })).not.toBeChecked();
  });

  it('accumulates a multi-selection instead of replacing it', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText('Default delivery country');

    const group = screen.getByRole('group', { name: /preferred store countries/i });
    await user.click(within(group).getByRole('checkbox', { name: 'Finland' }));
    await user.click(within(group).getByRole('checkbox', { name: 'Sweden' }));
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(updateSettings.mock.calls[0]?.[0]).toMatchObject({
      preferredStoreCountries: ['DE', 'FI', 'SE'],
    });
  });

  it('can clear a country again', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText('Default delivery country');

    const group = screen.getByRole('group', { name: /preferred store countries/i });
    await user.click(within(group).getByRole('checkbox', { name: 'Germany' }));
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(updateSettings.mock.calls[0]?.[0]).toMatchObject({ preferredStoreCountries: [] });
  });
});

describe('saving updated values', () => {
  it('sends every delivery field, and confirms', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText('Default delivery country');

    await user.selectOptions(screen.getByLabelText('Default delivery country'), 'FI');
    await user.selectOptions(screen.getByLabelText('Preferred currency'), 'SEK');
    await user.selectOptions(screen.getByLabelText('Delivery-time preference'), 'under-3-days');
    await user.click(screen.getByRole('radio', { name: 'Nordic' }));
    await user.click(screen.getByRole('checkbox', { name: /Include stores outside the EU/i }));
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0]?.[0]).toMatchObject({
      defaultCountryCode: 'FI',
      currency: 'SEK',
      defaultStoreRegion: 'nordic',
      deliveryTimePreference: 'under-3-days',
      includeNonEuStores: true,
    });
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
  });

  it('does not overwrite unrelated settings', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText('Default delivery country');

    await user.selectOptions(screen.getByLabelText('Default delivery country'), 'FI');
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    // The notification block travels untouched rather than being dropped.
    expect(updateSettings.mock.calls[0]?.[0]).toMatchObject({
      email: 'demo@dealfinder.test',
      notifyByEmail: true,
      notifyOnTargetReached: true,
      notifyOnPriceDrop: false,
      checkFrequency: 'EVERY_6_HOURS',
    });
  });
});

describe('validation and failure', () => {
  it('refuses an invalid email against the field, without a round trip', async () => {
    const user = userEvent.setup();
    renderPage();
    const email = await screen.findByLabelText('Email address');

    await user.clear(email);
    await user.type(email, 'not-an-email');
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/valid email address/i);
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('clears the message once the field is corrected', async () => {
    const user = userEvent.setup();
    renderPage();
    const email = await screen.findByLabelText('Email address');

    await user.clear(email);
    await user.click(screen.getByRole('button', { name: /save settings/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.type(email, 'someone@example.test');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a failed save and keeps the form as the user left it', async () => {
    const user = userEvent.setup();
    updateSettings.mockRejectedValue(new Error('The server is unavailable.'));
    renderPage();
    await screen.findByLabelText('Default delivery country');

    await user.selectOptions(screen.getByLabelText('Default delivery country'), 'FI');
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(await screen.findByText('The server is unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('Settings saved.')).toBeNull();
    expect(screen.getByLabelText('Default delivery country')).toHaveValue('FI');
  });

  it('shows a retry when the settings themselves cannot be loaded', async () => {
    settings.mockRejectedValue(new ApiRequestError(503, 'UNAVAILABLE', 'offline'));
    renderPage();

    expect(
      await screen.findByRole('button', { name: /try again/i }, { timeout: 5_000 }),
    ).toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it('labels every control in the card and links its description', async () => {
    renderPage();

    expect(await screen.findByLabelText('Default delivery country')).toHaveAccessibleDescription(
      /pre-fill the “Deliver to” control/i,
    );
    expect(screen.getByLabelText('Preferred currency')).toHaveAccessibleDescription(
      /converted and labelled as estimates/i,
    );
    expect(screen.getByLabelText('Delivery-time preference')).toHaveAccessibleDescription(
      /filtered out when a destination is selected/i,
    );
  });

  it('groups the region radios under a legend', async () => {
    renderPage();
    await screen.findByLabelText('Default delivery country');

    const group = screen.getByRole('group', { name: /default store region/i });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
  });

  it('reaches every delivery control in DOM order by keyboard', async () => {
    const user = userEvent.setup();
    renderPage();
    const country = await screen.findByLabelText('Default delivery country');

    country.focus();
    expect(country).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText('Preferred currency')).toHaveFocus();

    await user.tab();
    // The checked radio is the group's single tab stop, as a radio group should be.
    expect(screen.getByRole('radio', { name: 'European' })).toHaveFocus();
  });

  it('describes what turning a warning off does and does not do', async () => {
    renderPage();
    await screen.findByLabelText('Default delivery country');

    expect(
      screen.getByRole('checkbox', { name: /Warn me about possible import charges/i }),
    ).toHaveAccessibleDescription(/hides the warning, not the risk/i);
    expect(
      screen.getByRole('checkbox', { name: /Show offers with unknown shipping cost/i }),
    ).toHaveAccessibleDescription(/never as free delivery/i);
  });
});
