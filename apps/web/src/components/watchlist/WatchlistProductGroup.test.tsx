import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { makeProduct, makeWatchlistItem } from '../../test/factories';
import {
  WatchlistProductGroup,
  displayAlertStatus,
  groupWatchlistByProduct,
  readTargetConflict,
} from './WatchlistProductGroup';

/**
 * Watchlist rows.
 *
 * The claims worth testing here are the ones with a cost attached if they break:
 *
 *  - Two destinations for one product are **two rows under one product**, each
 *    naming its destination and currency. Flat and unlabelled, they read as a
 *    duplicate bug and get deleted by a confused user.
 *  - A currency change goes through `PATCH`, never `POST`. The failure mode is
 *    duplicate alert emails nobody asked for.
 *  - An unknown delivered total is **WAITING**, never TARGET REACHED. That label
 *    is the one that makes someone go and spend money.
 *  - A legacy list-price row still renders as itself.
 */

const COUNTRY_OPTIONS = [
  { code: 'FI' as const, name: 'Finland', isSupported: true },
  { code: 'DE' as const, name: 'Germany', isSupported: true },
  { code: 'SE' as const, name: 'Sweden', isSupported: true },
  { code: 'NO' as const, name: 'Norway', isSupported: false },
];

const finland = makeWatchlistItem({
  id: 'watch-fi',
  destinationCountry: 'FI',
  destinationCountryName: 'Finland',
  preferredCurrency: 'EUR',
  targetPrice: null,
  targetDeliveredPrice: 300,
  currentDeliveredPrice: 311.9,
  deliveredComparison: { difference: 11.9, percentAway: 3.97, reached: false },
  alertStatus: 'WAITING',
  targetComparison: null,
});

const germany = makeWatchlistItem({
  id: 'watch-de',
  destinationCountry: 'DE',
  destinationCountryName: 'Germany',
  preferredCurrency: 'EUR',
  targetPrice: null,
  targetDeliveredPrice: 280,
  currentDeliveredPrice: 275,
  deliveredComparison: { difference: -5, percentAway: -1.79, reached: true },
  alertStatus: 'TARGET_REACHED',
  targetComparison: null,
});

function renderGroup(
  items = [finland, germany],
  overrides: Partial<Parameters<typeof WatchlistProductGroup>[0]> = {},
) {
  const onUpdate = vi.fn();
  const onRemove = vi.fn();
  const onAddTarget = vi.fn();

  render(
    <MemoryRouter>
      <WatchlistProductGroup
        group={groupWatchlistByProduct(items)[0]!}
        countryOptions={COUNTRY_OPTIONS}
        onUpdate={onUpdate}
        onRemove={onRemove}
        onAddTarget={onAddTarget}
        {...overrides}
      />
    </MemoryRouter>,
  );

  return { onUpdate, onRemove, onAddTarget };
}

describe('grouping by product', () => {
  it('collapses several targets for one product into a single group', () => {
    const groups = groupWatchlistByProduct([finland, germany]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(2);
  });

  it('keeps different products apart', () => {
    const other = makeWatchlistItem({
      id: 'watch-other',
      productId: 'product-2',
      product: makeProduct({ id: 'product-2', name: 'Philips Hue' }),
    });

    const groups = groupWatchlistByProduct([finland, other]);
    expect(groups.map((group) => group.productId)).toEqual(['product-1', 'product-2']);
  });

  it('orders a product’s targets by destination then currency, so editing one does not reshuffle them', () => {
    const swedenSek = makeWatchlistItem({
      id: 'watch-se-sek',
      destinationCountry: 'SE',
      destinationCountryName: 'Sweden',
      preferredCurrency: 'SEK',
    });
    const swedenEur = makeWatchlistItem({
      id: 'watch-se-eur',
      destinationCountry: 'SE',
      destinationCountryName: 'Sweden',
      preferredCurrency: 'EUR',
    });

    const [group] = groupWatchlistByProduct([swedenSek, germany, swedenEur]);
    expect(group?.items.map((item) => item.id)).toEqual([
      'watch-de',
      'watch-se-eur',
      'watch-se-sek',
    ]);
  });

  it('renders the product once and one row per target', () => {
    renderGroup();

    expect(screen.getAllByRole('heading', { name: /Sony WH-1000XM5/i })).toHaveLength(1);
    expect(screen.getAllByTestId('watchlist-target-row')).toHaveLength(2);
  });
});

describe('FI/EUR and DE/EUR coexisting', () => {
  it('names both the destination and the currency on every row', () => {
    renderGroup();

    const scopes = screen.getAllByTestId('target-scope').map((node) => node.textContent);
    expect(scopes).toContain('Delivered to Finland · EUR');
    expect(scopes).toContain('Delivered to Germany · EUR');
  });

  it('says how many targets exist, so two rows do not read as a bug', () => {
    renderGroup();
    expect(screen.getByText(/2 targets for this product/i)).toBeInTheDocument();
  });

  it('distinguishes the two Remove buttons by destination and currency', () => {
    renderGroup();

    expect(
      screen.getByRole('button', { name: /^Remove the EUR target for delivery to Finland$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Remove the EUR target for delivery to Germany$/i }),
    ).toBeInTheDocument();
  });
});

describe('a currency change updates in place', () => {
  it('sends a PATCH for the edited row rather than creating another', async () => {
    const user = userEvent.setup();
    const { onUpdate, onAddTarget } = renderGroup([finland]);

    await user.click(screen.getByRole('button', { name: /edit target for delivery to Finland/i }));
    await user.selectOptions(screen.getByLabelText('Currency'), 'SEK');
    await user.click(screen.getByRole('button', { name: /save target/i }));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(
      'watch-fi',
      expect.objectContaining({ preferredCurrency: 'SEK', destinationCountry: 'FI' }),
    );
    // The whole point: a changed dropdown must never mint a second row.
    expect(onAddTarget).not.toHaveBeenCalled();
  });

  it('says so in the form, before the user changes anything', async () => {
    const user = userEvent.setup();
    renderGroup([finland]);

    await user.click(screen.getByRole('button', { name: /edit target for delivery to Finland/i }));

    expect(screen.getByLabelText('Currency')).toHaveAccessibleDescription(
      /Changing the currency updates this target/i,
    );
  });

  it('names the destination and currency in the delivered-target field', async () => {
    const user = userEvent.setup();
    renderGroup([finland]);

    await user.click(screen.getByRole('button', { name: /edit target for delivery to Finland/i }));

    expect(
      screen.getByLabelText(/delivered price to Finland is below this EUR amount/i),
    ).toHaveValue('300');
  });
});

describe('a second currency target is an explicit action', () => {
  it('is behind its own button, not a dropdown', async () => {
    const user = userEvent.setup();
    const { onAddTarget } = renderGroup([finland]);

    await user.click(screen.getByRole('button', { name: /add another target/i }));
    // Finland is already tracked, so this is the deliberate second-currency case.
    await user.selectOptions(screen.getByLabelText('Deliver to'), 'FI');
    await user.selectOptions(screen.getByLabelText('Currency'), 'SEK');
    await user.type(screen.getByLabelText(/delivered price to Finland is below/i), '3200');
    await user.click(screen.getByRole('button', { name: /add a separate SEK target/i }));

    expect(onAddTarget).toHaveBeenCalledWith({
      productId: 'product-1',
      destinationCountry: 'FI',
      preferredCurrency: 'SEK',
      targetDeliveredPrice: 3200,
      alertsEnabled: true,
      // Only sent for this deliberate case, so the server's guard still protects
      // the accidental one.
      allowAdditionalCurrency: true,
    });
  });

  it('warns that a second target for an already-tracked destination is being created', async () => {
    const user = userEvent.setup();
    renderGroup([finland]);

    await user.click(screen.getByRole('button', { name: /add another target/i }));
    await user.selectOptions(screen.getByLabelText('Deliver to'), 'FI');

    expect(screen.getByText(/creates a second, independent EUR target/i)).toBeInTheDocument();
  });

  it('does not claim consent for a destination that is not yet tracked', async () => {
    const user = userEvent.setup();
    const { onAddTarget } = renderGroup([finland]);

    await user.click(screen.getByRole('button', { name: /add another target/i }));
    await user.selectOptions(screen.getByLabelText('Deliver to'), 'DE');
    await user.click(screen.getByRole('button', { name: /^Add target$/i }));

    expect(onAddTarget).toHaveBeenCalledWith(
      expect.objectContaining({ destinationCountry: 'DE', allowAdditionalCurrency: false }),
    );
  });

  it('offers unsupported destinations as disabled rather than hiding them', async () => {
    const user = userEvent.setup();
    renderGroup([finland]);

    await user.click(screen.getByRole('button', { name: /add another target/i }));

    const norway = within(screen.getByLabelText('Deliver to')).getByRole('option', {
      name: /Norway/,
    });
    expect(norway).toBeDisabled();
  });
});

describe('409 duplicate-target handling', () => {
  it('reads the reason and the existing item out of the response', () => {
    const conflict = readTargetConflict({
      status: 409,
      message: 'You already track this product for delivery to Finland in EUR.',
      details: {
        watchlistItemId: 'watch-fi',
        existingCurrency: 'EUR',
        requestedCurrency: 'SEK',
        reason: 'CURRENCY_ONLY_CONFLICT',
      },
    });

    expect(conflict).toEqual({
      message: 'You already track this product for delivery to Finland in EUR.',
      reason: 'CURRENCY_ONLY_CONFLICT',
      existingItemId: 'watch-fi',
      existingCurrency: 'EUR',
      requestedCurrency: 'SEK',
    });
  });

  it('ignores anything that is not a 409', () => {
    expect(readTargetConflict({ status: 500, message: 'Server error' })).toBeNull();
    expect(readTargetConflict(new Error('offline'))).toBeNull();
    expect(readTargetConflict(null)).toBeNull();
  });

  it('shows the server’s own wording, which already names destination and currency', () => {
    renderGroup([finland], {
      conflict: {
        message:
          'You already track this product for delivery to Finland in EUR. Update that target, or confirm you want a separate SEK target as well.',
        reason: 'CURRENCY_ONLY_CONFLICT',
        existingItemId: 'watch-fi',
        existingCurrency: 'EUR',
        requestedCurrency: 'SEK',
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      /already track this product for delivery to Finland in EUR/i,
    );
  });

  it('offers to update the existing target instead of duplicating it', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderGroup([finland], {
      conflict: {
        message: 'You already track this product for delivery to Finland in EUR.',
        reason: 'CURRENCY_ONLY_CONFLICT',
        existingItemId: 'watch-fi',
        existingCurrency: 'EUR',
        requestedCurrency: 'SEK',
      },
    });

    await user.click(screen.getByRole('button', { name: /update the existing target to SEK/i }));

    expect(onUpdate).toHaveBeenCalledWith('watch-fi', { preferredCurrency: 'SEK' });
  });

  it('offers no update path for an exact duplicate, because there is nothing to change', () => {
    renderGroup([finland], {
      conflict: {
        message: 'You are already tracking this product for delivery to Finland in EUR.',
        reason: 'DUPLICATE_TRACKING_TARGET',
        existingItemId: 'watch-fi',
        existingCurrency: null,
        requestedCurrency: null,
      },
    });

    expect(screen.getByTestId('watchlist-conflict')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /update the existing target/i })).toBeNull();
  });
});

describe('an unknown delivered total waits', () => {
  const unknown = makeWatchlistItem({
    id: 'watch-unknown',
    targetPrice: null,
    targetDeliveredPrice: 300,
    currentDeliveredPrice: null,
    deliveredComparison: null,
    alertStatus: 'WAITING',
    targetComparison: null,
  });

  it('shows WAITING and explains why, rather than a total of nothing', () => {
    renderGroup([unknown]);

    expect(screen.getByTestId('target-status')).toHaveTextContent('Waiting for target');
    expect(screen.getByTestId('current-delivered')).toHaveTextContent('Unknown');
    expect(screen.getByText(/No delivered total can be calculated yet/i)).toBeInTheDocument();
  });

  it('refuses TARGET_REACHED even if the payload claims it', () => {
    // Belt and braces over the server's own derivation: this is the one label
    // that makes a person spend money.
    expect(
      displayAlertStatus(
        makeWatchlistItem({
          targetDeliveredPrice: 300,
          currentDeliveredPrice: null,
          alertStatus: 'TARGET_REACHED',
        }),
      ),
    ).toBe('WAITING');
  });

  it('leaves a genuinely reached delivered target alone', () => {
    expect(displayAlertStatus(germany)).toBe('TARGET_REACHED');
  });
});

describe('legacy list-price targets', () => {
  // The pre-expansion row: FI/EUR by column default, a list-price target, and no
  // delivered target at all. It must still say what it has always said.
  const legacy = makeWatchlistItem();

  it('renders its list-price target and says delivery is not counted', () => {
    renderGroup([legacy]);

    expect(screen.getByTestId('list-price-target')).toHaveTextContent('249');
    expect(screen.getByText(/delivery is not counted/i)).toBeInTheDocument();
  });

  it('shows no delivered target and no unknown-total warning', () => {
    renderGroup([legacy]);

    expect(screen.queryByText(/No delivered total can be calculated yet/i)).toBeNull();
    expect(screen.getByTestId('target-status')).toHaveTextContent('Target reached');
  });
});

describe('demo stores and confirmations', () => {
  it('keeps the demo-store disclosure visible as text, not a tooltip', () => {
    renderGroup([finland], { isDemoStore: true });

    expect(screen.getByTestId('demo-store-notice')).toBeInTheDocument();
    expect(screen.getByText(/Illustrative prices/i)).toBeInTheDocument();
  });

  it('states the destination and currency in the confirmation', () => {
    renderGroup([finland], { confirmation: 'Now watching the delivered price to Germany, in EUR.' });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Now watching the delivered price to Germany, in EUR.',
    );
  });

  it('pauses and resumes a single target rather than the whole product', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderGroup();

    await user.click(
      screen.getByRole('button', { name: /pause alerts for delivery to Germany in EUR/i }),
    );

    expect(onUpdate).toHaveBeenCalledWith('watch-de', { alertsEnabled: false });
  });
});
