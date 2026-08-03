import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_THRESHOLDS } from './config';
import { scoreMatch } from './score';
import type { MatchSubject } from './types';

const EAN_SONY = '4548736132443';
const EAN_OTHER = '5051254321927';

function subject(overrides: Partial<MatchSubject> & { name: string }): MatchSubject {
  return {
    id: overrides.id ?? overrides.name,
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

describe('scoreMatch — identifiers', () => {
  it('treats an exact EAN agreement as a high-confidence match', () => {
    const result = scoreMatch(
      subject({ name: 'Sony WH-1000XM5 vastamelukuulokkeet', brand: 'Sony', ean: EAN_SONY }),
      subject({ name: 'Sony WH-1000XM5 Wireless Headphones', brand: 'Sony', ean: EAN_SONY }),
    );
    expect(result.confidence).toBe('HIGH');
    expect(result.autoAttachable).toBe(true);
    expect(result.method).toBe('IDENTIFIER');
    expect(result.conflicts).toHaveLength(0);
  });

  it('treats contradicting identifiers as blocking, however alike the names', () => {
    const result = scoreMatch(
      subject({ name: 'Sony WH-1000XM5', brand: 'Sony', ean: EAN_SONY }),
      subject({ name: 'Sony WH-1000XM5', brand: 'Sony', ean: EAN_OTHER }),
    );
    expect(result.confidence).toBe('LOW');
    expect(result.score).toBeLessThanOrEqual(DEFAULT_MATCH_THRESHOLDS.conflictScoreCap);
  });

  it('downgrades a shared identifier that spans unrelated categories', () => {
    // A realistic retailer data error: the same EAN printed on a coffee machine
    // and on its milk jug. Stage 1 fires; the context must override it.
    const result = scoreMatch(
      subject({
        name: 'Philips 5400 LatteGo espressokeitin',
        brand: 'Philips',
        category: 'home-appliances',
        ean: EAN_SONY,
        price: 549,
      }),
      subject({
        name: 'Philips LatteGo maitosäiliö',
        brand: 'Philips',
        category: 'accessories',
        ean: EAN_SONY,
        price: 39,
      }),
    );
    expect(result.confidence).not.toBe('HIGH');
    expect(result.autoAttachable).toBe(false);
    expect(result.conflicts.some((c) => c.key === 'identifier:context')).toBe(true);
  });
});

describe('scoreMatch — brand and model', () => {
  it('reaches high confidence on brand plus an exact model number', () => {
    const result = scoreMatch(
      subject({
        name: 'LG OLED evo C5 55" 4K -televisio',
        brand: 'LG',
        category: 'televisions',
        modelNumber: 'OLED55C54LA',
      }),
      subject({
        name: 'LG OLED55C54LA 55 tuuman OLED evo 4K TV',
        brand: 'LG',
        category: 'televisions',
        modelNumber: 'OLED55C54LA',
      }),
    );
    expect(result.confidence).toBe('HIGH');
    expect(result.autoAttachable).toBe(true);
  });

  it('caps model containment at medium, so a partial SKU goes to review', () => {
    const result = scoreMatch(
      subject({
        name: 'Samsung Q70D 65" QLED',
        brand: 'Samsung',
        category: 'televisions',
        modelNumber: 'Q70D',
      }),
      subject({
        name: 'Samsung QE65Q70DATXXC 65" QLED 4K Smart TV',
        brand: 'Samsung',
        category: 'televisions',
        modelNumber: 'QE65Q70DATXXC',
      }),
    );
    expect(result.confidence).not.toBe('HIGH');
  });

  it('recognises a brand published under two spellings', () => {
    const result = scoreMatch(
      subject({ name: 'HP Envy x360 14', brand: 'HP', category: 'laptops' }),
      subject({ name: 'Hewlett Packard Envy x360 14', brand: 'Hewlett Packard', category: 'laptops' }),
    );
    const brand = result.factors.find((factor) => factor.key === 'brand');
    expect(brand?.score).toBe(85);
  });

  it('accepts a brand alias plus an exact model number as strong evidence', () => {
    // Refusing this would send every aliased brand to a human forever, which is
    // a worse failure than the one it protects against.
    const result = scoreMatch(
      subject({
        name: 'HP Envy x360 14 Core i7 512 GB',
        brand: 'HP',
        category: 'laptops',
        modelNumber: 'ENVY-X360-14',
        attributes: { storageGb: 512, memoryGb: 16, screenInches: 14 },
      }),
      subject({
        name: 'Hewlett Packard Envy x360 14 Core i7 512 GB',
        brand: 'Hewlett Packard',
        category: 'laptops',
        modelNumber: 'ENVY-X360-14',
        attributes: { storageGb: 512, memoryGb: 16, screenInches: 14 },
      }),
    );
    expect(result.confidence).toBe('HIGH');
    expect(result.autoAttachable).toBe(true);
  });
});

describe('scoreMatch — specification-corroborated confidence', () => {
  // Two stores listing the same phone, neither publishing an identifier or a
  // model number. Brand, category and a *substantive* specification all agree,
  // which is evidence about the product rather than about its spelling.
  it('accepts brand, category and a confirmed specification as strong evidence', () => {
    const result = scoreMatch(
      subject({
        name: 'Apple iPhone 16 128 GB Musta',
        brand: 'Apple',
        category: 'phones',
        attributes: { storageGb: 128, screenInches: 6.1 },
      }),
      subject({
        name: 'Apple iPhone 16 128 GB',
        brand: 'Apple',
        category: 'phones',
        attributes: { storageGb: 128, screenInches: 6.1 },
      }),
    );
    expect(result.confidence).toBe('HIGH');
    expect(result.autoAttachable).toBe(true);
  });

  // Pack quantity defaults to 1 on every subject, so "1 versus 1" agrees for
  // free. It must not on its own make a pair look specification-verified.
  it('does not treat an agreeing pack quantity as a confirmed specification', () => {
    const result = scoreMatch(
      subject({ name: 'Acme Widget Alpha', brand: 'Acme', category: 'accessories' }),
      subject({ name: 'Acme Widget Alpha', brand: 'Acme', category: 'accessories' }),
    );
    expect(result.confidence).not.toBe('HIGH');
  });
});

describe('scoreMatch — the generic-pair guard', () => {
  // Same brand, same category, agreeing pack quantity: a weighted mean drags
  // these into the mid-seventies on almost no name overlap. Reviewers should
  // never be handed them.
  it('refuses to queue two unrelated products that merely share a brand', () => {
    const result = scoreMatch(
      subject({ name: 'Apple AirTag', brand: 'Apple', category: 'accessories' }),
      subject({ name: 'Apple iPhone 16 silikonikuori Sininen', brand: 'Apple', category: 'accessories' }),
    );
    expect(result.confidence).toBe('LOW');
    expect(result.reviewable).toBe(false);
  });

  it('still allows dissimilar names when an identifier agrees', () => {
    // An identifier is exactly the tool for titles that do not resemble
    // each other, so the name floor must not apply to it.
    const result = scoreMatch(
      subject({ name: 'Sony WH-1000XM5', brand: 'Sony', ean: EAN_SONY }),
      subject({ name: 'Langattomat vastamelukuulokkeet', brand: 'Sony', ean: EAN_SONY }),
    );
    expect(result.confidence).not.toBe('LOW');
  });
});

describe('scoreMatch — the rule that matters most', () => {
  // Name similarity alone can never reach HIGH. A near-identical title with no
  // brand and no model number is a coincidence until a human says otherwise.
  it('never reaches high confidence on name similarity alone', () => {
    const result = scoreMatch(
      subject({ name: 'Wireless Noise Cancelling Over-Ear Headphones Black' }),
      subject({ name: 'Wireless Noise Cancelling Over Ear Headphones Black' }),
    );
    expect(result.factors.find((factor) => factor.key === 'name')?.score).toBeGreaterThan(90);
    expect(result.confidence).not.toBe('HIGH');
    expect(result.autoAttachable).toBe(false);
  });
});

describe('scoreMatch — conflicts cap rather than subtract', () => {
  it('caps a storage conflict below the review threshold, so nothing is stored', () => {
    const result = scoreMatch(
      subject({ name: 'Apple iPhone 16 128 GB', brand: 'Apple', category: 'phones' }),
      subject({ name: 'Apple iPhone 16 256 GB', brand: 'Apple', category: 'phones' }),
    );
    expect(result.score).toBeLessThanOrEqual(DEFAULT_MATCH_THRESHOLDS.conflictScoreCap);
    expect(result.confidence).toBe('LOW');
    expect(result.reviewable).toBe(false);
  });

  it('caps a generation conflict at the reviewable ceiling instead', () => {
    const result = scoreMatch(
      subject({ name: 'Bose QuietComfort Ultra Headphones', brand: 'Bose' }),
      subject({ name: 'Bose QuietComfort Ultra Headphones 2nd gen', brand: 'Bose' }),
    );
    expect(result.score).toBeLessThanOrEqual(DEFAULT_MATCH_THRESHOLDS.reviewableConflictScoreCap);
    expect(result.reviewable).toBe(true);
    expect(result.autoAttachable).toBe(false);
  });

  it('caps an implausible price gap, even with a matching identifier', () => {
    const result = scoreMatch(
      subject({ name: 'Sony WH-1000XM5', brand: 'Sony', ean: EAN_SONY, price: 329 }),
      subject({ name: 'Sony WH-1000XM5 korvatyynyt', brand: 'Sony', ean: EAN_SONY, price: 29 }),
    );
    expect(result.score).toBeLessThanOrEqual(DEFAULT_MATCH_THRESHOLDS.priceConflictScoreCap);
    expect(result.conflicts.some((c) => c.key === 'price:implausible')).toBe(true);
  });

  it('leaves a normal cross-store price difference alone', () => {
    const result = scoreMatch(
      subject({ name: 'Sony WH-1000XM5', brand: 'Sony', ean: EAN_SONY, price: 329 }),
      subject({ name: 'Sony WH-1000XM5', brand: 'Sony', ean: EAN_SONY, price: 339 }),
    );
    expect(result.conflicts).toHaveLength(0);
    expect(result.autoAttachable).toBe(true);
  });
});

describe('scoreMatch — thresholds and invariants', () => {
  const left = subject({ name: 'Sony WH-1000XM5', brand: 'Sony', ean: EAN_SONY });
  const right = subject({ name: 'Sony WH1000XM5 Wireless Headphones', brand: 'Sony', ean: EAN_SONY });

  it('is symmetric', () => {
    expect(scoreMatch(left, right).score).toBe(scoreMatch(right, left).score);
  });

  it('is deterministic', () => {
    expect(scoreMatch(left, right)).toEqual(scoreMatch(left, right));
  });

  it('stamps the engine version onto every result', () => {
    expect(scoreMatch(left, right).engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('honours an overridden auto-attach threshold', () => {
    const strict = scoreMatch(left, right, { thresholds: { autoAttachMinScore: 101 } });
    expect(strict.autoAttachable).toBe(false);
  });

  it('honours an overridden review threshold', () => {
    // Two different Philips headphones: similar enough to be worth a glance by
    // default, not once the bar is raised.
    const pair = [
      subject({ name: 'Philips Fidelio T2 -nappikuulokkeet', brand: 'Philips' }),
      subject({ name: 'Philips Fidelio L4 vastamelukuulokkeet', brand: 'Philips' }),
    ] as const;
    expect(scoreMatch(pair[0], pair[1]).reviewable).toBe(true);
    expect(scoreMatch(pair[0], pair[1], { thresholds: { reviewMinScore: 90 } }).reviewable).toBe(
      false,
    );
  });

  it('keeps the score inside 0–100 and integral', () => {
    const result = scoreMatch(left, right);
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('never omits the name factor, which is always evaluable', () => {
    expect(scoreMatch(left, right).factors.some((factor) => factor.key === 'name')).toBe(true);
  });

  it('omits the brand factor rather than punishing a store that publishes none', () => {
    const anonymous = scoreMatch(
      subject({ name: 'Sony WH-1000XM5' }),
      subject({ name: 'Sony WH-1000XM5', brand: 'Sony' }),
    );
    expect(anonymous.factors.some((factor) => factor.key === 'brand')).toBe(false);
  });
});
