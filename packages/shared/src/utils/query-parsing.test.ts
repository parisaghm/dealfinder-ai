import { describe, expect, it } from 'vitest';
import { parseAmount, parseSearchQuery } from './query-parsing';

describe('parseAmount', () => {
  it.each([
    { input: '1000', expected: 1000 },
    { input: '1,000', expected: 1000 },
    { input: '1.000', expected: 1000 },
    { input: '1 000', expected: 1000 },
    { input: '€1,000', expected: 1000 },
    { input: '1000 eur', expected: 1000 },
    { input: '24,90', expected: 24.9 },
    { input: '24.90', expected: 24.9 },
    { input: '1,234,567', expected: 1234567 },
  ])('reads $input as $expected', ({ input, expected }) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it('rejects text that is not an amount', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});

describe('parseSearchQuery — the briefed example searches', () => {
  it('"Wireless headphones" → category + remaining text', () => {
    const parsed = parseSearchQuery('Wireless headphones');
    expect(parsed.category).toBe('headphones');
    expect(parsed.query).toBe('Wireless');
    expect(parsed.maximumPrice).toBeUndefined();
  });

  it('"Laptop under €1,000" → laptops under 1000', () => {
    const parsed = parseSearchQuery('Laptop under €1,000');
    expect(parsed.category).toBe('laptops');
    expect(parsed.maximumPrice).toBe(1000);
    expect(parsed.query).toBe('');
    expect(parsed.notes).toContain('Category Laptops');
  });

  it('"Philips headphones with at least 30% discount" → brand + category + discount', () => {
    const parsed = parseSearchQuery('Philips headphones with at least 30% discount');
    expect(parsed.category).toBe('headphones');
    expect(parsed.minimumDiscount).toBe(30);
    expect(parsed.query.toLowerCase()).toBe('philips');
  });
});

describe('parseSearchQuery — maximum price phrasings', () => {
  it.each([
    'laptop under 800',
    'laptop below €800',
    'laptop less than 800 eur',
    'laptop cheaper than 800',
    'laptop up to 800',
    'laptop max 800',
    'laptop maximum 800',
    'laptop no more than 800',
    'laptop at most 800',
  ])('understands "%s"', (input) => {
    expect(parseSearchQuery(input).maximumPrice).toBe(800);
  });

  it('understands a trailing "or less"', () => {
    expect(parseSearchQuery('headphones €150 or less').maximumPrice).toBe(150);
  });
});

describe('parseSearchQuery — minimum discount phrasings', () => {
  it.each([
    'tv at least 30%',
    'tv minimum 30% off',
    'tv min 30 % discount',
    'tv over 30%',
    'tv more than 30%',
    'tv 30%+ off',
    'tv 30% or more',
    'tv 30% off',
    'tv 30% discount',
  ])('understands "%s"', (input) => {
    expect(parseSearchQuery(input).minimumDiscount).toBe(30);
  });

  it('clamps a nonsensical discount into a usable range', () => {
    expect(parseSearchQuery('tv 0% off').minimumDiscount).toBe(1);
    expect(parseSearchQuery('tv 99% off').minimumDiscount).toBe(99);
  });
});

describe('parseSearchQuery — combinations and edge cases', () => {
  it('extracts price and discount together without one eating the other', () => {
    const parsed = parseSearchQuery('oled tv under €1,200 with at least 25% off');
    expect(parsed.maximumPrice).toBe(1200);
    expect(parsed.minimumDiscount).toBe(25);
    expect(parsed.category).toBe('televisions');
  });

  it('prefers the longest matching category synonym', () => {
    expect(parseSearchQuery('robot vacuum under 300').category).toBe('home-appliances');
  });

  it('matches plural forms', () => {
    expect(parseSearchQuery('monitors').category).toBe('monitors');
  });

  it('returns a bare query untouched when there is nothing to interpret', () => {
    const parsed = parseSearchQuery('Sony WH-1000XM5');
    expect(parsed.query).toBe('Sony WH-1000XM5');
    expect(parsed.category).toBeUndefined();
    expect(parsed.notes).toEqual([]);
  });

  it('handles empty and whitespace-only input', () => {
    expect(parseSearchQuery('').query).toBe('');
    expect(parseSearchQuery('   ').query).toBe('');
    expect(parseSearchQuery('   ').notes).toEqual([]);
  });

  it('explains every interpretation it made', () => {
    const parsed = parseSearchQuery('laptop under 900 with at least 20% off');
    expect(parsed.notes).toHaveLength(3);
    expect(parsed.notes.join(' | ')).toMatch(/Minimum discount 20%/);
    expect(parsed.notes.join(' | ')).toMatch(/Maximum price/);
    expect(parsed.notes.join(' | ')).toMatch(/Category Laptops/);
  });

  it('does not treat a model number containing digits as a price', () => {
    const parsed = parseSearchQuery('iphone 15');
    expect(parsed.maximumPrice).toBeUndefined();
    expect(parsed.category).toBe('phones');
  });
});

describe('parseAmount — mixed separator formats', () => {
  it.each([
    { input: '1.099,00', expected: 1099 },
    { input: '1,099.00', expected: 1099 },
    { input: '12.345,67', expected: 12345.67 },
    { input: '1 099,00', expected: 1099 },
    { input: '999,99', expected: 999.99 },
  ])('reads $input as $expected', ({ input, expected }) => {
    expect(parseAmount(input)).toBe(expected);
  });
});
