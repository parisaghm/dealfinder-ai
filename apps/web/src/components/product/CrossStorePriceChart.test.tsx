import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CrossStorePriceChart, type StoreSeries } from './CrossStorePriceChart';

/**
 * These tests target the legend, the filter and the values table — not the SVG.
 *
 * `ResponsiveContainer` measures 0×0 in jsdom and renders no plot at all, so
 * asserting on paths would test nothing. The parts that carry meaning without a
 * mouse are exactly the parts that *are* reachable here, which is a reasonable
 * proxy for the parts that matter.
 */

function day(offset: number): string {
  return new Date(Date.UTC(2026, 6, 1 + offset)).toISOString();
}

const SERIES: StoreSeries[] = [
  {
    storeSlug: 'gigantti',
    storeName: 'Gigantti',
    points: [
      { price: 400, recordedAt: day(0) },
      { price: 329, recordedAt: day(4) },
    ],
  },
  {
    storeSlug: 'power',
    storeName: 'Power',
    points: [
      { price: 420, recordedAt: day(0) },
      { price: 339, recordedAt: day(3) },
    ],
  },
  {
    storeSlug: 'verkkokauppa',
    storeName: 'Verkkokauppa.com',
    points: [
      { price: 410, recordedAt: day(1) },
      { price: 319, recordedAt: day(5) },
    ],
  },
];

const ALL_SLUGS = SERIES.map((entry) => entry.storeSlug);

const renderChart = (props: Partial<Parameters<typeof CrossStorePriceChart>[0]> = {}) =>
  render(
    <CrossStorePriceChart
      series={SERIES}
      currency="EUR"
      visibleStoreSlugs={ALL_SLUGS}
      onVisibleStoresChange={vi.fn()}
      crossStoreLow={319}
      {...props}
    />,
  );

describe('CrossStorePriceChart — the legend is the filter', () => {
  it('offers one toggle per store, all on by default', () => {
    renderChart();

    for (const name of ['Gigantti', 'Power', 'Verkkokauppa.com']) {
      const chip = screen.getByRole('button', { name: new RegExp(`^${name}`) });
      expect(chip).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('names each store in text, so identity is never colour-alone', () => {
    renderChart();
    expect(screen.getByRole('button', { name: /^Gigantti/ })).toHaveTextContent('Gigantti');
  });

  it('reports the store being switched off', async () => {
    const user = userEvent.setup();
    const onVisibleStoresChange = vi.fn();
    renderChart({ onVisibleStoresChange });

    await user.click(screen.getByRole('button', { name: /^Power/ }));

    expect(onVisibleStoresChange).toHaveBeenCalledWith(['gigantti', 'verkkokauppa']);
  });

  // An empty chart is never a useful state, and there is no affordance to
  // recover from it other than re-enabling something.
  it('refuses to switch off the last remaining store', async () => {
    const user = userEvent.setup();
    const onVisibleStoresChange = vi.fn();
    renderChart({ visibleStoreSlugs: ['gigantti'], onVisibleStoresChange });

    await user.click(screen.getByRole('button', { name: /^Gigantti/ }));
    expect(onVisibleStoresChange).not.toHaveBeenCalled();
  });

  it('shows a hidden store as unpressed rather than removing its control', () => {
    renderChart({ visibleStoreSlugs: ['gigantti', 'verkkokauppa'] });
    expect(screen.getByRole('button', { name: /^Power/ })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('CrossStorePriceChart — the values table', () => {
  it('exposes every value without hovering', async () => {
    const user = userEvent.setup();
    renderChart();

    const toggle = screen.getByRole('button', { name: /show values as a table/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const table = screen.getByRole('table', { name: /recorded prices by store/i });
    for (const name of ['Gigantti', 'Power', 'Verkkokauppa.com']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
  });

  it('drops a hidden store’s column from the table', async () => {
    const user = userEvent.setup();
    renderChart({ visibleStoreSlugs: ['gigantti', 'verkkokauppa'] });

    await user.click(screen.getByRole('button', { name: /show values as a table/i }));

    const table = screen.getByRole('table', { name: /recorded prices by store/i });
    expect(within(table).queryByRole('columnheader', { name: 'Power' })).not.toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Gigantti' })).toBeInTheDocument();
  });

  /**
   * Colour follows the store, never the row's rank.
   *
   * A reader who has learned "orange is Power" must not have to relearn it
   * because they filtered something out. The mapping is derived from the full
   * store list precisely so that filtering cannot repaint the survivors.
   */
  it('keeps each store’s swatch colour when another store is hidden', () => {
    const { container, rerender } = renderChart();
    const swatchColour = (name: string) => {
      const chip = within(container).getByRole('button', { name: new RegExp(`^${name}`) });
      return chip.querySelector('span[style]')?.getAttribute('style');
    };

    const before = swatchColour('Verkkokauppa.com');

    rerender(
      <CrossStorePriceChart
        series={SERIES}
        currency="EUR"
        visibleStoreSlugs={['gigantti', 'verkkokauppa']}
        onVisibleStoresChange={vi.fn()}
        crossStoreLow={319}
      />,
    );

    expect(swatchColour('Verkkokauppa.com')).toBe(before);
  });
});

describe('CrossStorePriceChart — degenerate input', () => {
  it('says so rather than drawing a chart from one observation', () => {
    renderChart({
      series: [
        { storeSlug: 'gigantti', storeName: 'Gigantti', points: [{ price: 329, recordedAt: day(0) }] },
      ],
      visibleStoreSlugs: ['gigantti'],
    });
    expect(screen.getByText(/not enough price history/i)).toBeInTheDocument();
  });

  it('reports how many stores are plotted', () => {
    renderChart({ visibleStoreSlugs: ['gigantti'] });
    expect(screen.getByText('1 of 3 stores shown')).toBeInTheDocument();
  });
});
