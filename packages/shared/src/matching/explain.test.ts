import { describe, expect, it } from 'vitest';
import { buildExplanation, summariseMatch } from './explain';
import { scoreMatch } from './score';
import type { MatchConflict, MatchFactor, MatchSubject } from './types';

const factor = (overrides: Partial<MatchFactor> & { key: MatchFactor['key'] }): MatchFactor => ({
  label: 'Label',
  weight: 10,
  score: 100,
  detail: 'A complete sentence explaining the factor.',
  ...overrides,
});

const conflict = (overrides: Partial<MatchConflict> = {}): MatchConflict => ({
  key: 'variant:storageGb',
  label: 'Storage capacity',
  detail: 'Storage capacity differs: 128 GB versus 256 GB.',
  severity: 'BLOCKING',
  ...overrides,
});

function subject(overrides: Partial<MatchSubject> & { name: string }): MatchSubject {
  return {
    id: overrides.name,
    brand: null,
    category: 'headphones',
    vertical: 'electronics',
    gtin: null,
    ean: null,
    mpn: null,
    modelNumber: null,
    attributes: null,
    ...overrides,
  };
}

describe('buildExplanation', () => {
  it('orders reasons by actual contribution, strongest first', () => {
    const { reasons } = buildExplanation(
      [
        factor({ key: 'category', weight: 8, score: 100, detail: 'Same category.' }),
        factor({ key: 'identifier', weight: 40, score: 100, detail: 'Same GTIN.' }),
        factor({ key: 'brand', weight: 20, score: 100, detail: 'Same brand.' }),
      ],
      [],
    );
    expect(reasons.map((reason) => reason.key)).toEqual(['identifier', 'brand', 'category']);
  });

  it('gives every reason a complete sentence', () => {
    const { reasons } = buildExplanation([factor({ key: 'brand' })], []);
    for (const reason of reasons) {
      expect(reason.detail.trim().length).toBeGreaterThan(10);
      expect(reason.detail.trim().endsWith('.')).toBe(true);
    }
  });

  it('omits factors that argued against the match from the reasons', () => {
    const { reasons } = buildExplanation(
      [factor({ key: 'brand', score: 0, detail: 'Different brands: sony versus philips.' })],
      [],
    );
    expect(reasons).toHaveLength(0);
  });

  // A weak factor is information a reviewer needs. It is not the same thing as
  // a variant conflict, but it must not vanish either.
  it('surfaces a weak factor as a conflict rather than dropping it', () => {
    const { conflicts } = buildExplanation(
      [factor({ key: 'brand', score: 0, detail: 'Different brands: sony versus philips.' })],
      [],
    );
    expect(conflicts.some((entry) => entry.key === 'factor:brand')).toBe(true);
  });

  it('never collapses conflicts away, however strong the reasons are', () => {
    const { conflicts } = buildExplanation(
      [
        factor({ key: 'identifier', weight: 40 }),
        factor({ key: 'brand', weight: 20 }),
        factor({ key: 'model', weight: 22 }),
        factor({ key: 'name', weight: 18 }),
      ],
      [conflict()],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.severity).toBe('BLOCKING');
  });

  it('sorts blocking conflicts above reviewable ones', () => {
    const { conflicts } = buildExplanation(
      [],
      [
        conflict({ key: 'variant:generation', severity: 'REVIEWABLE' }),
        conflict({ key: 'variant:storageGb', severity: 'BLOCKING' }),
      ],
    );
    expect(conflicts[0]?.severity).toBe('BLOCKING');
  });

  it('keeps the more severe verdict when a key appears twice', () => {
    const { conflicts } = buildExplanation(
      [],
      [
        conflict({ key: 'variant:x', severity: 'REVIEWABLE' }),
        conflict({ key: 'variant:x', severity: 'BLOCKING' }),
      ],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.severity).toBe('BLOCKING');
  });
});

describe('explanations produced by the real scorer', () => {
  it('explains an identifier match in terms a reviewer can check', () => {
    const result = scoreMatch(
      subject({ name: 'Sony WH-1000XM5', brand: 'Sony', ean: '4548736132443' }),
      subject({ name: 'Sony WH1000XM5 Wireless Headphones', brand: 'Sony', ean: '4548736132443' }),
    );
    expect(result.reasons.length).toBeGreaterThan(0);
    // An EAN is a GTIN, so the padded 14-digit key is what gets quoted — which
    // is also the key the two listings were actually matched on.
    expect(result.reasons.map((reason) => reason.detail).join(' ')).toMatch(
      /GTIN 04548736132443/,
    );
    for (const reason of result.reasons) {
      expect(reason.detail.trim().endsWith('.')).toBe(true);
    }
  });

  it('quotes the actual name similarity percentage', () => {
    const result = scoreMatch(
      subject({ name: 'Sony WH-1000XM5', brand: 'Sony' }),
      subject({ name: 'Sony WH-1000XM5 Black', brand: 'Sony' }),
    );
    const name = result.reasons.find((reason) => reason.key === 'name');
    expect(name?.detail).toMatch(/Name similarity \d+%/);
  });

  it('explains a refusal as clearly as an acceptance', () => {
    const result = scoreMatch(
      subject({ name: 'Apple iPhone 16 128 GB', brand: 'Apple', category: 'phones' }),
      subject({ name: 'Apple iPhone 16 256 GB', brand: 'Apple', category: 'phones' }),
    );
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts.map((entry) => entry.detail).join(' ')).toMatch(/128|256/);
  });
});

describe('summariseMatch', () => {
  it('leads with the conflict when there is one', () => {
    expect(summariseMatch(70, 'MEDIUM', [], [conflict()])).toMatch(/Storage capacity differs/);
  });

  it('leads with the strongest reason when there is none', () => {
    expect(
      summariseMatch(96, 'HIGH', [{ key: 'identifier', label: 'Identifier', detail: 'Same GTIN.', weight: 40, score: 100 }], []),
    ).toMatch(/Same GTIN/);
  });

  it('still states the score when there is nothing else to say', () => {
    expect(summariseMatch(50, 'LOW', [], [])).toMatch(/50\/100/);
  });
});
