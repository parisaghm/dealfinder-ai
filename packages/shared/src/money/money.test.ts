import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  addMoney,
  compareMoney,
  convertMoney,
  deliveredTotal,
  fromDecimalString,
  fromMajor,
  parseDecimalToScaled,
  subtractMoney,
  toDecimalString,
  toMajor,
  toMoneyAmount,
  vatOf,
  zeroMoney,
  type ExchangeRateSnapshot,
} from './money';

const eur = (minorUnits: number) => ({ minorUnits, currency: 'EUR' as const });
const sek = (minorUnits: number) => ({ minorUnits, currency: 'SEK' as const });

function rate(
  base: 'SEK' | 'EUR' | 'DKK',
  quote: 'EUR' | 'SEK' | 'DKK',
  value: string,
): ExchangeRateSnapshot {
  return {
    baseCurrency: base,
    quoteCurrency: quote,
    rate: value,
    fetchedAt: '2026-08-02T00:00:00.000Z',
  };
}

describe('parseDecimalToScaled', () => {
  it.each([
    ['12.90', 2, 1290n],
    ['12.9', 2, 1290n],
    ['12', 2, 1200n],
    ['0.01', 2, 1n],
    ['-3.50', 2, -350n],
    ['.5', 2, 50n],
    ['0.08700000', 8, 8700000n],
  ])('parses %s at scale %i', (input, exponent, expected) => {
    expect(parseDecimalToScaled(input, exponent)).toBe(expected);
  });

  it('rounds half-up on digits beyond the target scale rather than truncating', () => {
    expect(parseDecimalToScaled('1.005', 2)).toBe(101n);
    expect(parseDecimalToScaled('1.004', 2)).toBe(100n);
  });

  it.each(['', 'abc', '1.2.3', '1,90', 'NaN', '1e5', ' '])('rejects %s', (input) => {
    expect(parseDecimalToScaled(input, 2)).toBeNull();
  });
});

describe('minor-unit invariants', () => {
  it('holds whole cents as integers, never floats', () => {
    const money = fromDecimalString('12.90', 'EUR');
    expect(money).toEqual(eur(1290));
    expect(Number.isInteger(money?.minorUnits)).toBe(true);
  });

  it('round-trips a decimal string exactly', () => {
    for (const value of ['0.00', '0.01', '12.90', '1299.99', '10000000.00']) {
      const money = fromDecimalString(value, 'EUR');
      expect(money).not.toBeNull();
      expect(toDecimalString(money!)).toBe(value);
    }
  });

  it('survives the classic float trap that motivates this module', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. In minor units it is exact.
    const total = addMoney(fromMajor(0.1, 'EUR')!, fromMajor(0.2, 'EUR')!);
    expect(total.minorUnits).toBe(30);
    expect(toDecimalString(total)).toBe('0.30');
  });

  it('accumulates a hundred nine-cent charges without drift', () => {
    let total = zeroMoney('EUR');
    for (let index = 0; index < 100; index += 1) {
      total = addMoney(total, eur(9));
    }
    expect(toDecimalString(total)).toBe('9.00');
  });

  it('rejects a non-finite major amount instead of producing NaN units', () => {
    expect(fromMajor(Number.NaN, 'EUR')).toBeNull();
    expect(fromMajor(Number.POSITIVE_INFINITY, 'EUR')).toBeNull();
  });

  it('converts to major units only at the display boundary', () => {
    expect(toMajor(eur(1290))).toBe(12.9);
    expect(toMoneyAmount(eur(1290))).toEqual({ minorUnits: 1290, major: 12.9, currency: 'EUR' });
  });
});

describe('addMoney / subtractMoney', () => {
  it('sums same-currency amounts', () => {
    expect(addMoney(eur(29900), eur(1290))).toEqual(eur(31190));
  });

  it('throws rather than silently combining two currencies', () => {
    expect(() => addMoney(eur(29900), sek(319000))).toThrow(CurrencyMismatchError);
    expect(() => subtractMoney(eur(100), sek(100))).toThrow(CurrencyMismatchError);
    expect(() => compareMoney(eur(100), sek(100))).toThrow(CurrencyMismatchError);
  });

  it('requires at least one amount', () => {
    expect(() => addMoney()).toThrow();
  });
});

describe('convertMoney', () => {
  it('converts SEK to EUR at a recorded rate', () => {
    // 3190.00 kr at 0.087 => 277.53 €
    const converted = convertMoney(sek(319000), 'EUR', rate('SEK', 'EUR', '0.08700000'));
    expect(converted).toEqual(eur(27753));
    expect(toDecimalString(converted!)).toBe('277.53');
  });

  it('is the identity for a same-currency conversion and needs no rate', () => {
    expect(convertMoney(eur(1290), 'EUR', null)).toEqual(eur(1290));
  });

  it('returns null when no rate is available', () => {
    expect(convertMoney(sek(319000), 'EUR', null)).toBeNull();
  });

  it('refuses a rate that does not describe the requested pair', () => {
    // Holding a DKK->EUR rate must not be used to convert SEK.
    expect(convertMoney(sek(319000), 'EUR', rate('DKK', 'EUR', '0.13400000'))).toBeNull();
  });

  it('refuses a non-positive or unparseable rate', () => {
    expect(convertMoney(sek(100), 'EUR', rate('SEK', 'EUR', '0'))).toBeNull();
    expect(convertMoney(sek(100), 'EUR', rate('SEK', 'EUR', 'not-a-rate'))).toBeNull();
  });

  it('rounds half-up at the cent, deterministically', () => {
    // 100 minor units at 0.005 => 0.5 minor units => rounds to 1.
    expect(convertMoney(sek(100), 'EUR', rate('SEK', 'EUR', '0.00500000'))).toEqual(eur(1));
  });

  it('does not lose precision on a large amount times a scaled rate', () => {
    // 10,000,000.00 kr exercises the BigInt path: 1e9 minor x 1e8 scale = 1e17,
    // far past Number.MAX_SAFE_INTEGER.
    const converted = convertMoney(sek(1_000_000_000), 'EUR', rate('SEK', 'EUR', '0.08700000'));
    expect(converted).toEqual(eur(87_000_000));
    expect(toDecimalString(converted!)).toBe('870000.00');
  });
});

describe('vatOf', () => {
  it('computes Finnish VAT on a net amount', () => {
    // 25.5 % of 100.00 = 25.50
    expect(vatOf(eur(10000), 25.5)).toEqual(eur(2550));
  });

  it('computes a fractional-cent VAT with half-up rounding', () => {
    // 24 % of 99.99 = 23.9976 => 24.00
    expect(vatOf(eur(9999), 24)).toEqual(eur(2400));
  });

  it('is zero for a zero rate and zero for a zero base', () => {
    expect(vatOf(eur(9999), 0)).toEqual(eur(0));
    expect(vatOf(eur(0), 24)).toEqual(eur(0));
  });

  it('rejects a negative or non-finite rate', () => {
    expect(vatOf(eur(100), -1)).toBeNull();
    expect(vatOf(eur(100), Number.NaN)).toBeNull();
  });
});

describe('deliveredTotal', () => {
  it('adds product price, shipping, tax and duty', () => {
    const total = deliveredTotal({
      productPrice: eur(29900),
      shippingPrice: eur(1290),
      estimatedTax: eur(500),
      importFees: eur(250),
    });
    expect(toDecimalString(total!)).toBe('319.40');
  });

  it('is the worked example from the brief: 299 + 12.90 to Finland', () => {
    const total = deliveredTotal({
      productPrice: eur(29900),
      shippingPrice: eur(1290),
      estimatedTax: null,
      importFees: null,
    });
    expect(toDecimalString(total!)).toBe('311.90');
  });

  it('treats free shipping as zero, which is not the same as unknown', () => {
    const total = deliveredTotal({
      productPrice: eur(32900),
      shippingPrice: zeroMoney('EUR'),
      estimatedTax: null,
      importFees: null,
    });
    expect(toDecimalString(total!)).toBe('329.00');
  });

  it('returns null when shipping is unknown, even though every other part is known', () => {
    const total = deliveredTotal({
      productPrice: eur(27753),
      shippingPrice: null,
      estimatedTax: eur(0),
      importFees: eur(0),
    });
    expect(total).toBeNull();
  });

  it('omits unknown tax and duty rather than nulling the whole total', () => {
    // The asymmetry is the point: absent VAT on a domestic EU order means there
    // is nothing to add, whereas absent shipping means the total is unknowable.
    const total = deliveredTotal({
      productPrice: eur(29900),
      shippingPrice: eur(1290),
      estimatedTax: null,
      importFees: null,
    });
    expect(total).not.toBeNull();
    expect(toDecimalString(total!)).toBe('311.90');
  });

  it('throws rather than mixing currencies inside a delivered total', () => {
    expect(() =>
      deliveredTotal({
        productPrice: eur(29900),
        shippingPrice: sek(12900),
        estimatedTax: null,
        importFees: null,
      }),
    ).toThrow(CurrencyMismatchError);
  });
});
