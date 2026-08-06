import {
  countryName,
  formatMoney,
  localeForCountry,
  type CountryCode,
  type Currency,
  type DeliveredHistoryPoint,
} from '@deal-finder/shared';
import { Badge, ToggleChip } from '@deal-finder/ui';
import { AlertTriangle } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { assignStoreColours, MAX_PLOTTED_SERIES } from '../../lib/chart-palette';
import { AXIS_TICK, GRID_STROKE, ANNOTATION_STROKE, niceScale } from './chart-scale';

/**
 * What each store has charged *to deliver this product to one country*.
 *
 * A different series from `CrossStorePriceChart`, not a variant of it. That chart
 * plots `PriceHistory` — shelf prices, no destination, no delivery, no currency
 * question. This one plots `StoreOfferPriceHistory`: the delivered total, per
 * destination, in whatever currency the store quoted at the time. Feeding one
 * into the other's axis would compare a sticker price with a doorstep price and
 * call the difference a price change.
 *
 * Three rules exist because the alternative is invented data:
 *
 *  1. **A recorded observation with no delivered total is a gap, not a carried-over
 *     value.** It means the store had not published a delivery cost that day. A
 *     line drawn through it would assert a total nobody quoted.
 *  2. **A historical point is converted with the rate recorded *on that date*,
 *     never with today's.** Re-converting the series at the current rate makes a
 *     currency movement indistinguishable from a price cut. Where no rate was
 *     recorded, the point is a gap and the reason is stated.
 *  3. **Nothing is drawn where no offer reaches the destination.** The product's
 *     own list-price history is not a substitute and is not silently shown.
 */

export interface DeliveredStoreSeries {
  storeSlug: string;
  storeName: string;
  /** Whether any offer from this store reaches the destination at all. */
  hasDestinationOffer: boolean;
  /** The currency the store quoted in. Null when there is no offer. */
  currency: Currency | null;
  isDemoStore?: boolean;
  points: readonly DeliveredHistoryPoint[];
}

export interface DestinationPriceChartProps {
  series: readonly DeliveredStoreSeries[];
  country: CountryCode;
  /** The currency the reader asked to be quoted in. */
  displayCurrency: Currency;
  visibleStoreSlugs: readonly string[];
  onVisibleStoresChange: (slugs: string[]) => void;
}

/** How one recorded observation becomes one plotted value, or a stated gap. */
export type PointResolution =
  | { value: number; converted: false }
  | { value: number; converted: true; rate: number; rateAt: string | null }
  | { value: null; reason: 'unknown-total' | 'no-rate' };

/**
 * Resolve one history point into the display currency.
 *
 * Exported because this is the whole honesty argument of the chart in one
 * function, and it is worth testing directly rather than through a canvas.
 */
export function resolveDeliveredPoint(
  point: DeliveredHistoryPoint,
  seriesCurrency: Currency | null,
  displayCurrency: Currency,
): PointResolution {
  const total = point.totalDeliveredPrice;
  // The store published no delivery cost on this date. Not zero, not free, and
  // not the previous day's total carried forward.
  if (total == null) return { value: null, reason: 'unknown-total' };

  const from = total.currency ?? seriesCurrency;
  if (from === displayCurrency) return { value: total.major, converted: false };

  // The rate that was actually in force when this observation was compared. Using
  // today's rate instead would redraw history every time the euro moved.
  if (point.exchangeRate == null) return { value: null, reason: 'no-rate' };

  return {
    value: Math.round(total.major * point.exchangeRate * 100) / 100,
    converted: true,
    rate: point.exchangeRate,
    rateAt: point.exchangeRateTimestamp,
  };
}

interface ChartRow {
  time: number;
  [storeSlug: string]: number | null;
}

/**
 * Merge the series onto one time axis.
 *
 * A store's last known total is carried forward, because history records changes
 * rather than polls — but only until the next *recorded* observation says the
 * total is unknown, at which point the carried value stops. That distinction is
 * the difference between "the price did not move" and "we no longer know what
 * delivery costs".
 */
export function buildDeliveredRows(
  series: readonly DeliveredStoreSeries[],
  visible: ReadonlySet<string>,
  displayCurrency: Currency,
): ChartRow[] {
  const plotted = series.filter((entry) => visible.has(entry.storeSlug));

  const times = new Set<number>();
  for (const entry of plotted) {
    for (const point of entry.points) times.add(Date.parse(point.recordedAt));
  }
  const ordered = [...times].filter(Number.isFinite).sort((a, b) => a - b);
  if (ordered.length === 0) return [];

  const cursors = plotted.map((entry) => ({
    slug: entry.storeSlug,
    points: entry.points
      .map((point) => ({
        time: Date.parse(point.recordedAt),
        resolution: resolveDeliveredPoint(point, entry.currency, displayCurrency),
      }))
      .filter((point) => Number.isFinite(point.time))
      .sort((a, b) => a.time - b.time),
    index: 0,
    current: null as number | null,
  }));

  return ordered.map((time) => {
    const row: ChartRow = { time };
    for (const cursor of cursors) {
      while (cursor.index < cursor.points.length) {
        const point = cursor.points[cursor.index];
        if (!point || point.time > time) break;
        // An observation always replaces the carried value, including with null.
        cursor.current = point.resolution.value;
        cursor.index += 1;
      }
      row[cursor.slug] = cursor.current;
    }
    return row;
  });
}

export function DestinationPriceChart({
  series,
  country,
  displayCurrency,
  visibleStoreSlugs,
  onVisibleStoresChange,
}: DestinationPriceChartProps) {
  const [showTable, setShowTable] = useState(false);

  const locale = localeForCountry(country);
  const destination = countryName(country);

  // Derived from every store, sorted — never from the visible subset, so toggling
  // a store off cannot repaint the ones that remain.
  const allSlugs = useMemo(() => series.map((entry) => entry.storeSlug), [series]);
  const colours = useMemo(() => assignStoreColours(allSlugs), [allSlugs]);
  const visible = useMemo(() => new Set(visibleStoreSlugs), [visibleStoreSlugs]);

  const deliverable = series.filter((entry) => entry.hasDestinationOffer);
  const plotted = deliverable.filter((entry) => visible.has(entry.storeSlug));
  const rows = useMemo(
    () => buildDeliveredRows(deliverable, visible, displayCurrency),
    [deliverable, visible, displayCurrency],
  );

  const notDeliverable = series.filter((entry) => !entry.hasDestinationOffer);
  const convertedStores = deliverable.filter(
    (entry) => entry.currency != null && entry.currency !== displayCurrency,
  );
  const rateGaps = deliverable.filter((entry) =>
    entry.points.some(
      (point) => resolveDeliveredPoint(point, entry.currency, displayCurrency).value == null,
    ),
  );

  const toggle = (slug: string) => {
    const next = visible.has(slug)
      ? visibleStoreSlugs.filter((entry) => entry !== slug)
      : [...visibleStoreSlugs, slug];
    // Never leave the chart empty; the last visible store cannot be turned off.
    if (next.length === 0) return;
    onVisibleStoresChange(next);
  };

  const values = rows
    .flatMap((row) => plotted.map((entry) => row[entry.storeSlug]))
    .filter((value): value is number => typeof value === 'number');

  const { domain, ticks } =
    values.length > 0
      ? niceScale(Math.min(...values), Math.max(...values))
      : { domain: [0, 100] as [number, number], ticks: [0, 50, 100] };

  const latestFor = (entry: DeliveredStoreSeries): string => {
    for (let index = entry.points.length - 1; index >= 0; index -= 1) {
      const point = entry.points[index];
      if (!point) continue;
      const resolved = resolveDeliveredPoint(point, entry.currency, displayCurrency);
      if (resolved.value != null) return formatMoney(resolved.value, displayCurrency, locale);
    }
    return 'Unknown';
  };

  return (
    <div className="flex flex-col gap-3" data-testid="destination-price-chart">
      {/*
        The destination and the currency are in the heading, not in a caption
        below it: every number in this chart is specific to both, and a delivered
        total with neither attached is not a figure anyone can act on.
      */}
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold" data-testid="destination-chart-heading">
          Delivered price history to {destination}, in {displayCurrency}
        </h3>
        <p className="text-xs text-ink-500">
          Product price plus delivery, as each store quoted it on the date shown. Recorded from the
          first destination-aware check onwards — earlier list-price history is a different series
          and is not shown here.
        </p>
      </div>

      {deliverable.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {deliverable.map((entry) => (
            <ToggleChip
              key={entry.storeSlug}
              pressed={visible.has(entry.storeSlug)}
              onPressedChange={() => toggle(entry.storeSlug)}
              trailingText={latestFor(entry)}
              leadingIcon={
                <span
                  className="block size-3 rounded-full"
                  style={{ backgroundColor: colours.get(entry.storeSlug) }}
                />
              }
            >
              {entry.storeName}
            </ToggleChip>
          ))}
        </div>
      )}

      {deliverable.length > MAX_PLOTTED_SERIES && (
        <p className="text-xs text-ink-500">
          {deliverable.length - MAX_PLOTTED_SERIES} further{' '}
          {deliverable.length - MAX_PLOTTED_SERIES === 1 ? 'store shares' : 'stores share'} the
          overflow colour; use the table below to read their values exactly.
        </p>
      )}

      {deliverable.length === 0 ? (
        <div
          className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line-strong px-4 text-center text-sm text-ink-500"
          data-testid="destination-chart-empty"
        >
          No store has an offer that reaches {destination}, so there is no delivered-price history
          to show.
        </div>
      ) : rows.length < 2 ? (
        <div
          className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line-strong px-4 text-center text-sm text-ink-500"
          data-testid="destination-chart-insufficient"
        >
          Not enough delivered-price history recorded for {destination} yet to draw a chart.
        </div>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 16, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={GRID_STROKE} strokeWidth={1} vertical={false} />

              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(value: number) =>
                  new Date(value).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
                }
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={{ stroke: GRID_STROKE }}
                minTickGap={44}
              />

              <YAxis
                domain={domain}
                ticks={ticks}
                tickFormatter={(value: number) => formatMoney(value, displayCurrency, locale)}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={78}
              />

              <Tooltip
                content={({ active, payload, label }) => (
                  <DeliveredTooltip
                    active={Boolean(active)}
                    payload={payload as readonly TooltipEntry[] | undefined}
                    time={typeof label === 'number' ? label : null}
                    currency={displayCurrency}
                    locale={locale}
                    names={new Map(series.map((entry) => [entry.storeSlug, entry.storeName]))}
                  />
                )}
                cursor={{ stroke: ANNOTATION_STROKE, strokeWidth: 1, strokeDasharray: '3 3' }}
              />

              {plotted.map((entry) => (
                <Line
                  key={entry.storeSlug}
                  type="monotone"
                  dataKey={entry.storeSlug}
                  name={entry.storeName}
                  stroke={colours.get(entry.storeSlug)}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }}
                  isAnimationActive={false}
                  // A date with no published delivery cost stays a hole.
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── What the numbers do and do not claim ──────────────────────────── */}
      {convertedStores.length > 0 && (
        <p
          className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500"
          data-testid="destination-chart-converted"
        >
          <Badge tone="muted">Converted</Badge>
          <span>
            {convertedStores.map((entry) => entry.storeName).join(', ')}{' '}
            {convertedStores.length === 1 ? 'quotes' : 'quote'} in{' '}
            {[...new Set(convertedStores.map((entry) => entry.currency))].join(', ')}. Each point is
            converted at the rate recorded on its own date, so these values are estimates — not
            what the store charged in {displayCurrency}.
          </span>
        </p>
      )}

      {rateGaps.length > 0 && (
        <p
          className="flex items-start gap-1.5 text-xs font-medium text-warn-800"
          data-testid="destination-chart-gaps"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Some dates are left blank on purpose: the store had published no delivery cost, or no
            exchange rate was recorded for that day. Nothing is filled in for them.
          </span>
        </p>
      )}

      {notDeliverable.length > 0 && (
        <p className="text-xs text-ink-500" data-testid="destination-chart-excluded">
          {notDeliverable.map((entry) => entry.storeName).join(', ')}{' '}
          {notDeliverable.length === 1 ? 'does' : 'do'} not deliver to {destination}, so{' '}
          {notDeliverable.length === 1 ? 'it has' : 'they have'} no series here.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-500">
          {plotted.length} of {deliverable.length}{' '}
          {deliverable.length === 1 ? 'store' : 'stores'} shown
        </p>
        <button
          type="button"
          onClick={() => setShowTable((open) => !open)}
          className="text-xs font-semibold text-accent-700 hover:text-accent-800"
          aria-expanded={showTable}
          aria-controls="destination-price-table"
        >
          {showTable ? 'Hide values' : 'Show values as a table'}
        </button>
      </div>

      {/*
        The same data without a canvas, a mouse or a colour. Driven by `plotted`,
        so filtering a store updates the chart and the table together — a table
        that disagreed with the plot above it would be worse than no table.
      */}
      {showTable && (
        <div
          id="destination-price-table"
          className="max-h-64 overflow-auto rounded-lg border border-line"
        >
          <table className="w-full text-sm">
            <caption className="sr-only">
              Delivered totals to {destination} by store, in {displayCurrency}, oldest first. A dash
              means no delivered total was known on that date.
            </caption>
            <thead className="sticky top-0 bg-surface-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-ink-700">
                  Date
                </th>
                {plotted.map((entry) => (
                  <th
                    key={entry.storeSlug}
                    scope="col"
                    className="px-3 py-2 text-right text-xs font-semibold text-ink-700"
                  >
                    {entry.storeName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.time} className="border-t border-line">
                  <td className="px-3 py-1.5 text-xs text-ink-700">
                    {new Date(row.time).toLocaleDateString(locale, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  {plotted.map((entry) => {
                    const value = row[entry.storeSlug];
                    return (
                      <td
                        key={entry.storeSlug}
                        className="px-3 py-1.5 text-right text-xs tabular text-ink-900"
                      >
                        {typeof value === 'number'
                          ? formatMoney(value, displayCurrency, locale)
                          : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | null;
  color?: string;
}

/** Every visible store's delivered total at the hovered date, cheapest first. */
function DeliveredTooltip({
  active,
  payload,
  time,
  currency,
  locale,
  names,
}: {
  active: boolean;
  payload: readonly TooltipEntry[] | undefined;
  time: number | null;
  currency: Currency;
  locale: string;
  names: ReadonlyMap<string, string>;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const rows = payload
    .filter((entry) => typeof entry.value === 'number')
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-raised">
      {time != null && (
        <p className="mb-1 text-xs text-ink-500">
          {new Date(time).toLocaleDateString(locale, {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </p>
      )}
      <ul className="flex flex-col gap-0.5">
        {rows.map((entry) => (
          <li key={String(entry.dataKey)} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className="h-0.5 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="font-bold tabular text-ink-900">
              {formatMoney(entry.value ?? 0, currency, locale)}
            </span>
            <span className="text-ink-500">
              {names.get(String(entry.dataKey)) ?? entry.dataKey} delivered
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
