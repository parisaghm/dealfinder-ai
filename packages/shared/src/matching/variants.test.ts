import { describe, expect, it } from 'vitest';
import { normaliseProductName } from './normalize';
import {
  compareVariants,
  extractVariantAttributes,
  hasBlockingConflict,
  hasReviewableConflict,
} from './variants';

function profile(name: string, attributes?: Record<string, unknown>) {
  const normalised = normaliseProductName(name);
  return extractVariantAttributes({
    normalizedName: normalised.normalized,
    tokens: normalised.tokens,
    attributes: attributes ?? null,
  });
}

function compare(
  left: string,
  right: string,
  category: string,
  attributes?: [Record<string, unknown> | undefined, Record<string, unknown> | undefined],
) {
  return compareVariants(
    profile(left, attributes?.[0]),
    profile(right, attributes?.[1]),
    category,
  );
}

describe('extractVariantAttributes', () => {
  it('defaults pack quantity to 1, so single-versus-multipack is always comparable', () => {
    expect(profile('Apple AirTag').packQuantity).toBe(1);
  });

  it.each([
    ['Apple AirTag 4 kpl -pakkaus', 4],
    ['Apple AirTag pack of 4', 4],
    ['4 x Apple AirTag', 4],
    ['Apple AirTag twin pack', 2],
  ])('reads the pack quantity in "%s" as %i', (name, expected) => {
    expect(profile(name).packQuantity).toBe(expected);
  });

  it.each([
    ['Bose QuietComfort Ultra (2. sukupolvi)', 2],
    ['AirPods Pro 3rd gen', 3],
    ['Sonos Era gen 2', 2],
    ['Sennheiser Momentum MK III', 3],
  ])('reads the generation in "%s" as %i', (name, expected) => {
    expect(profile(name).generation).toBe(expected);
  });

  it('does not mistake a bare V for a generation', () => {
    // Dyson V15 would otherwise become "generation 5".
    expect(profile('Dyson V15 Detect').generation).toBeUndefined();
  });

  it('prefers structured attributes over anything read from the title', () => {
    const result = profile('Apple MacBook Air', { storageGb: 512, colour: 'Silver' });
    expect(result.storageGb).toBe(512);
    expect(result.colour).toBe('silver');
  });

  it.each([
    ['Sony WH-1000XM5 Musta', 'black'],
    ['Sonos Era 100 White', 'white'],
    ['Apple iPhone 16 Space Grey', 'space-grey'],
    ['Samsung Galaxy S25 Sininen', 'blue'],
  ])('reads the colour in "%s" as %s', (name, expected) => {
    expect(profile(name).colour).toBe(expected);
  });

  it.each([
    ['Apple MacBook Air M4', 'm4'],
    ['Apple MacBook Pro M4 Pro', 'm4pro'],
    ['Lenovo Yoga Ryzen 7', 'ryzen7'],
    ['Dell XPS Core i7', 'i7'],
  ])('reads the processor in "%s" as %s', (name, expected) => {
    expect(profile(name).cpu).toBe(expected);
  });
});

// ── The refusals. Each of these scores very high on name similarity and must
// still be kept apart. ───────────────────────────────────────────────────────

describe('compareVariants — merges that must be blocked', () => {
  it('refuses to merge iPhone 16 128 GB with iPhone 16 256 GB', () => {
    // Neither title says whether the gigabytes are storage or memory, so this
    // relies entirely on the unknown-role capacity comparison.
    const result = compare('Apple iPhone 16 128 GB', 'Apple iPhone 16 256 GB', 'phones');
    expect(hasBlockingConflict(result.conflicts)).toBe(true);
    expect(result.conflicts[0]?.detail).toMatch(/128.*256|Capacity differs/);
  });

  it('refuses to merge a single AirTag with a four-pack', () => {
    const result = compare('Apple AirTag', 'Apple AirTag 4 kpl -pakkaus', 'accessories');
    expect(hasBlockingConflict(result.conflicts)).toBe(true);
    expect(result.conflicts.some((c) => c.key === 'variant:packQuantity')).toBe(true);
  });

  it('refuses to merge laptops with different memory', () => {
    const result = compare(
      'Lenovo Yoga Slim 7',
      'Lenovo Yoga Slim 7',
      'laptops',
      [{ memoryGb: 16 }, { memoryGb: 8 }],
    );
    expect(hasBlockingConflict(result.conflicts)).toBe(true);
  });

  it('refuses to merge laptops with different processors', () => {
    const result = compare('Lenovo Yoga Ryzen 7', 'Lenovo Yoga Ryzen 5', 'laptops');
    expect(hasBlockingConflict(result.conflicts)).toBe(true);
    expect(result.conflicts.some((c) => c.key === 'variant:cpu')).toBe(true);
  });

  it('refuses to merge a 55" and a 65" television', () => {
    const result = compare(
      'Samsung QLED TV',
      'Samsung QLED TV',
      'televisions',
      [{ screenInches: 55 }, { screenInches: 65 }],
    );
    expect(hasBlockingConflict(result.conflicts)).toBe(true);
  });

  it('refuses to merge headphones with different impedance', () => {
    const result = compare(
      'Beyerdynamic DT 770 PRO 80 ohm',
      'Beyerdynamic DT 770 PRO 250 ohm',
      'headphones',
    );
    expect(hasBlockingConflict(result.conflicts)).toBe(true);
  });

  it('refuses to merge a black and a blue phone case, where colour is the SKU', () => {
    const result = compare(
      'Apple Silicone Case Black',
      'Apple Silicone Case Blue',
      'accessories',
    );
    expect(hasBlockingConflict(result.conflicts)).toBe(true);
    expect(result.conflicts.some((c) => c.key === 'variant:colour')).toBe(true);
  });
});

describe('compareVariants — differences that need review, not refusal', () => {
  it('flags adjacent generations for a human', () => {
    const result = compare(
      'Bose QuietComfort Ultra Headphones',
      'Bose QuietComfort Ultra Headphones (2. sukupolvi)',
      'headphones',
    );
    expect(hasBlockingConflict(result.conflicts)).toBe(false);
    expect(hasReviewableConflict(result.conflicts)).toBe(true);
  });

  it('treats an unmarked title as generation 1 rather than as missing data', () => {
    const first = profile('Bose QuietComfort Ultra');
    const second = profile('Bose QuietComfort Ultra 2nd gen');
    expect(first.generation).toBeUndefined();
    expect(second.generation).toBe(2);
    expect(compareVariants(first, second, 'headphones').conflicts).toHaveLength(1);
  });

  it('flags a screen-size difference on a laptop without blocking it', () => {
    const result = compare(
      'Apple MacBook Air',
      'Apple MacBook Air',
      'laptops',
      [{ screenInches: 13.6 }, { screenInches: 15.3 }],
    );
    expect(hasBlockingConflict(result.conflicts)).toBe(false);
    expect(hasReviewableConflict(result.conflicts)).toBe(true);
  });
});

describe('compareVariants — differences that must not block', () => {
  it('treats 13" and 13.6" as the same screen', () => {
    // The same MacBook Air is advertised both ways; 4.4 % apart is one product.
    const result = compare(
      'Apple MacBook Air',
      'Apple MacBook Air',
      'laptops',
      [{ screenInches: 13 }, { screenInches: 13.6 }],
    );
    expect(result.conflicts).toHaveLength(0);
    expect(result.agreedAxes).toContain('screenInches');
  });

  it('merges a black and a white speaker, where colour is not the decision', () => {
    const result = compare('Sonos Era 100 Black', 'Sonos Era 100 White', 'speakers');
    expect(result.conflicts).toHaveLength(0);
    expect(result.nonMaterialMismatches).toContain('colour');
  });

  it('ignores an axis only one side defines', () => {
    const result = compare(
      'Apple MacBook Air',
      'Apple MacBook Air 512 GB SSD',
      'laptops',
      [{}, undefined],
    );
    expect(result.conflicts).toHaveLength(0);
  });
});

describe('materiality', () => {
  it('is the category, not the axis, that decides whether colour blocks', () => {
    const black = profile('Widget Black');
    const blue = profile('Widget Blue');
    expect(compareVariants(black, blue, 'accessories').conflicts).toHaveLength(1);
    expect(compareVariants(black, blue, 'speakers').conflicts).toHaveLength(0);
  });

  it('falls back to generation and pack quantity for an unknown category', () => {
    const result = compareVariants(
      profile('Widget'),
      profile('Widget 4 kpl'),
      'not-a-real-category',
    );
    expect(hasBlockingConflict(result.conflicts)).toBe(true);
  });

  it('always explains a conflict in a full sentence', () => {
    const result = compare('Apple iPhone 16 128 GB', 'Apple iPhone 16 256 GB', 'phones');
    for (const conflict of result.conflicts) {
      expect(conflict.detail.length).toBeGreaterThan(10);
      expect(conflict.detail.endsWith('.')).toBe(true);
    }
  });
});
