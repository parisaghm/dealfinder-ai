import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { makeCanonicalProduct, makeProduct } from '../../test/factories';
import { GroupedProductCard } from './GroupedProductCard';

const renderCard = (props: Parameters<typeof GroupedProductCard>[0]) =>
  render(
    <MemoryRouter>
      <GroupedProductCard {...props} />
    </MemoryRouter>,
  );

/** Intl inserts non-breaking spaces; compare on normalised whitespace. */
const text = () => document.body.textContent?.replace(/[\s\u00A0]+/g, ' ') ?? '';

describe('GroupedProductCard', () => {
  it('shows the product, the store count and the price range', () => {
    renderCard({ group: makeCanonicalProduct() });

    expect(screen.getByRole('heading', { name: /Sony WH-1000XM5/i })).toBeInTheDocument();
    expect(screen.getByText('3 stores')).toBeInTheDocument();
    expect(text()).toContain('319 €');
    expect(text()).toContain('339 €');
  });

  it('states the saving against the dearest current offer', () => {
    renderCard({ group: makeCanonicalProduct() });
    expect(text()).toMatch(/Save 20 €.*versus the dearest offer/);
  });

  it('names the cheapest store', () => {
    renderCard({ group: makeCanonicalProduct() });
    expect(text()).toContain('Cheapest at Gigantti');
  });

  it('links to the comparison page as an internal link', () => {
    renderCard({ group: makeCanonicalProduct() });

    const link = screen.getByRole('link', { name: /compare offers/i });
    expect(link).toHaveAttribute('href', '/compare/canonical-1');
    // Internal navigation, so no new tab and no external-link semantics.
    expect(link).not.toHaveAttribute('target');
  });

  it('shows the deal-quality verdict for the offer it recommends', () => {
    renderCard({ group: makeCanonicalProduct() });
    expect(screen.getByText(/good deal/i)).toBeInTheDocument();
  });

  // The promise test. A grouping the matcher was unsure about must say so in
  // words on the card — never only in a colour, and never nowhere.
  it('says so, in words, when the match is unconfirmed', () => {
    renderCard({ group: makeCanonicalProduct({ matchConfidence: 'MEDIUM' }) });
    expect(screen.getByText(/unconfirmed match/i)).toBeInTheDocument();
  });

  it('shows a single variant difference immediately rather than behind a disclosure', () => {
    renderCard({
      group: makeCanonicalProduct({
        variantNotes: ['Colour differs between stores: Black (Gigantti) · White (Power).'],
      }),
    });
    expect(screen.getByText(/Colour differs between stores/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /other difference/i })).not.toBeInTheDocument();
  });

  it('puts further differences behind a labelled disclosure', async () => {
    const user = userEvent.setup();
    renderCard({
      group: makeCanonicalProduct({
        variantNotes: ['Colour differs between stores.', 'Bundled accessories differ.'],
      }),
    });

    const toggle = screen.getByRole('button', { name: /1 other difference/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Bundled accessories differ.')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Bundled accessories differ.')).toBeInTheDocument();
  });

  it('claims no range and no saving for a single-store product', () => {
    renderCard({
      group: makeCanonicalProduct({
        offerCount: 1,
        storeCount: 1,
        storeSlugs: ['gigantti'],
        lowestPrice: 329,
        highestPrice: 329,
        savingsAgainstHighest: 0,
        savingsPercentAgainstHighest: 0,
      }),
    });

    expect(screen.getByText('1 store')).toBeInTheDocument();
    expect(text()).not.toMatch(/Save .* versus the dearest offer/);
  });

  /**
   * A regression guard, not a style preference.
   *
   * `data-testid="current-price"` means "one store's current price", and the
   * existing E2E sort-ordering test reads every instance of it on the page. A
   * grouped card emitting one would poison that read the moment anyone combined
   * grouping with a sort.
   */
  it('does not emit the single-offer price test hook', () => {
    const { container } = renderCard({ group: makeCanonicalProduct() });
    expect(container.querySelector('[data-testid="current-price"]')).toBeNull();
  });

  it('gives the image meaningful alt text', () => {
    renderCard({ group: makeCanonicalProduct() });
    expect(screen.getByAltText('Sony WH-1000XM5')).toBeInTheDocument();
  });

  it('tracks the offer it recommends, not an arbitrary one', async () => {
    const user = userEvent.setup();
    const onTrackBest = vi.fn();
    renderCard({
      group: makeCanonicalProduct({
        bestOffer: makeProduct({ id: 'offer-gigantti' }),
      }),
      onTrackBest,
    });

    await user.click(screen.getByRole('button', { name: /track cheapest/i }));
    expect(onTrackBest).toHaveBeenCalledWith(expect.objectContaining({ id: 'offer-gigantti' }));
  });
});
