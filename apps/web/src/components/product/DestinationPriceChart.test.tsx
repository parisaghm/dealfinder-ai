import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeDeliveredHistoryPoint, makeMoneyAmount } from '../../test/factories';
import {
  DestinationPriceChart,
  buildDeliveredRows,
  resolveDeliveredPoint,
  type DeliveredStoreSeries,
} from './DestinationPriceChart';

/**
 * The delivered-price chart.
 *
 * As with `CrossStorePriceChart`, `ResponsiveContainer` measures 0×0 in jsdom, so
 * these tests target the heading, the legend, the disclosures and the values
 * table — everything that carries meaning without a mouse. The two pure helpers
 * are tested directly, because they are where the honesty rules actually live:
 * a null total is a gap, and a converted point uses the rate recorded on its own
 * date rather than today's.
 */

function day(offset: number): string {
  return new Date(Date.UTC(2026, 6, 1 + offset)).toISOString();
}

const SERIES: DeliveredStoreSeries[] = [
  {
    storeSlug: 'techhalle',
    storeName: 'TechHalle GmbH',
    hasDestinationOffer: true,
    currency: 'EUR',
    points: [
      makeDeliveredHistoryPoint({ recordedAt: day(0), totalDeliveredPrice: makeMoneyAmount(324) }),
      makeDeliveredHistoryPoint({
        recordedAt: day(4),
        totalDeliveredPrice: makeMoneyAmount(311.9),
      }),
    ],
  },
  {
    storeSlug: 'gigantti',
    storeName: 'Gigantti',
    hasDestinationOffer: true,
    currency: 'EUR',
    points: [
      makeDeliveredHistoryPoint({ recordedAt: day(1), totalDeliveredPrice: makeMoneyAmount(349) }),
      makeDeliveredHistoryPoint({ recordedAt: day(5), totalDeliveredPrice: makeMoneyAmount(329) }),
    ],
  },
  {
    storeSlug: 'nordbyte',
    storeName: 'Nordbyte AB',
    hasDestinationOffer: true,
    currency: 'SEK',
    points: [
      makeDeliveredHistoryPoint({
        recordedAt: day(0),
        productPrice: makeMoneyAmount(3190, 'SEK'),
        totalDeliveredPrice: makeMoneyAmount(3190, 'SEK'),
        exchangeRate: 0.087,
        exchangeRateTimestamp: day(0),
      }),
      makeDeliveredHistoryPoint({
        recordedAt: day(3),
        productPrice: makeMoneyAmount(3090, 'SEK'),
        totalDeliveredPrice: makeMoneyAmount(3090, 'SEK'),
        exchangeRate: 0.088,
        exchangeRateTimestamp: day(3),
      }),
    ],
  },
];

const VISIBLE = SERIES.map((entry) => entry.storeSlug);

function renderChart(props: Partial<Parameters<typeof DestinationPriceChart>[0]> = {}) {
  const onVisibleStoresChange = vi.fn();
  render(
    <DestinationPriceChart
      series={SERIES}
      country="FI"
      displayCurrency="EUR"
      visibleStoreSlugs={VISIBLE}
      onVisibleStoresChange={onVisibleStoresChange}
      {...props}
    />,
  );
  return { onVisibleStoresChange };
}

describe('resolving one observation', () => {
  it('takes a same-currency total as it stands', () => {
    const point = makeDeliveredHistoryPoint({ totalDeliveredPrice: makeMoneyAmount(311.9) });
    expect(resolveDeliveredPoint(point, 'EUR', 'EUR')).toEqual({ value: 311.9, converted: false });
  });

  it('treats a missing total as a gap, never as free delivery', () => {
    const point = makeDeliveredHistoryPoint({
      shippingPrice: null,
      totalDeliveredPrice: null,
    });
    expect(resolveDeliveredPoint(point, 'EUR', 'EUR')).toEqual({
      value: null,
      reason: 'unknown-total',
    });
  });

  it('converts with the rate recorded on that date, not with today’s', () => {
    const point = makeDeliveredHistoryPoint({
      totalDeliveredPrice: makeMoneyAmount(3190, 'SEK'),
      exchangeRate: 0.087,
      exchangeRateTimestamp: day(0),
    });

    const resolved = resolveDeliveredPoint(point, 'SEK', 'EUR');
    expect(resolved).toEqual({
      value: 277.53,
      converted: true,
      rate: 0.087,
      rateAt: day(0),
    });
  });

  it('leaves a gap when no rate was recorded, rather than guessing one', () => {
    const point = makeDeliveredHistoryPoint({
      totalDeliveredPrice: makeMoneyAmount(3190, 'SEK'),
      exchangeRate: null,
    });
    expect(resolveDeliveredPoint(point, 'SEK', 'EUR')).toEqual({ value: null, reason: 'no-rate' });
  });
});

describe('building the rows', () => {
  const visible = new Set(['techhalle']);

  it('carries a value forward, because history records changes rather than polls', () => {
    const rows = buildDeliveredRows(SERIES, new Set(['techhalle', 'gigantti']), 'EUR');

    // Gigantti's first observation is a day after TechHalle's, so its earliest row
    // is genuinely unknown; TechHalle's holds until its own next observation.
    expect(rows[0]?.['techhalle']).toBe(324);
    expect(rows[0]?.['gigantti']).toBeNull();
    expect(rows[1]?.['techhalle']).toBe(324);
    expect(rows[1]?.['gigantti']).toBe(349);
  });

  it('stops carrying forward the moment an observation says the total is unknown', () => {
    const series: DeliveredStoreSeries[] = [
      {
        storeSlug: 'techhalle',
        storeName: 'TechHalle GmbH',
        hasDestinationOffer: true,
        currency: 'EUR',
        points: [
          makeDeliveredHistoryPoint({
            recordedAt: day(0),
            totalDeliveredPrice: makeMoneyAmount(324),
          }),
          // The store withdrew its published delivery cost. Carrying 324 forward
          // would assert a total nobody quoted.
          makeDeliveredHistoryPoint({
            recordedAt: day(2),
            shippingPrice: null,
            totalDeliveredPrice: null,
          }),
          makeDeliveredHistoryPoint({
            recordedAt: day(4),
            totalDeliveredPrice: makeMoneyAmount(311.9),
          }),
        ],
      },
    ];

    const rows = buildDeliveredRows(series, visible, 'EUR');
    expect(rows.map((row) => row['techhalle'])).toEqual([324, null, 311.9]);
  });

  it('returns nothing at all when no visible store has any history', () => {
    expect(buildDeliveredRows(SERIES, new Set(), 'EUR')).toEqual([]);
  });
});

describe('the chart states its destination and currency', () => {
  it('puts both in the heading', () => {
    renderChart();

    expect(screen.getByTestId('destination-chart-heading')).toHaveTextContent(
      'Delivered price history to Finland, in EUR',
    );
  });

  it('says the series is delivered totals, not list prices', () => {
    renderChart();
    expect(screen.getByText(/Product price plus delivery/i)).toBeInTheDocument();
    expect(screen.getByText(/earlier list-price history is a different series/i)).toBeInTheDocument();
  });

  it('follows the destination when it changes', () => {
    renderChart({ country: 'DE', displayCurrency: 'EUR' });
    expect(screen.getByTestId('destination-chart-heading')).toHaveTextContent(
      'Delivered price history to Germany, in EUR',
    );
  });
});

describe('one series per store', () => {
  it('offers one toggle per deliverable store, named in text', () => {
    renderChart();

    for (const name of ['TechHalle GmbH', 'Gigantti', 'Nordbyte AB']) {
      expect(screen.getByRole('button', { name: new RegExp(name, 'i') })).toBeInTheDocument();
    }
    expect(screen.getByText('3 of 3 stores shown')).toBeInTheDocument();
  });

  it('reports the store being switched off rather than hiding its control', async () => {
    const user = userEvent.setup();
    const { onVisibleStoresChange } = renderChart();

    await user.click(screen.getByRole('button', { name: /Gigantti/i }));

    expect(onVisibleStoresChange).toHaveBeenCalledWith(['techhalle', 'nordbyte']);
  });

  it('refuses to switch off the last remaining store', async () => {
    const user = userEvent.setup();
    const { onVisibleStoresChange } = renderChart({ visibleStoreSlugs: ['techhalle'] });

    await user.click(screen.getByRole('button', { name: /TechHalle/i }));

    expect(onVisibleStoresChange).not.toHaveBeenCalled();
  });

  it('excludes a store with no offer to the destination, and says why', () => {
    renderChart({
      series: [
        ...SERIES,
        {
          storeSlug: 'maison-numerique',
          storeName: 'Maison Numérique SAS',
          hasDestinationOffer: false,
          currency: null,
          points: [],
        },
      ],
    });

    expect(screen.getByTestId('destination-chart-excluded')).toHaveTextContent(
      /Maison Numérique SAS does not deliver to Finland/i,
    );
    expect(screen.getByText('3 of 3 stores shown')).toBeInTheDocument();
  });
});

describe('stable colours', () => {
  it('keeps each store’s swatch colour when another store is hidden', () => {
    const { unmount } = render(
      <DestinationPriceChart
        series={SERIES}
        country="FI"
        displayCurrency="EUR"
        visibleStoreSlugs={VISIBLE}
        onVisibleStoresChange={vi.fn()}
      />,
    );

    const colourOf = (name: string) =>
      screen
        .getByRole('button', { name: new RegExp(name, 'i') })
        .querySelector('span[style]')
        ?.getAttribute('style');

    const before = { techhalle: colourOf('TechHalle'), nordbyte: colourOf('Nordbyte') };
    unmount();

    // Gigantti hidden. A reader who learned "this colour is Nordbyte" must not
    // have to relearn it — which is why the palette is keyed on the full store
    // list rather than on the visible subset.
    render(
      <DestinationPriceChart
        series={SERIES}
        country="FI"
        displayCurrency="EUR"
        visibleStoreSlugs={['techhalle', 'nordbyte']}
        onVisibleStoresChange={vi.fn()}
      />,
    );

    expect(colourOf('TechHalle')).toBe(before.techhalle);
    expect(colourOf('Nordbyte')).toBe(before.nordbyte);
  });
});

describe('converted values are labelled as estimates', () => {
  it('names the store, its currency and the per-date rate', () => {
    renderChart();

    const note = screen.getByTestId('destination-chart-converted');
    expect(note).toHaveTextContent(/Nordbyte AB quotes in SEK/i);
    expect(note).toHaveTextContent(/converted at the rate recorded on its own date/i);
    expect(note).toHaveTextContent(/these values are estimates/i);
  });

  it('says nothing about conversion when every store already quotes the display currency', () => {
    renderChart({ series: SERIES.slice(0, 2) });
    expect(screen.queryByTestId('destination-chart-converted')).toBeNull();
  });

  it('explains a missing rate as a deliberate blank', () => {
    renderChart({
      series: [
        {
          ...SERIES[2]!,
          points: [
            makeDeliveredHistoryPoint({
              recordedAt: day(0),
              totalDeliveredPrice: makeMoneyAmount(3190, 'SEK'),
              exchangeRate: null,
            }),
          ],
        },
      ],
    });

    expect(screen.getByTestId('destination-chart-gaps')).toHaveTextContent(
      /no exchange rate was recorded for that day. Nothing is filled in/i,
    );
  });
});

describe('the values table', () => {
  it('exposes every value without hovering, and marks unknown dates with a dash', async () => {
    const user = userEvent.setup();
    renderChart({
      series: [
        {
          storeSlug: 'techhalle',
          storeName: 'TechHalle GmbH',
          hasDestinationOffer: true,
          currency: 'EUR',
          points: [
            makeDeliveredHistoryPoint({
              recordedAt: day(0),
              shippingPrice: null,
              totalDeliveredPrice: null,
            }),
            makeDeliveredHistoryPoint({
              recordedAt: day(2),
              totalDeliveredPrice: makeMoneyAmount(311.9),
            }),
          ],
        },
      ],
      visibleStoreSlugs: ['techhalle'],
    });

    await user.click(screen.getByRole('button', { name: /show values as a table/i }));

    const table = screen.getByRole('table');
    expect(table).toHaveAccessibleName(/Delivered totals to Finland by store, in EUR/i);
    const cells = within(table).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toContain('—');
    expect(table.textContent).toMatch(/311,90/);
  });

  it('drops a hidden store’s column, so the table and the chart agree', async () => {
    const user = userEvent.setup();
    renderChart({ visibleStoreSlugs: ['techhalle'] });

    await user.click(screen.getByRole('button', { name: /show values as a table/i }));

    const headers = within(screen.getByRole('table'))
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual(['Date', 'TechHalle GmbH']);
  });
});

describe('no data and not enough data', () => {
  it('says no store reaches the destination rather than drawing an empty axis', () => {
    renderChart({
      series: [
        {
          storeSlug: 'maison-numerique',
          storeName: 'Maison Numérique SAS',
          hasDestinationOffer: false,
          currency: null,
          points: [],
        },
      ],
      visibleStoreSlugs: [],
    });

    expect(screen.getByTestId('destination-chart-empty')).toHaveTextContent(
      /No store has an offer that reaches Finland/i,
    );
  });

  it('refuses to draw a chart from a single observation', () => {
    renderChart({
      series: [
        {
          storeSlug: 'techhalle',
          storeName: 'TechHalle GmbH',
          hasDestinationOffer: true,
          currency: 'EUR',
          points: [makeDeliveredHistoryPoint({ recordedAt: day(0) })],
        },
      ],
      visibleStoreSlugs: ['techhalle'],
    });

    expect(screen.getByTestId('destination-chart-insufficient')).toHaveTextContent(
      /Not enough delivered-price history recorded for Finland yet/i,
    );
  });

  it('never falls back to the product’s list-price history', () => {
    renderChart({ series: [], visibleStoreSlugs: [] });

    expect(screen.getByTestId('destination-chart-empty')).toBeInTheDocument();
    expect(screen.queryByText(/Price history across stores/i)).toBeNull();
  });
});
