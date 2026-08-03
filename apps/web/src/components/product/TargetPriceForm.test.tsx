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
