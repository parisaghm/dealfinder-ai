import { describe, expect, it } from 'vitest';
import { normaliseProductName } from './normalize';
import { nameSimilarity, sharedTokens, tokenWeight } from './similarity';

const tokens = (name: string) => normaliseProductName(name).tokens;
const similarity = (left: string, right: string) => nameSimilarity(tokens(left), tokens(right));

describe('tokenWeight', () => {
  it('weights digit-bearing tokens highest, because model fragments live there', () => {
    expect(tokenWeight('wh1000xm5')).toBeGreaterThan(tokenWeight('wireless'));
    expect(tokenWeight('wireless')).toBeGreaterThan(tokenWeight('pro'));
  });
});

describe('nameSimilarity', () => {
  it('is symmetric', () => {
    const a = tokens('Sony WH-1000XM5 vastamelukuulokkeet');
    const b = tokens('Sony WH1000XM5 Wireless Headphones Black');
    expect(nameSimilarity(a, b)).toBe(nameSimilarity(b, a));
  });

  it('ignores word order', () => {
    expect(nameSimilarity(['sony', 'wh1000xm5'], ['wh1000xm5', 'sony'])).toBe(100);
  });

  it('is unaffected by a repeated token', () => {
    // A title that says "pro" three times is not three times more about "pro".
    expect(nameSimilarity(['sony', 'pro'], ['sony', 'pro', 'pro', 'pro'])).toBe(100);
  });

  it('scores the real cross-store pair highly', () => {
    expect(
      similarity('Sony WH-1000XM5 vastamelukuulokkeet', 'Sony WH1000XM5 Wireless Headphones'),
    ).toBeGreaterThanOrEqual(80);
  });

  it('scores unrelated products low', () => {
    expect(similarity('Sony WH-1000XM5 headphones', 'LG OLED evo C5 55" television')).toBeLessThan(
      20,
    );
  });

  it('lets a shared model number outweigh differing filler', () => {
    const withModel = similarity(
      'Samsung QE65Q70DATXXC QLED TV',
      'Samsung QE65Q70DATXXC 65" QLED 4K Smart TV',
    );
    const withoutModel = similarity('Samsung QLED TV', 'Samsung 65" QLED 4K Smart TV');
    expect(withModel).toBeGreaterThan(withoutModel);
  });

  it('returns 0 rather than 100 when both sides are empty', () => {
    // Knowing nothing about either name is not evidence that they match.
    expect(nameSimilarity([], [])).toBe(0);
    expect(nameSimilarity(['sony'], [])).toBe(0);
  });
});

describe('sharedTokens', () => {
  it('lists the overlap heaviest first, for the explanation', () => {
    const shared = sharedTokens(
      ['sony', 'wh1000xm5', 'black'],
      ['sony', 'wh1000xm5', 'black', 'wireless'],
    );
    expect(shared[0]).toBe('wh1000xm5');
    expect(shared).toContain('sony');
  });

  it('is stable for equal weights', () => {
    expect(sharedTokens(['b', 'a'], ['a', 'b'])).toEqual(['a', 'b']);
  });
});
