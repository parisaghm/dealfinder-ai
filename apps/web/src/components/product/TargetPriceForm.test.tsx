import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TargetPriceForm } from './TargetPriceForm';

/**
 * The target-price form is the app's most important input: a wrong number here
 * means either no alert or an immediate useless one. These tests cover the
 * validation rules and the accessibility wiring.
 */

const baseProps = {
  currency: 'EUR' as const,
  currentPrice: 200,
  lowestPrice: 150,
  averagePrice: 180,
  isTracked: false,
};

describe('TargetPriceForm', () => {
  it('labels its input and associates the description', () => {
    render(<TargetPriceForm {...baseProps} onSubmit={vi.fn()} />);

    const input = screen.getByLabelText(/alert me when the price drops to/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription(/we will email you once/i);
  });

  it('submits a valid target price as a number', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<TargetPriceForm {...baseProps} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/alert me when/i), '149');
    await user.click(screen.getByRole('button', { name: /track this price/i }));

    expect(onSubmit).toHaveBeenCalledWith(149);
  });

  it('accepts a decimal comma, as Finnish input uses', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<TargetPriceForm {...baseProps} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/alert me when/i), '149,90');
    await user.click(screen.getByRole('button', { name: /track this price/i }));

    expect(onSubmit).toHaveBeenCalledWith(149.9);
  });

  it('treats an empty field as tracking without a target', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<TargetPriceForm {...baseProps} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: /track this price/i }));

    expect(onSubmit).toHaveBeenCalledWith(null);
  });

  // A target at or above the current price fires instantly and is almost always
  // a mistake, so it is explained rather than silently accepted.
  it('refuses a target at or above the current price, and says why', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<TargetPriceForm {...baseProps} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/alert me when/i), '250');
    await user.click(screen.getByRole('button', { name: /track this price/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/at or above the current/i);
  });

  it('rejects non-numeric input', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<TargetPriceForm {...baseProps} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/alert me when/i), 'cheap please');
    await user.click(screen.getByRole('button', { name: /track this price/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('rejects zero and negative targets', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<TargetPriceForm {...baseProps} onSubmit={onSubmit} />);

    const input = screen.getByLabelText(/alert me when/i);
    await user.type(input, '0');
    await user.click(screen.getByRole('button', { name: /track this price/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/above zero/i);
  });

  it('marks the input invalid so assistive tech announces the error', async () => {
    const user = userEvent.setup();
    render(<TargetPriceForm {...baseProps} onSubmit={vi.fn()} />);

    const input = screen.getByLabelText(/alert me when/i);
    await user.type(input, '999');
    await user.click(screen.getByRole('button', { name: /track this price/i }));

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/at or above the current/i);
  });

  it('offers suggestions that fill the field when clicked', async () => {
    const user = userEvent.setup();
    render(<TargetPriceForm {...baseProps} onSubmit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /match its low/i }));

    expect(screen.getByLabelText(/alert me when/i)).toHaveValue('150');
  });

  it('pre-fills and relabels when the product is already tracked', () => {
    render(<TargetPriceForm {...baseProps} isTracked initialTarget={160} onSubmit={vi.fn()} />);

    expect(screen.getByLabelText(/alert me when/i)).toHaveValue('160');
    expect(screen.getByRole('button', { name: /update target price/i })).toBeInTheDocument();
  });

  it('shows a server-side error passed in from the page', () => {
    render(<TargetPriceForm {...baseProps} onSubmit={vi.fn()} error="Already tracking this." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Already tracking this.');
  });

  it('disables the button while a submission is in flight', () => {
    render(<TargetPriceForm {...baseProps} pending onSubmit={vi.fn()} />);
    const button = screen.getByRole('button', { name: /track this price/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});

/**
 * With a destination, the same form sets a *delivered* threshold.
 *
 * The reference price becomes the delivered total rather than the shelf price,
 * because a target checked against the wrong number is either an alert that never
 * fires or one that fires immediately. When no delivered total is known the form
 * stops comparing altogether rather than falling back to the list price.
 */
describe('TargetPriceForm with a destination', () => {
  const destination = { country: 'FI' as const, currency: 'EUR' as const, deliveredPrice: 311.9 };

  it('names both the destination and the currency', () => {
    render(<TargetPriceForm {...baseProps} destination={destination} onSubmit={vi.fn()} />);

    const input = screen.getByLabelText(/Notify me when the delivered price to Finland is below/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription(/total delivered to Finland reaches this EUR amount/i);
  });

  it('relabels the submit button so it is clear which threshold is being set', () => {
    render(<TargetPriceForm {...baseProps} destination={destination} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /track delivered price/i })).toBeInTheDocument();
  });

  it('compares against the delivered total, not the shelf price', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<TargetPriceForm {...baseProps} destination={destination} onSubmit={onSubmit} />);

    // 250 is above the €200 shelf price but below the €311.90 delivered total, so
    // it is a perfectly sensible delivered target and must be accepted.
    await user.type(screen.getByLabelText(/delivered price to Finland/i), '250');
    await user.click(screen.getByRole('button', { name: /track delivered price/i }));

    expect(onSubmit).toHaveBeenCalledWith(250);
  });

  it('refuses a target at or above the delivered total, and says which number it means', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<TargetPriceForm {...baseProps} destination={destination} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/delivered price to Finland/i), '320');
    await user.click(screen.getByRole('button', { name: /track delivered price/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/delivered to Finland/i);
  });

  it('stops comparing when no delivered total is known, rather than using the list price', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <TargetPriceForm
        {...baseProps}
        destination={{ ...destination, deliveredPrice: null }}
        onSubmit={onSubmit}
      />,
    );

    // 250 is above the shelf price. With no delivered total there is nothing to
    // compare it to, and inventing a comparison would be the exact dishonesty
    // this feature exists to remove.
    await user.type(screen.getByLabelText(/delivered price to Finland/i), '250');
    await user.click(screen.getByRole('button', { name: /track delivered price/i }));

    expect(onSubmit).toHaveBeenCalledWith(250);
  });

  it('says up front that an unknown delivered total cannot be checked yet', () => {
    render(
      <TargetPriceForm
        {...baseProps}
        destination={{ ...destination, deliveredPrice: null }}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/No delivered total can be calculated for Finland yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Suggestions:/)).toBeNull();
  });

  it('suggests delivered figures, never the list-price low or average', () => {
    render(<TargetPriceForm {...baseProps} destination={destination} onSubmit={vi.fn()} />);

    // 10% below the €311.90 delivered total. The recorded low of €150 and the
    // average of €180 are list-price statistics and would compare two different
    // numbers.
    expect(screen.getByRole('button', { name: '10% less (€280)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /match its low/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /under its average/i })).toBeNull();
  });

  it('shows the destination currency in the field, not a hard-coded euro sign', () => {
    render(
      <TargetPriceForm
        {...baseProps}
        destination={{ country: 'SE', currency: 'SEK', deliveredPrice: 3200 }}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/delivered price to Sweden/i)).toBeInTheDocument();
    // `Intl` gives no dedicated glyph for kronor in a Finnish locale, so the code
    // itself is the addon — unambiguous, which is the only thing that matters for
    // a number the user is about to commit to.
    expect(screen.getByText('SEK')).toBeInTheDocument();
    expect(screen.queryByText('€')).toBeNull();
  });
});
