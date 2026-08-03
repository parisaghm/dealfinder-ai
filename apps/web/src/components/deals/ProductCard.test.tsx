import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { makeDealQuality, makeProduct } from '../../test/factories';
import { ProductCard } from './ProductCard';

const renderCard = (props: Parameters<typeof ProductCard>[0]) =>
  render(
    <MemoryRouter>
      <ProductCard {...props} />
    </MemoryRouter>,
  );

/** Intl inserts non-breaking spaces; compare on normalised whitespace. */
const text = () => document.body.textContent?.replace(/[\s\u00a0]+/g, ' ') ?? '';

describe('ProductCard', () => {
  it('shows every field the brief requires', () => {
    renderCard({ product: makeProduct(), onTrack: vi.fn() });

    expect(screen.getByRole('heading', { name: /Sony WH-1000XM5/i })).toBeInTheDocument();
    expect(screen.getByText('Gigantti')).toBeInTheDocument();
    expect(text()).toContain('140 €'); // current price
    expect(text()).toContain('200 €'); // original price
    expect(text()).toContain('-30 %'); // discount
    expect(screen.getByText(/in stock/i)).toBeInTheDocument();
    expect(screen.getByText(/free delivery/i)).toBeInTheDocument();
    expect(screen.getByText(/checked/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view deal/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /track price/i })).toBeInTheDocument();
  });

  it('links to the store as a real external link', () => {
    renderCard({ product: makeProduct(), onTrack: vi.fn() });

    const link = screen.getByRole('link', { name: /view deal/i });
    expect(link).toHaveAttribute('href', 'https://store.test/p/ext-1');
    expect(link).toHaveAttribute('target', '_blank');
    // noreferrer keeps our URL out of the store's referrer logs.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('shows the shipping-inclusive total when delivery is charged', () => {
    renderCard({
      product: makeProduct({ shippingPrice: 5.9, effectivePrice: 145.9 }),
      onTrack: vi.fn(),
    });
    expect(text()).toContain('5,90 € delivery');
    expect(text()).toContain('145,90 € total');
  });

  it('distinguishes an unpublished delivery cost from free delivery', () => {
    renderCard({ product: makeProduct({ shippingPrice: null }), onTrack: vi.fn() });
    expect(screen.getByText(/delivery cost not listed/i)).toBeInTheDocument();
  });

  it('calls onTrack with the product', async () => {
    const onTrack = vi.fn();
    const user = userEvent.setup();
    const product = makeProduct();
    renderCard({ product, onTrack });

    await user.click(screen.getByRole('button', { name: /track price/i }));
    expect(onTrack).toHaveBeenCalledWith(product);
  });

  it('shows an already-tracked product as tracking, and disables the button', () => {
    renderCard({ product: makeProduct({ isTracked: true }), onTrack: vi.fn() });

    const button = screen.getByRole('button', { name: /tracking/i });
    expect(button).toBeDisabled();
  });

  it('omits the track button entirely when no handler is given', () => {
    renderCard({ product: makeProduct() });
    expect(screen.queryByRole('button', { name: /track price/i })).not.toBeInTheDocument();
  });

  it('shows the deal-quality label with its justification', () => {
    renderCard({
      product: makeProduct({
        dealQuality: makeDealQuality({
          label: 'EXCELLENT',
          headline: 'This is the lowest price we have recorded.',
        }),
      }),
      onTrack: vi.fn(),
    });

    expect(screen.getByText('Excellent deal')).toBeInTheDocument();
    expect(screen.getByText(/lowest price we have recorded/i)).toBeInTheDocument();
  });

  // The product's core promise: an unsupported discount must be visibly flagged,
  // and not only by colour.
  it('flags a discount the price history contradicts', () => {
    renderCard({
      product: makeProduct({
        dealQuality: makeDealQuality({
          claimedDiscountTrustworthy: false,
          warnings: ['This "discounted" price is what the product normally costs.'],
        }),
      }),
      onTrack: vi.fn(),
    });

    // Announced to assistive technology, not conveyed by the badge colour alone.
    expect(
      screen.getByText(/discount does not match our price records/i),
    ).toBeInTheDocument();
  });

  it('marks an out-of-stock product', () => {
    renderCard({ product: makeProduct({ availability: 'OUT_OF_STOCK' }), onTrack: vi.fn() });
    expect(screen.getByText(/out of stock/i)).toBeInTheDocument();
  });

  it('hides the discount badge when there is no substantiated discount', () => {
    renderCard({
      product: makeProduct({ discountPercent: 0, originalPrice: null }),
      onTrack: vi.fn(),
    });
    expect(text()).not.toContain('-0 %');
  });

  it('gives the image a meaningful alt text', () => {
    renderCard({ product: makeProduct(), onTrack: vi.fn() });
    expect(screen.getByAltText(/Sony WH-1000XM5/i)).toBeInTheDocument();
  });
});
