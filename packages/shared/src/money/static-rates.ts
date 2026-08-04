import { type Currency } from '../schemas/common';
import { type ExchangeRateSnapshot } from './money';

/**
 * Static demo exchange rates.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ILLUSTRATIVE DEMO DATA. NOT MARKET RATES.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These are round, plausible figures chosen so the European demo catalogue can be
 * compared offline and deterministically. They are not quotes, they are not
 * tracking anything, and they must never be presented as market data. Every
 * converted price in the UI is labelled an estimate and carries the timestamp of
 * the rate it used, which is what keeps that honest.
 *
 * Why these live in `packages/shared` rather than in the seed: the API's rate
 * table falls back to them when the `exchange_rates` table is empty, so a fresh
 * clone that has not been seeded still produces sane, honestly-labelled totals
 * instead of refusing to convert anything. One source, two consumers.
 *
 * Only `X → EUR` is defined. The other direction and every cross-pair are derived
 * by `createRateTable`, which inverts and triangulates through EUR and labels the
 * result with how it was obtained. Defining 42 directed pairs by hand would be
 * 42 opportunities for one of them to disagree with the rest.
 */

export const STATIC_RATE_SOURCE = 'demo-static';

/** Units of EUR per one unit of the quoted currency. Illustrative. */
export const STATIC_RATES_TO_EUR: Readonly<Partial<Record<Currency, string>>> = {
  SEK: '0.08700000',
  DKK: '0.13400000',
  NOK: '0.08600000',
  CHF: '1.06500000',
  GBP: '1.18500000',
  USD: '0.92500000',
};

/**
 * Build snapshots for the static table at a given instant.
 *
 * The timestamp is injected rather than read from the clock so the seed can make
 * it deterministic and so tests can control staleness. There is no default: a
 * rate without a deliberate timestamp is exactly the thing this module exists to
 * prevent.
 */
export function staticRateSnapshots(fetchedAt: Date): ExchangeRateSnapshot[] {
  const timestamp = fetchedAt.toISOString();

  return Object.entries(STATIC_RATES_TO_EUR).map(([quoted, rate]) => ({
    baseCurrency: quoted as Currency,
    quoteCurrency: 'EUR' as Currency,
    rate,
    fetchedAt: timestamp,
  }));
}
