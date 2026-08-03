import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCanonicalOffer, makeComparison, makeOfferTrio } from '../../test/factories';
import { setViewportMatches } from '../../test/setup';
import { OfferComparisonTable } from './OfferComparisonTable';

const defaults = {
  offers: makeOfferTrio(),
  currency: 'EUR' as const,
  productName: 'Sony WH-1000XM5',
  sort: 'lowest-total' as const,
  onSortChange: vi.fn(),
  comparison: makeComparison(),
};

const renderTable = (props: Partial<Parameters<typeof OfferComparisonTable>[0]> = {}) =>
  render(<OfferComparisonTable {...defaults} {...props} />);

const text = () => document.body.textContent?.replace(/[\s ]+/g, ' ') ?? '';

afterEach(() => {
  setViewportMatches(true);
});

describe('OfferComparisonTable — wide layout', () => {
  it('publishes every column the comparison needs, plus a caption', () => {
    renderTable();

    for (const header of [
      'Store',
      'Product price',
      'Shipping',
      'Total',
      'Availability',
      'Discount',
      'Deal quality',
      'Last checked',
    ]) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(screen.getByRole('table', { name: /Offers for Sony WH-1000XM5/i })).toBeInTheDocument();
  });

  /**
   * The core promise of the whole feature.
   *
   * Verkkokauppa lists the lowest price (319 €) but charges 12,90 € delivery.
   * Gigantti lists 329 € with free delivery and is therefore cheaper to buy
   * from. Highlighting the listed price would recommend the wrong shop with
   * complete confidence.
   */
  it('highlights the cheapest TOTAL, not the cheapest listed price', () => {
    renderTable();

    const winner = screen.getByRole('row', { name: /cheapest total/i });
    expect(within(winner).getByText('Gigantti')).toBeInTheDocument();

    const listedLeader = screen.getByRole('row', { name: /Verkkokauppa\.com/i });
    expect(within(listedLeader).queryByText(/cheapest total/i)).not.toBeInTheDocument();
  });

  it('shows shipping and total as separate, checkable numbers', () => {
    renderTable();
    const row = screen.getByRole('row', { name: /Verkkokauppa\.com/i });
    expect(within(row).getByText(/12,90/)).toBeInTheDocument();
    expect(within(row).getByText(/331,90/)).toBeInTheDocument();
  });

  it('says "free" for zero delivery and "not listed" for an unpublished one', () => {
    renderTable({
      offers: [
        makeCanonicalOffer({ id: 'a', shippingPrice: 0 }),
        makeCanonicalOffer({ id: 'b', shippingPrice: null, totalPrice: null }),
      ],
    });
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('Not listed')).toBeInTheDocument();
  });

  // Treating an unlisted delivery cost as free is how a comparison tool ends up
  // recommending the most expensive option.
  it('shows "Total unknown" rather than assuming free delivery', () => {
    renderTable({
      offers: [makeCanonicalOffer({ id: 'a', currentPrice: 200, shippingPrice: null, totalPrice: null })],
      comparison: makeComparison({ cheapestTotalOfferId: null }),
    });
    expect(screen.getByText('Total unknown')).toBeInTheDocument();
    expect(screen.queryByText(/cheapest total/i)).not.toBeInTheDocument();
  });

  it('prints the reason a cheaper offer was passed over', () => {
    renderTable({
      comparison: makeComparison({
        cheapestTotalCaveat: 'A cheaper total of 249.00 is listed at Elsewhere, but it is not currently available to buy.',
      }),
    });
    expect(screen.getByText(/not currently available to buy/i)).toBeInTheDocument();
  });

  it('reports a sort change', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    renderTable({ onSortChange });

    await user.selectOptions(screen.getByLabelText(/sort offers by/i), 'lowest-price');
    expect(onSortChange).toHaveBeenCalledWith('lowest-price');
  });

  it('marks an out-of-stock offer without hiding it', () => {
    renderTable({
      offers: [makeCanonicalOffer({ id: 'a', availability: 'OUT_OF_STOCK' })],
    });
    expect(screen.getByText(/out of stock/i)).toBeInTheDocument();
  });
});

describe('OfferComparisonTable — narrow layout', () => {
  /**
   * Nine columns is roughly two and a half screen-widths of panning at 375px,
   * and never shows Shipping and Total together — the exact pair the highlight
   * is about. A card per store fits one whole offer instead.
   */
  it('renders one list item per store instead of a table', () => {
    setViewportMatches(false);
    renderTable();

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('keeps every fact, and the same highlight, in the card layout', () => {
    setViewportMatches(false);
    renderTable();

    const [first] = screen.getAllByRole('listitem');
    expect(first).toBeDefined();
    expect(within(first!).getByText('Gigantti')).toBeInTheDocument();
    expect(within(first!).getByText(/cheapest total/i)).toBeInTheDocument();

    for (const label of ['Product price', 'Shipping', 'Total', 'Availability', 'Deal quality']) {
      expect(within(first!).getByText(label)).toBeInTheDocument();
    }
    expect(text()).toContain('331,90');
  });
});
