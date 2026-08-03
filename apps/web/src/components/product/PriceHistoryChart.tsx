import {
  formatMoney,
  type Currency,
  type PricePoint,
  type PriceStatistics,
} from '@deal-finder/shared';
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AXIS_TICK, niceScale } from './chart-scale';

/**
 * Price-history chart.
 *
 * Design decisions, in the order they were made:
 *
 *  - **Form:** one measure over time, one series → a line. A light area wash
 *    sits under it for shape; there is no legend, because with a single series
 *    a one-swatch legend just restates the heading.
 *  - **Colour:** one hue. `--color-chart-line` is a *different step* of the
 *    accent ramp than buttons use: the interface accent is tuned for text
 *    contrast and fails a chroma floor as a plotted line (it reads grey).
 *  - **Reference lines stay neutral.** The lowest and average markers are
 *    annotations, not extra series, so they are grey and dashed with direct
 *    labels rather than spending two more colours. Dashed also keeps them
 *    unmistakable against the solid hairline gridlines.
 *  - **The hover layer ships by default:** a crosshair that snaps to the
 *    nearest observation, with the value leading and the date secondary.
 *  - **Nothing is gated behind hover.** A "Show values" table exposes every
 *    observation for keyboard and screen-reader users.
 */

export interface PriceHistoryChartProps {
  points: readonly PricePoint[];
  statistics: PriceStatistics;
  currency: Currency;
  /** Target price, drawn as an extra reference line when set. */
  targetPrice?: number | null;
}

interface ChartDatum {
  time: number;
  price: number;
  label: string;
}

export function PriceHistoryChart({
  points,
  statistics,
  currency,
  targetPrice,
}: PriceHistoryChartProps) {
  const [showTable, setShowTable] = useState(false);

  const data = useMemo<ChartDatum[]>(
    () =>
      points.map((point) => {
        const date = new Date(point.recordedAt);
        return {
          time: date.getTime(),
          price: point.price,
          label: date.toLocaleDateString('fi-FI', { day: 'numeric', month: 'short' }),
        };
      }),
    [points],
  );

  if (data.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-line-strong text-sm text-ink-500">
        Not enough price history recorded yet to draw a chart.
      </div>
    );
  }

  // Pad the domain around the observed range. A price line is conventionally
  // read against its own range, not against zero — anchoring a €1,200 TV to
  // zero would flatten every movement into a straight line. The axis is fully
  // labelled so the scale is never implied.
  // The target price participates in the scale. Deriving the domain from the
  // observed prices alone silently clips the target line whenever the user asks
  // for a price below anything yet recorded — which is precisely the case where
  // seeing the gap matters most.
  const prices = data.map((entry) => entry.price);
  const scaleValues = targetPrice != null ? [...prices, targetPrice] : prices;
  const { domain, ticks } = niceScale(Math.min(...scaleValues), Math.max(...scaleValues));

  const latest = data[data.length - 1];

  return (
    <div className="flex flex-col gap-3">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 16, right: 68, bottom: 4, left: 4 }}>
            <defs>
              <linearGradient id="priceWash" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-chart-line)" stopOpacity={0.16} />
                <stop offset="100%" stopColor="var(--color-chart-line)" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            {/* Recessive, hairline, solid, horizontal only. */}
            <CartesianGrid stroke="#e4e7ec" strokeWidth={1} vertical={false} />

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
              axisLine={{ stroke: '#e4e7ec' }}
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

            {/* Annotations: neutral, dashed, directly labelled. */}
            {statistics.average != null && (
              <ReferenceLine
                y={statistics.average}
                stroke="#98a2b3"
                strokeDasharray="5 4"
                strokeWidth={1}
                label={{
                  value: `Avg ${formatMoney(statistics.average, currency)}`,
                  position: 'right',
                  fill: '#667085',
                  fontSize: 11,
                }}
              />
            )}
            {statistics.lowest != null && (
              <ReferenceLine
                y={statistics.lowest}
                stroke="#667085"
                strokeDasharray="2 3"
                strokeWidth={1}
                label={{
                  value: `Low ${formatMoney(statistics.lowest, currency)}`,
                  position: 'right',
                  fill: '#667085',
                  fontSize: 11,
                }}
              />
            )}
            {targetPrice != null && (
              <ReferenceLine
                y={targetPrice}
                stroke="#0f766e"
                strokeDasharray="6 3"
                strokeWidth={1.5}
                label={{
                  value: `Target ${formatMoney(targetPrice, currency)}`,
                  position: 'right',
                  fill: '#0f766e',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              />
            )}

            <Tooltip
              // A render function rather than an element, so this does not
              // depend on Recharts' internal injected-prop type.
              content={({ active, payload }) => (
                <PriceTooltip
                  active={Boolean(active)}
                  payload={payload as readonly TooltipEntry[] | undefined}
                  currency={currency}
                />
              )}
              // The crosshair: readers aim at a date, not at a 2px line.
              cursor={{ stroke: '#98a2b3', strokeWidth: 1, strokeDasharray: '3 3' }}
            />

            <Area
              type="monotone"
              dataKey="price"
              stroke="var(--color-chart-line)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="url(#priceWash)"
              // No dot per point: 90 dots is noise. The active dot carries a
              // 2px surface ring so it stays legible over the line.
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff', fill: 'var(--color-chart-line)' }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-500">
          {data.length} recorded observations · latest{' '}
          <span className="font-semibold tabular text-ink-700">
            {formatMoney(latest?.price ?? 0, currency)}
          </span>
        </p>
        <button
          type="button"
          onClick={() => setShowTable((open) => !open)}
          className="text-xs font-semibold text-accent-700 hover:text-accent-800"
          aria-expanded={showTable}
          aria-controls="price-history-table"
        >
          {showTable ? 'Hide values' : 'Show values as a table'}
        </button>
      </div>

      {/* Every value reachable without hovering. */}
      {showTable && (
        <div id="price-history-table" className="max-h-64 overflow-y-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">Recorded price history, oldest first</caption>
            <thead className="sticky top-0 bg-surface-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-ink-700">
                  Date
                </th>
                <th scope="col" className="px-3 py-2 text-right text-xs font-semibold text-ink-700">
                  Price
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((entry) => (
                <tr key={entry.time} className="border-t border-line">
                  <td className="px-3 py-1.5 text-xs text-ink-700">
                    {new Date(entry.time).toLocaleDateString('fi-FI', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs tabular text-ink-900">
                    {formatMoney(entry.price, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The only part of Recharts' tooltip payload this component actually reads. */
interface TooltipEntry {
  payload?: ChartDatum;
}

/**
 * Tooltip: value leads, date follows — the reader already knows which series
 * this is, they want the number.
 */
function PriceTooltip({
  active,
  payload,
  currency,
}: {
  active: boolean;
  payload: readonly TooltipEntry[] | undefined;
  currency: Currency;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const datum = payload[0]?.payload;
  if (!datum) return null;

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-raised">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-0.5 w-3 rounded-full"
          style={{ backgroundColor: 'var(--color-chart-line)' }}
        />
        <span className="text-sm font-bold tabular text-ink-900">
          {formatMoney(datum.price, currency)}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-ink-500">
        {new Date(datum.time).toLocaleDateString('fi-FI', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      </p>
    </div>
  );
}
