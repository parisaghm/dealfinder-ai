import { describe, expect, it } from 'vitest';
import { formatDiscount, formatMoney, formatRelativeTime, humanise } from './format';

/**
 * Intl output contains non-breaking spaces, so assertions normalise whitespace
 * rather than hard-coding the exact byte sequence.
 */
const normalise = (value: string) => value.replace(/[\s ]+/g, ' ').trim();

describe('formatMoney', () => {
  it('drops decimals for whole amounts and keeps them otherwise', () => {
    expect(normalise(formatMoney(1099))).toBe('1 099 €');
    expect(normalise(formatMoney(24.9))).toBe('24,90 €');
  });

  it('rounds to cents', () => {
    expect(normalise(formatMoney(24.899))).toBe('24,90 €');
  });

  it('renders an em dash for unusable values instead of "NaN €"', () => {
    expect(formatMoney(Number.NaN)).toBe('—');
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('honours a different currency', () => {
    expect(formatMoney(50, 'USD')).toContain('50');
  });
});

describe('formatDiscount', () => {
  it('formats a positive discount', () => {
    expect(normalise(formatDiscount(32) ?? '')).toBe('-32 %');
  });

  it('returns null when there is no discount worth showing', () => {
    expect(formatDiscount(0)).toBeNull();
    expect(formatDiscount(-5)).toBeNull();
    expect(formatDiscount(Number.NaN)).toBeNull();
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-05-20T12:00:00.000Z');

  it.each([
    { iso: '2026-05-20T11:59:30.000Z', expected: 'just now' },
    { iso: '2026-05-20T11:45:00.000Z', expected: '15 minutes ago' },
    { iso: '2026-05-20T11:00:00.000Z', expected: '1 hour ago' },
    { iso: '2026-05-20T09:00:00.000Z', expected: '3 hours ago' },
    { iso: '2026-05-19T12:00:00.000Z', expected: '1 day ago' },
    { iso: '2026-05-14T12:00:00.000Z', expected: '6 days ago' },
  ])('renders $iso as "$expected"', ({ iso, expected }) => {
    expect(formatRelativeTime(iso, now)).toBe(expected);
  });

  it('falls back to a date for anything older than a month', () => {
    expect(formatRelativeTime('2026-01-05T12:00:00.000Z', now)).not.toMatch(/ago/);
  });

  it('does not produce negative phrasing for clock skew', () => {
    expect(formatRelativeTime('2026-05-20T12:05:00.000Z', now)).toBe('just now');
  });

  it('handles invalid dates', () => {
    expect(formatRelativeTime('nonsense', now)).toBe('—');
  });
});

describe('humanise', () => {
  it('turns a slug into a readable label', () => {
    expect(humanise('home-appliances')).toBe('Home appliances');
    expect(humanise('gaming')).toBe('Gaming');
    expect(humanise('')).toBe('');
  });
});
