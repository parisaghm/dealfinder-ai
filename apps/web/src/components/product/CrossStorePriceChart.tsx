import { formatMoney, type Currency, type PricePoint } from '@deal-finder/shared';
import { ToggleChip } from '@deal-finder/ui';
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { assignStoreColours, MAX_PLOTTED_SERIES } from '../../lib/chart-palette';
import { ANNOTATION_STROKE, AXIS_TICK, GRID_STROKE, niceScale } from './chart-scale';

/**
 * One product's price at every store that sells it.
 *
 * Follows `PriceHistoryChart` in everything that is not forced to change by
 * having more than one series — same `niceScale` ticks, same hairline
 * horizontal-only grid, same tick styling, same neutral dashed annotation, same
 * "show values as a table" fallback. Four deliberate departures:
 *
 *  - **Lines, not areas.** One series earns an area wash for shape; six
 *    overlapping washes are mud.
 *  - **A legend, and it *is* the filter.** Two controls doing one job, in the
 *    place filters belong: a single row above the plot. Each chip carries the
 *    store name and `aria-pressed`, so identity and state are never conveyed by
 *    colour alone.
 *  - **Direct end labels** for four or fewer visible series. These are also the
 *    mandatory relief for the two palette slots that fall below 3:1 contrast.
 *  - **`connectNulls={false}`.** A store that did not carry the product for
 *    three weeks has a gap. Drawing through it would invent prices, which is
 *    the one thing this product must never do.
 */

export interface StoreSeries {
  storeSlug: string;
  storeName: string;
  points: readonly PricePoint[];
}

export interface CrossStorePriceChartProps {
  series: readonly StoreSeries[];
  currency: Currency;
  visibleStoreSlugs: readonly string[];
  onVisibleStoresChange: (slugs: string[]) => void;
  /** The lowest price ever recorded anywhere, drawn as a neutral annotation. */
  crossStoreLow: number | null;
}

interface ChartRow {
  time: number;
  [storeSlug: string]: number | null;
}

/**
 * Merge per-store series onto one time axis, forward-filling each store's last
 * known price.
 *
 * History records *changes*, not polls, so a store with no row for a given day
 * has not vanished — its price simply has not moved. Leaving a hole would draw
 * a line that dives to nothing and back. A store is only filled forward from
 * its own first observation; before that the value stays null, because we
 * genuinely did not know it.
 */
function buildRows(series: readonly StoreSeries[], visible: ReadonlySet<string>): ChartRow[] {
  const times = new Set<number>();
  for (const entry of series) {
    if (!visible.has(entry.storeSlug)) continue;
    for (const point of entry.points) times.add(Date.parse(point.recordedAt));
  }

  const ordered = [...times].filter(Number.isFinite).sort((a, b) => a - b);
  if (ordered.length === 0) return [];

  const cursors = series
    .filter((entry) => visible.has(entry.storeSlug))
    .map((entry) => ({
      slug: entry.storeSlug,
      points: [...entry.points]
        .map((point) => ({ price: point.price, time: Date.parse(point.recordedAt) }))
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
        cursor.current = point.price;
        cursor.index += 1;
      }
      row[cursor.slug] = cursor.current;
    }
    return row;
  });
}

export function CrossStorePriceChart({
  series,
  currency,
  visibleStoreSlugs,
  onVisibleStoresChange,
  crossStoreLow,
}: CrossStorePriceChartProps) {
  const [showTable, setShowTable] = useState(false);

  const allSlugs = useMemo(() => series.map((entry) => entry.storeSlug), [series]);
  const colours = useMemo(() => assignStoreColours(allSlugs), [allSlugs]);
  const visible = useMemo(() => new Set(visibleStoreSlugs), [visibleStoreSlugs]);

  const plotted = series.filter((entry) => visible.has(entry.storeSlug));
  const rows = useMemo(() => buildRows(series, visible), [series, visible]);

  const toggle = (slug: string) => {
    const next = visible.has(slug)
      ? visibleStoreSlugs.filter((entry) => entry !== slug)
      : [...visibleStoreSlugs, slug];
    // Never leave the chart empty: the last visible store cannot be turned off.
    if (next.length === 0) return;
    onVisibleStoresChange(next);
  };

  const values = rows
    .flatMap((row) => plotted.map((entry) => row[entry.storeSlug]))
    .filter((value): value is number => typeof value === 'number');
  const scaleValues = crossStoreLow != null ? [...values, crossStoreLow] : values;

  const { domain, ticks } =
    scaleValues.length > 0
      ? niceScale(Math.min(...scaleValues), Math.max(...scaleValues))
      : { domain: [0, 100] as [number, number], ticks: [0, 50, 100] };

  // Direct labels only while they can be read without colliding.
  const showDirectLabels = plotted.length > 0 && plotted.length <= 4;

  const latestPriceFor = (slug: string): string => {
    const entry = series.find((candidate) => candidate.storeSlug === slug);
    const last = entry?.points[entry.points.length - 1];
    return last ? formatMoney(last.price, currency) : '—';
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Legend and filter in one control, in one row above the plot. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {series.map((entry) => (
          <ToggleChip
            key={entry.storeSlug}
            pressed={visible.has(entry.storeSlug)}
            onPressedChange={() => toggle(entry.storeSlug)}
            trailingText={latestPriceFor(entry.storeSlug)}
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

      {series.length > MAX_PLOTTED_SERIES && (
        <p className="text-xs text-ink-500">
          {series.length - MAX_PLOTTED_SERIES} further{' '}
          {series.length - MAX_PLOTTED_SERIES === 1 ? 'store is' : 'stores are'} listed in the
          comparison table above but not plotted here.
        </p>
      )}

      {rows.length < 2 ? (
        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line-strong text-sm text-ink-500">
          Not enough price history recorded yet to draw a chart.
        </div>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 16, right: showDirectLabels ? 96 : 16, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={GRID_STROKE} strokeWidth={1} vertical={false} />

              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(value: number) =>
                  new Date(value).toLocaleDateString('fi-FI', { day: 'numeric', month: 'short' })
                }
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={{ stroke: GRID_STROKE }}
                minTickGap={44}
              />

              <YAxis
                domain={domain}
                ticks={ticks}
                tickFormatter={(value: number) => formatMoney(value, currency)}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={78}
              />

              {/* An annotation, not a seventh series: grey and dashed. */}
              {crossStoreLow != null && (
                <ReferenceLine
                  y={crossStoreLow}
                  stroke={ANNOTATION_STROKE}
                  strokeDasharray="2 3"
                  strokeWidth={1}
                  label={{
                    value: `Cross-store low ${formatMoney(crossStoreLow, currency)}`,
                    position: 'insideBottomRight',
                    fill: '#667085',
                    fontSize: 11,
                  }}
                />
              )}

              <Tooltip
                content={({ active, payload, label }) => (
                  <CrossStoreTooltip
                    active={Boolean(active)}
                    payload={payload as readonly TooltipEntry[] | undefined}
                    time={typeof label === 'number' ? label : null}
                    currency={currency}
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
                  connectNulls={false}
                  label={
                    showDirectLabels
                      ? {
                          position: 'right',
                          fontSize: 11,
                          fill: '#667085',
                          content: (props: unknown) => renderEndLabel(props, entry.storeName, rows.length),
                        }
                      : undefined
                  }
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-500">
          {plotted.length} of {series.length} {series.length === 1 ? 'store' : 'stores'} shown
        </p>
        <button
          type="button"
          onClick={() => setShowTable((open) => !open)}
          className="text-xs font-semibold text-accent-700 hover:text-accent-800"
          aria-expanded={showTable}
          aria-controls="cross-store-price-table"
        >
          {showTable ? 'Hide values' : 'Show values as a table'}
        </button>
      </div>

      {/* Every value reachable without a mouse, and without colour. */}
      {showTable && (
        <div
          id="cross-store-price-table"
          className="max-h-64 overflow-auto rounded-lg border border-line"
        >
          <table className="w-full text-sm">
            <caption className="sr-only">Recorded prices by store, oldest first</caption>
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
                    {new Date(row.time).toLocaleDateString('fi-FI', {
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
                        {typeof value === 'number' ? formatMoney(value, currency) : '—'}
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

/**
 * Draw the store name at the end of its line.
 *
 * Recharts calls the label renderer once per point; only the last one should
 * produce anything.
 */
function renderEndLabel(props: unknown, storeName: string, rowCount: number) {
  const { x, y, index } = props as { x?: number; y?: number; index?: number };
  if (index !== rowCount - 1 || typeof x !== 'number' || typeof y !== 'number') return null;
  return (
    <text x={x + 6} y={y} dy={4} fill="#667085" fontSize={11}>
      {storeName}
    </text>
  );
}

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | null;
  color?: string;
}

/** Every visible store at the hovered date, cheapest first. */
function CrossStoreTooltip({
  active,
  payload,
  time,
  currency,
  names,
}: {
  active: boolean;
  payload: readonly TooltipEntry[] | undefined;
  time: number | null;
  currency: Currency;
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
          {new Date(time).toLocaleDateString('fi-FI', {
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
              {formatMoney(entry.value ?? 0, currency)}
            </span>
            <span className="text-ink-500">{names.get(String(entry.dataKey)) ?? entry.dataKey}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
