import { type Currency } from '../schemas/common';

/**
 * Money as integer minor units.
 *
 * The rest of this package represents prices as floating-point major units
 * (`moneySchema`, `calculateEffectivePrice`, `ProductSummary.currentPrice`), and
 * that contract is not changing — it is depended on by the published API
 * payloads and by the browser client that re-parses them.
 *
 * This module exists because the *destination-aware* arithmetic is a different
 * problem. A delivered total is a chain: convert a currency, add shipping, add
 * VAT, add duty. Every link in a float chain compounds the error of the last
 * one, and `roundTo` at the end cannot recover a cent that was lost in the
 * middle. So the chain happens here, in integers, and converts to major units
 * exactly once — in a mapper, at the display boundary.
 *
 * Two invariants hold everywhere below:
 *
 *  1. `Money.minorUnits` is always a safe integer. A non-integer is a bug, not
 *     a rounding opportunity.
 *  2. Arithmetic never mixes currencies silently. Adding EUR to SEK throws,
 *     because the alternative is a number that looks plausible and is wrong.
 */

/**
 * Digits after the decimal point for each currency.
 *
 * All seven happen to be 2, so this map buys nothing today. It exists because
 * the day a zero-decimal currency (JPY, ISK) or a three-decimal one (BHD) is
 * added, the alternative is hunting down every hard-coded `100` in the codebase.
 */
export const MINOR_UNIT_EXPONENTS: Record<Currency, number> = {
  EUR: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  USD: 2,
  CHF: 2,
  GBP: 2,
};

/** Decimal places carried by a stored exchange rate — matches `Decimal(18, 8)`. */
export const RATE_SCALE_EXPONENT = 8;

const RATE_SCALE = 10n ** BigInt(RATE_SCALE_EXPONENT);

export interface Money {
  /** Always a safe integer. 1299 EUR minor units is €12.99. */
  readonly minorUnits: number;
  readonly currency: Currency;
}

/**
 * A rate as recorded, with the timestamp that makes it auditable.
 *
 * `rate` is a decimal *string*, not a number, and deliberately so: it comes out
 * of Postgres as `Decimal(18, 8)` and parsing it to a float would throw away
 * precision before it has been used for anything. Conversion reads the string.
 */
export interface ExchangeRateSnapshot {
  readonly baseCurrency: Currency;
  readonly quoteCurrency: Currency;
  /** Units of `quoteCurrency` per 1 unit of `baseCurrency`, e.g. "0.08700000". */
  readonly rate: string;
  /** ISO-8601. Never optional — an undated rate cannot be judged for staleness. */
  readonly fetchedAt: string;
}

export class CurrencyMismatchError extends Error {
  constructor(expected: Currency, received: Currency) {
    super(`Cannot combine ${received} with ${expected}: money arithmetic must be single-currency.`);
    this.name = 'CurrencyMismatchError';
  }
}

function exponentFor(currency: Currency): number {
  return MINOR_UNIT_EXPONENTS[currency];
}

function scaleFor(currency: Currency): bigint {
  return 10n ** BigInt(exponentFor(currency));
}

/**
 * Divide, rounding half away from zero, entirely in integers.
 *
 * Exported because the rate-derivation code in `exchange-rate.ts` needs the
 * same rounding. Truncating there would bias every inverted and triangulated
 * rate systematically downward.
 */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('Division by zero in money arithmetic.');
  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  // Half-away-from-zero: bump when twice the remainder reaches the divisor.
  const rounded = remainder * 2n >= absDenominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function toSafeNumber(value: bigint, context: string): number {
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error(`${context} overflowed the safe integer range (got ${value.toString()}).`);
  }
  return asNumber;
}

/**
 * Parse a decimal string to an integer scaled by `10 ** exponent`.
 *
 * Returns null rather than throwing for unparseable input, because the callers
 * are boundaries reading third-party or database values and "this cell was not
 * a number" is a data condition to handle, not a programmer error.
 */
export function parseDecimalToScaled(value: string, exponent: number): bigint | null {
  const trimmed = value.trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) return null;

  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[+-]/, '');
  const [integerPart = '0', fractionPart = ''] = unsigned.split('.');

  // Pad to the target scale, then round on anything beyond it rather than
  // truncating — a rate of 0.086999999 must not silently become 0.08699999.
  const padded = fractionPart.padEnd(exponent + 1, '0');
  const kept = padded.slice(0, exponent);
  const nextDigit = Number(padded[exponent] ?? '0');

  let scaled = BigInt(`${integerPart}${kept}`);
  if (nextDigit >= 5) scaled += 1n;

  return negative ? -scaled : scaled;
}

/**
 * Build `Money` from a decimal string — the preferred ingress for database
 * values, because it never routes the number through a float.
 */
export function fromDecimalString(value: string, currency: Currency): Money | null {
  const scaled = parseDecimalToScaled(value, exponentFor(currency));
  if (scaled == null) return null;
  return { minorUnits: toSafeNumber(scaled, `${currency} amount "${value}"`), currency };
}

/**
 * Build `Money` from floating-point major units.
 *
 * This is the compatibility bridge from the existing float DTO fields. It
 * rounds immediately, so error cannot propagate past this call — but it can
 * only round what it was given. Prefer `fromDecimalString` wherever the exact
 * decimal is still available.
 */
export function fromMajor(major: number, currency: Currency): Money | null {
  if (!Number.isFinite(major)) return null;
  const factor = 10 ** exponentFor(currency);
  const minorUnits = Math.round(major * factor);
  if (!Number.isSafeInteger(minorUnits)) return null;
  return { minorUnits, currency };
}

export function zeroMoney(currency: Currency): Money {
  return { minorUnits: 0, currency };
}

/**
 * Major units, for display and for the float-shaped DTO fields.
 *
 * The only place a `Money` becomes a float. Call it in mappers; never call it
 * part-way through a calculation.
 */
export function toMajor(money: Money): number {
  return money.minorUnits / 10 ** exponentFor(money.currency);
}

/** Exact decimal string, for writing back to a `Decimal` column. */
export function toDecimalString(money: Money): string {
  const exponent = exponentFor(money.currency);
  const negative = money.minorUnits < 0;
  const digits = Math.abs(money.minorUnits).toString().padStart(exponent + 1, '0');
  const integerPart = digits.slice(0, digits.length - exponent);
  const fractionPart = digits.slice(digits.length - exponent);
  const unsigned = exponent === 0 ? integerPart : `${integerPart}.${fractionPart}`;
  return negative ? `-${unsigned}` : unsigned;
}

/**
 * Sum amounts that must all be in the same currency.
 *
 * Throws on a mismatch. That is deliberate: a delivered total silently computed
 * across two currencies is exactly the kind of confidently-wrong number this
 * product exists to expose.
 */
export function addMoney(...parts: readonly Money[]): Money {
  const first = parts[0];
  if (first === undefined) throw new Error('addMoney requires at least one amount.');

  let total = 0;
  for (const part of parts) {
    if (part.currency !== first.currency) {
      throw new CurrencyMismatchError(first.currency, part.currency);
    }
    total += part.minorUnits;
  }
  if (!Number.isSafeInteger(total)) throw new Error('Money sum overflowed the safe integer range.');
  return { minorUnits: total, currency: first.currency };
}

export function subtractMoney(from: Money, amount: Money): Money {
  if (from.currency !== amount.currency) {
    throw new CurrencyMismatchError(from.currency, amount.currency);
  }
  return { minorUnits: from.minorUnits - amount.minorUnits, currency: from.currency };
}

export function compareMoney(a: Money, b: Money): number {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return a.minorUnits - b.minorUnits;
}

export function isZeroMoney(money: Money): boolean {
  return money.minorUnits === 0;
}

/**
 * Convert to another currency using a recorded rate.
 *
 * Returns null when the snapshot does not actually describe this conversion,
 * rather than guessing or inverting silently — a caller holding the wrong rate
 * needs to find out, and an offer whose currency cannot be converted must be
 * reported as incomparable rather than compared wrongly.
 *
 * A same-currency conversion is the identity and needs no rate at all, which is
 * why domestic offers are never affected by rate availability or staleness.
 */
export function convertMoney(
  money: Money,
  to: Currency,
  snapshot: ExchangeRateSnapshot | null,
): Money | null {
  if (money.currency === to) return money;
  if (snapshot == null) return null;
  if (snapshot.baseCurrency !== money.currency || snapshot.quoteCurrency !== to) return null;

  const rateScaled = parseDecimalToScaled(snapshot.rate, RATE_SCALE_EXPONENT);
  if (rateScaled == null || rateScaled <= 0n) return null;

  // BigInt throughout: minorUnits (up to ~1e9) times a rate scaled by 1e8
  // reaches 1e17, well past Number.MAX_SAFE_INTEGER.
  const fromScale = scaleFor(money.currency);
  const toScale = scaleFor(to);

  const numerator = BigInt(money.minorUnits) * rateScaled * toScale;
  const denominator = RATE_SCALE * fromScale;
  const converted = divideRounded(numerator, denominator);

  return { minorUnits: toSafeNumber(converted, `converted ${money.currency}→${to} amount`), currency: to };
}

/**
 * VAT on a net amount, given a percentage such as 24 or 25.5.
 *
 * Integer-exact: the percentage is scaled to the rate precision rather than
 * multiplied as a float, so 24 % of €99.99 is a determined value and not a
 * platform-dependent one.
 */
export function vatOf(net: Money, ratePercent: number): Money | null {
  if (!Number.isFinite(ratePercent) || ratePercent < 0) return null;

  const scaledPercent = parseDecimalToScaled(ratePercent.toString(), RATE_SCALE_EXPONENT);
  if (scaledPercent == null) return null;

  const numerator = BigInt(net.minorUnits) * scaledPercent;
  const denominator = RATE_SCALE * 100n;
  const vat = divideRounded(numerator, denominator);

  return { minorUnits: toSafeNumber(vat, `VAT on ${net.currency} amount`), currency: net.currency };
}

export interface DeliveredTotalInput {
  readonly productPrice: Money;
  /** Null means the store does not publish one. Not zero. Not free. */
  readonly shippingPrice: Money | null;
  readonly estimatedTax: Money | null;
  readonly importFees: Money | null;
}

/**
 * The total a shopper actually pays, or null when it cannot be known.
 *
 * The asymmetry between the nullable inputs is the entire point and is not an
 * oversight:
 *
 *  - **Unknown shipping makes the whole total null.** Every order has a
 *    delivery cost; not knowing it means not knowing the total. Substituting
 *    zero would present the least-informative offer as the cheapest one.
 *  - **Unknown tax or duty contributes nothing.** These are genuinely absent
 *    for a domestic EU order — there is no hidden charge to represent, because
 *    VAT is already inside the shelf price. Callers that mean "possibly
 *    dutiable but uncomputable" must say so with `importDutyStatus`, and the UI
 *    warns; they must not encode it by nulling the total, or a domestic order
 *    and a dutiable one become indistinguishable.
 */
export function deliveredTotal(input: DeliveredTotalInput): Money | null {
  if (input.shippingPrice == null) return null;

  const known = [input.productPrice, input.shippingPrice, input.estimatedTax, input.importFees]
    .filter((part): part is Money => part != null);

  return addMoney(...known);
}

/** The wire shape: integer truth plus the float mirror the UI formats. */
export interface MoneyAmount {
  readonly minorUnits: number;
  readonly major: number;
  readonly currency: Currency;
}

export function toMoneyAmount(money: Money): MoneyAmount {
  return { minorUnits: money.minorUnits, major: toMajor(money), currency: money.currency };
}

export function toMoneyAmountOrNull(money: Money | null): MoneyAmount | null {
  return money == null ? null : toMoneyAmount(money);
}
