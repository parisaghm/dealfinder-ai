import { describe, expect, it } from 'vitest';
import {
  assessStaleness,
  convertWithProvenance,
  createRateTable,
  rateAgeHours,
} from './exchange-rate';
import { toDecimalString, type ExchangeRateSnapshot, type Money } from './money';

const NOW = Date.parse('2026-08-02T12:00:00.000Z');
const HOUR = 3_600_000;

function snapshot(
  baseCurrency: ExchangeRateSnapshot['baseCurrency'],
  quoteCurrency: ExchangeRateSnapshot['quoteCurrency'],
  rate: string,
  hoursAgo = 1,
): ExchangeRateSnapshot {
  return {
    baseCurrency,
    quoteCurrency,
    rate,
    fetchedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
  };
}

const sek = (minorUnits: number): Money => ({ minorUnits, currency: 'SEK' });
const eur = (minorUnits: number): Money => ({ minorUnits, currency: 'EUR' });

const FRESH_TABLE = createRateTable([
  snapshot('SEK', 'EUR', '0.08700000'),
  snapshot('DKK', 'EUR', '0.13400000'),
]);

describe('createRateTable resolution', () => {
  it('resolves a directly recorded pair', () => {
    const resolved = FRESH_TABLE.resolve('SEK', 'EUR');
    expect(resolved?.derivation).toBe('direct');
    expect(resolved?.snapshot.rate).toBe('0.08700000');
  });

  it('inverts the opposite pair when only one direction is recorded', () => {
    const resolved = FRESH_TABLE.resolve('EUR', 'SEK');
    expect(resolved?.derivation).toBe('inverted');
    // 1 / 0.087 = 11.49425287…
    expect(resolved?.snapshot.rate).toBe('11.49425287');
  });

  it('triangulates through EUR for a pair sharing no direct rate', () => {
    const resolved = FRESH_TABLE.resolve('SEK', 'DKK');
    expect(resolved?.derivation).toBe('triangulated');
    // 0.087 SEK->EUR then 1/0.134 EUR->DKK; 0.087 / 0.134 = 0.649253731…
    expect(resolved?.snapshot.rate).toBe('0.64925373');
  });

  it('reports null for a currency it has never seen', () => {
    expect(FRESH_TABLE.resolve('GBP', 'EUR')).toBeNull();
    expect(FRESH_TABLE.resolve('SEK', 'GBP')).toBeNull();
  });

  it('never resolves a same-currency pair, which needs no rate', () => {
    expect(FRESH_TABLE.resolve('EUR', 'EUR')).toBeNull();
  });

  it('keeps the freshest observation when a pair is recorded twice', () => {
    const table = createRateTable([
      snapshot('SEK', 'EUR', '0.08000000', 48),
      snapshot('SEK', 'EUR', '0.08700000', 1),
    ]);
    expect(table.resolve('SEK', 'EUR')?.snapshot.rate).toBe('0.08700000');
  });

  it('carries the older timestamp through a triangulation', () => {
    // Staleness must be governed by the stalest leg, or a fresh-looking derived
    // rate could be built out of a week-old one.
    const table = createRateTable([
      snapshot('SEK', 'EUR', '0.08700000', 1),
      snapshot('DKK', 'EUR', '0.13400000', 100),
    ]);
    const resolved = table.resolve('SEK', 'DKK');
    expect(rateAgeHours(resolved!.snapshot, NOW)).toBeCloseTo(100, 5);
  });
});

describe('staleness', () => {
  it('measures age in hours', () => {
    expect(rateAgeHours(snapshot('SEK', 'EUR', '0.087', 6), NOW)).toBeCloseTo(6, 5);
  });

  it('clamps clock skew to zero rather than reporting a negative age', () => {
    expect(rateAgeHours(snapshot('SEK', 'EUR', '0.087', -5), NOW)).toBe(0);
  });

  it('treats an unparseable timestamp as infinitely old', () => {
    const broken = { ...snapshot('SEK', 'EUR', '0.087'), fetchedAt: 'not-a-date' };
    expect(rateAgeHours(broken, NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it('is stale only past the threshold, not at it', () => {
    expect(assessStaleness(snapshot('SEK', 'EUR', '0.087', 48), 48, NOW).isStale).toBe(false);
    expect(assessStaleness(snapshot('SEK', 'EUR', '0.087', 49), 48, NOW).isStale).toBe(true);
  });
});

describe('convertWithProvenance', () => {
  const options = { maxAgeHours: 48, now: NOW };

  it('short-circuits a same-currency amount without consulting any rate', () => {
    const empty = createRateTable([]);
    const outcome = convertWithProvenance(eur(29900), 'EUR', empty, options);

    expect(outcome.status).toBe('same-currency');
    expect(outcome.converted).toEqual(eur(29900));
    expect(outcome.snapshot).toBeNull();
    // A domestic offer is never penalised for the state of the FX table.
    expect(outcome.isEstimate).toBe(false);
    expect(outcome.blocksCheapestClaim).toBe(false);
  });

  it('converts at a fresh rate, labels it an estimate, and allows it to win', () => {
    const outcome = convertWithProvenance(sek(319000), 'EUR', FRESH_TABLE, options);

    expect(outcome.status).toBe('converted');
    expect(toDecimalString(outcome.converted!)).toBe('277.53');
    expect(outcome.isEstimate).toBe(true);
    expect(outcome.blocksCheapestClaim).toBe(false);
    expect(outcome.ageHours).toBeCloseTo(1, 5);
  });

  it('still converts at a stale rate but bars it from winning', () => {
    const stale = createRateTable([snapshot('SEK', 'EUR', '0.08700000', 120)]);
    const outcome = convertWithProvenance(sek(319000), 'EUR', stale, options);

    expect(outcome.status).toBe('converted-stale');
    // Shown, not hidden: concealing it would hide a genuinely relevant offer.
    expect(toDecimalString(outcome.converted!)).toBe('277.53');
    expect(outcome.ageHours).toBeCloseTo(120, 5);
    expect(outcome.blocksCheapestClaim).toBe(true);
  });

  it('produces no number at all when the rate is missing', () => {
    const outcome = convertWithProvenance(sek(319000), 'EUR', createRateTable([]), options);

    expect(outcome.status).toBe('rate-missing');
    expect(outcome.converted).toBeNull();
    expect(outcome.blocksCheapestClaim).toBe(true);
  });

  it('produces no number when the recorded rate is unusable', () => {
    const broken = createRateTable([snapshot('SEK', 'EUR', 'not-a-rate')]);
    const outcome = convertWithProvenance(sek(319000), 'EUR', broken, options);

    expect(outcome.converted).toBeNull();
    expect(outcome.blocksCheapestClaim).toBe(true);
  });

  it('reports the derivation so a triangulated rate can be presented as one', () => {
    const outcome = convertWithProvenance(sek(100000), 'DKK', FRESH_TABLE, options);
    expect(outcome.derivation).toBe('triangulated');
    expect(outcome.converted?.currency).toBe('DKK');
  });
});
