import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MetaResponse } from '../../lib/api-client';
import { FilterPanel, SortSelect, type FilterValues } from './FilterPanel';

const meta: MetaResponse = {
  stores: [
    {
      id: '1',
      slug: 'gigantti',
      name: 'Gigantti',
      websiteUrl: 'https://g.test',
      logoUrl: null,
      isActive: true,
    },
    {
      id: '2',
      slug: 'power',
      name: 'Power',
      websiteUrl: 'https://p.test',
      logoUrl: null,
      isActive: true,
    },
  ],
  verticals: [
    {
      id: 'electronics',
      label: 'Electronics',
      tagline: '',
      currency: 'EUR',
      exampleSearches: [],
      categories: [
        { id: 'headphones', label: 'Headphones', description: null },
        { id: 'laptops', label: 'Laptops', description: null },
      ],
    },
  ],
};

const empty: FilterValues = {
  maximumPrice: '',
  minimumDiscount: '',
  category: '',
  stores: [],
};

describe('FilterPanel', () => {
  it('renders every control with an accessible label', () => {
    render(<FilterPanel meta={meta} values={empty} onApply={vi.fn()} onClear={vi.fn()} />);

    expect(screen.getByLabelText(/maximum price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/minimum discount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^category$/i)).toBeInTheDocument();
    // The store checkboxes are in a labelled fieldset.
    expect(screen.getByRole('group', { name: /stores/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Gigantti' })).toBeInTheDocument();
  });

  it('populates category options from the vertical registry, not hard-coded values', () => {
    render(<FilterPanel meta={meta} values={empty} onApply={vi.fn()} onClear={vi.fn()} />);
    const select = screen.getByLabelText(/^category$/i);
    expect(select).toHaveDisplayValue('All categories');
    expect(screen.getByRole('option', { name: 'Headphones' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Laptops' })).toBeInTheDocument();
  });

  // Filters are applied on submit, not per keystroke, so results stay stable
  // while the user is still deciding.
  it('does not call onApply until the form is submitted', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<FilterPanel meta={meta} values={empty} onApply={onApply} onClear={vi.fn()} />);

    await user.type(screen.getByLabelText(/maximum price/i), '500');
    expect(onApply).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /apply filters/i }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ maximumPrice: '500' }));
  });

  it('collects several filters into one apply call', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<FilterPanel meta={meta} values={empty} onApply={onApply} onClear={vi.fn()} />);

    await user.type(screen.getByLabelText(/maximum price/i), '800');
    await user.selectOptions(screen.getByLabelText(/minimum discount/i), '30');
    await user.selectOptions(screen.getByLabelText(/^category$/i), 'laptops');
    await user.click(screen.getByRole('checkbox', { name: 'Power' }));
    await user.click(screen.getByRole('button', { name: /apply filters/i }));

    expect(onApply).toHaveBeenCalledWith({
      maximumPrice: '800',
      minimumDiscount: '30',
      category: 'laptops',
      stores: ['power'],
    });
  });

  it('toggles a store off again', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(
      <FilterPanel
        meta={meta}
        values={{ ...empty, stores: ['gigantti'] }}
        onApply={onApply}
        onClear={vi.fn()}
      />,
    );

    const checkbox = screen.getByRole('checkbox', { name: 'Gigantti' });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: /apply filters/i }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ stores: [] }));
  });

  it('reflects incoming values, so browser back stays in sync', () => {
    render(
      <FilterPanel
        meta={meta}
        values={{ maximumPrice: '1200', minimumDiscount: '20', category: 'laptops', stores: ['power'] }}
        onApply={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/maximum price/i)).toHaveValue(1200);
    expect(screen.getByLabelText(/minimum discount/i)).toHaveValue('20');
    expect(screen.getByLabelText(/^category$/i)).toHaveValue('laptops');
    expect(screen.getByRole('checkbox', { name: 'Power' })).toBeChecked();
  });

  it('calls onClear from the clear button', async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    render(<FilterPanel meta={meta} values={empty} onApply={vi.fn()} onClear={onClear} />);

    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it('shows a close button only when used as a drawer', () => {
    const { rerender } = render(
      <FilterPanel meta={meta} values={empty} onApply={vi.fn()} onClear={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /close filters/i })).not.toBeInTheDocument();

    rerender(
      <FilterPanel
        meta={meta}
        values={empty}
        onApply={vi.fn()}
        onClear={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /close filters/i })).toBeInTheDocument();
  });

  it('survives metadata not having loaded yet', () => {
    render(<FilterPanel meta={undefined} values={empty} onApply={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText(/no stores available/i)).toBeInTheDocument();
  });
});

describe('SortSelect', () => {
  it('offers every sort option and reports changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SortSelect value="best-discount" onChange={onChange} />);

    const select = screen.getByLabelText(/sort by/i);
    expect(select).toHaveValue('best-discount');

    await user.selectOptions(select, 'lowest-price');
    expect(onChange).toHaveBeenCalledWith('lowest-price');

    for (const label of ['Best discount', 'Lowest price', 'Highest price', 'Recently updated']) {
      expect(screen.getByRole('option', { name: `Sort: ${label}` })).toBeInTheDocument();
    }
  });
});
