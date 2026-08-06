import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  makeCanonicalProduct,
  makeConvertedDelivery,
  makeDelivery,
  makeDutiableDelivery,
  makeMoneyAmount,
  makeProduct,
  makeRateMissingDelivery,
  makeStaleRateDelivery,
  makeUnknownShippingDelivery,
  makeUnshippableDelivery,
} from '../../test/factories';
import { DELIVERY_COPY } from './DeliveryDetails';
import { GroupedProductCard, type GroupDestinationSummary } from './GroupedProductCard';
import { ProductCard } from './ProductCard';

/**
 * Destination-aware result cards.
 *
 * Two contracts are load-bearing here and are asserted rather than assumed:
 *
 *  - `data-testid="current-price"` with `data-price` belongs to `ProductCard`'s
 *    *list* price and to nothing else. The end-to-end suite reads it to assert
 *    sort order, so overloading it with a delivered total would silently change
 *    what "the price" means depending on whether a destination happened to be
 *    selected. The delivered figure gets its own hook.
 *  - With `delivery` absent the card is byte-for-byte the pre-expansion card.
 *    That is what makes the existing suites descriptions of real behaviour rather
 *    than of a legacy branch nobody reaches.
 */

const renderCard = (props: Parameters<typeof ProductCard>[0]) =>
  render(
    <MemoryRouter>
      <ProductCard {...props} />
    </MemoryRouter>,
  );

/** Intl inserts non-breaking spaces; compare on normalised whitespace. */
const text = () => document.body.textContent?.replace(/[\s\u00a0]+/g, ' ') ?? '';

describe('ProductCard with no destination', () => {
  it('renders the pre-expansion layout, with no delivered hook at all', () => {
    renderCard({ product: makeProduct(), onTrack: vi.fn() });

    expect(screen.getByTestId('current-price')).toHaveAttribute('data-price', '140');
    expect(screen.queryByTestId('delivered-price')).toBeNull();
    expect(screen.queryByTestId('demo-store-notice')).toBeNull();
    expect(text()).not.toMatch(/delivered to/i);
  });

  it('says nothing about a destination when only the currency is supplied', () => {
    // A half-configured call must not half-activate the feature.
    renderCard({ product: makeProduct(), displayCurrency: 'EUR', onTrack: vi.fn() });
    expect(screen.queryByTestId('delivered-price')).toBeNull();
  });
});

describe('ProductCard with a destination', () => {
  it('adds a delivered-price hook carrying the numeric total', () => {
    renderCard({
      product: makeProduct(),
      delivery: makeDelivery(),
      displayCurrency: 'EUR',
      onTrack: vi.fn(),
    });

    const delivered = screen.getByTestId('delivered-price');
    expect(delivered).toHaveAttribute('data-delivered', '311.9');
    expect(text()).toContain('delivered to Finland');
  });

  it('keeps current-price on the store’s own price, unchanged', () => {
    renderCard({
      product: makeProduct(),
      delivery: makeDelivery(),
      displayCurrency: 'EUR',
      onTrack: vi.fn(),
    });

    // The list price keeps its exclusive hook and its own value; the delivered
    // total is a second, separate number.
    expect(screen.getByTestId('current-price')).toHaveAttribute('data-price', '140');
    expect(screen.getAllByTestId('current-price')).toHaveLength(1);
  });

  it('states the source country and the delivery window', () => {
    renderCard({
      product: makeProduct(),
      delivery: makeDelivery(),
      displayCurrency: 'EUR',
      onTrack: vi.fn(),
    });

    expect(text()).toContain('Germany (cross-border)');
    expect(text()).toContain('3–6 business days');
  });
});

describe('unknown shipping is never free', () => {
  it('shows no delivered total and says the cost is unknown', () => {
    renderCard({
      product: makeProduct(),
      delivery: makeUnknownShippingDelivery(),
      displayCurrency: 'EUR',
      onTrack: vi.fn(),
    });

    const delivered = screen.getByTestId('delivered-price');
    // The hook is present so "no total was computed" is distinguishable from "no
    // destination was asked about" — but it carries no number.
    expect(delivered).not.toHaveAttribute('data-delivered');
    expect(delivered).toHaveTextContent(/No delivered total can be calculated for Finland yet/i);
    expect(screen.getByText(DELIVERY_COPY.unknownShipping)).toBeInTheDocument();
    expect(text()).toContain('Not published');
    expect(text()).not.toMatch(/delivery: free/i);
  });

  it('labels the list price as being before delivery', () => {
    renderCard({
      product: makeProduct(),
      delivery: makeUnknownShippingDelivery(),
      displayCurrency: 'EUR',
      onTrack: vi.fn(),
    });

    expect(text()).toMatch(/299 € before delivery/);
  });

  it('says a store does not ship there, rather than leaving it blank', () => {
    renderCard({
      product: makeProduct(),
      delivery: makeUnshippableDelivery(),
      displayCurrency: 'EUR',
      onTrack: vi.fn(),
    });

    expect(screen.getByText(DELIVERY_COPY.doesNotShip('Finland'))).toBeInTheDocument();
    expect(screen.queryByTestId('delivered-price')).toBeNull();
  });
});

describe('currency honesty', () => {
  it('explains a missing rate as incomparable, not as cheap', () => {
    renderCard({
      product: makeProduct(),
      delivery: makeRateMissingDelivery(),
      displayCurrency: 'EUR',
      onTrack: vi.fn(),
    });

    expect(screen.getByText(DELIVERY_COPY.noRate('SEK', 'EUR'))).toBeInTheDocument();
    expect(screen.getByTestId('delivered-price')).not.toHaveAttribute('data-delivered');
  });

  it('warns that a stale rate makes the total an estimate that cannot win', () => {
    renderCard({
      product: makeProduct(),
      delivery: makeStaleRateDelivery(),
      displayCurrency: 'EUR',
      onTrack: vi.fn(),
    });

    expect(text()).toMatch(/Exchange rate last updated 10 days ago/);
    expect(text()).toMatch(/is not shown as the cheapest/);
  });

  it('discloses a conversion and names the store’s own currency', () => {
    renderCard({
      product: makeProduct(),
      delivery: makeConvertedDelivery(),
      displayCurrency: 'EUR',
      onTrack: vi.fn(),
    });

    expect(screen.getByText('Converted')).toBeInTheDocument();
    expect(text()).toMatch(/the store charges in SEK/);
  });

  it('says import charges may apply without claiming to have calculated them', () => {
    renderCard({
      product: makeProduct(),
      delivery: makeDutiableDelivery(),
      displayCurrency: 'EUR',
      onTrack: vi.fn(),
    });

    expect(screen.getByText(DELIVERY_COPY.dutyPossible)).toBeInTheDocument();
    expect(text()).not.toMatch(/import charges of/i);
  });
});

describe('demo-store disclosure', () => {
  it('appears as visible text, not only as a badge or a tooltip', () => {
    renderCard({
      product: makeProduct(),
      delivery: makeDelivery(),
      displayCurrency: 'EUR',
      isDemoStore: true,
      onTrack: vi.fn(),
    });

    const notice = screen.getByTestId('demo-store-notice');
    expect(notice).toBeVisible();
    expect(notice).toHaveTextContent(/Demo store/);
    expect(notice).toHaveTextContent(DELIVERY_COPY.demoCatalogue);
    // No `title` attribute doing the disclosing — unreachable by touch.
    expect(notice.querySelector('[title]')).toBeNull();
  });

  it('is absent for a real retailer', () => {
    renderCard({
      product: makeProduct(),
      delivery: makeDelivery(),
      displayCurrency: 'EUR',
      onTrack: vi.fn(),
    });
    expect(screen.queryByTestId('demo-store-notice')).toBeNull();
  });
});

// ── Grouped card ────────────────────────────────────────────────────────────

const renderGrouped = (destination: GroupDestinationSummary | null) =>
  render(
    <MemoryRouter>
      <GroupedProductCard group={makeCanonicalProduct()} destination={destination} />
    </MemoryRouter>,
  );

const summary = (overrides: Partial<GroupDestinationSummary> = {}): GroupDestinationSummary => ({
  country: 'FI',
  currency: 'EUR',
  lowestDelivered: makeMoneyAmount(311.9),
  lowestListed: makeMoneyAmount(299),
  storesShipping: 4,
  storesTotal: 7,
  offersWithUnknownShipping: 0,
  hasDemoStore: false,
  ...overrides,
});

describe('GroupedProductCard', () => {
  it('emits no current-price hook, with or without a destination', () => {
    renderGrouped(null);
    expect(screen.queryByTestId('current-price')).toBeNull();

    renderGrouped(summary());
    // A group has a *range*, not a price; claiming the single-price hook would
    // make the E2E sort assertions read a number that belongs to nothing.
    expect(screen.queryByTestId('current-price')).toBeNull();
  });

  it('renders the pre-expansion card when no destination is selected', () => {
    renderGrouped(null);

    expect(screen.queryByTestId('delivered-price')).toBeNull();
    expect(text()).not.toMatch(/delivered to/i);
    expect(text()).not.toMatch(/ship to Finland/i);
  });

  it('leads with the lowest delivered total and names the destination', () => {
    renderGrouped(summary());

    // Asserted as two nodes rather than one string: the gap between them is a
    // flex gap, so `textContent` runs the amount straight into the caption.
    const delivered = screen.getByTestId('delivered-price');
    expect(delivered).toHaveAttribute('data-delivered', '311.9');
    expect(delivered).toHaveTextContent(/^From 311,90 €$/);
    expect(screen.getByText('delivered to Finland')).toBeInTheDocument();
  });

  it('counts shipping stores from offers, and says so out of the total', () => {
    renderGrouped(summary());
    expect(text()).toMatch(/4 of 7 ship to Finland/);
  });

  it('says no delivered total can be calculated, and marks the listed price', () => {
    renderGrouped(summary({ lowestDelivered: null }));

    expect(text()).toMatch(/No delivered total can be calculated for Finland yet/);
    expect(text()).toMatch(/299 €/);
    expect(text()).toMatch(/before delivery/);
  });

  it('discloses a demo store in the group', () => {
    renderGrouped(summary({ hasDemoStore: true }));
    expect(screen.getByTestId('demo-store-notice')).toBeInTheDocument();
  });
});
