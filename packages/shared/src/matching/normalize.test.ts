import { describe, expect, it } from 'vitest';
import { normaliseProductName } from './normalize';

const normalise = (raw: string) => normaliseProductName(raw).normalized;
const tokensOf = (raw: string) => normaliseProductName(raw).tokens;

describe('normaliseProductName — folding', () => {
  it('folds Finnish diacritics so a Finnish and an English title can meet', () => {
    expect(normalise('Samsung Odyssey pelinäyttö')).toContain('samsung');
    expect(normalise('LG näyttö')).not.toMatch(/[äö]/);
  });

  it('lowercases without locale sensitivity', () => {
    // A Turkish locale would map I to a dotless ı and break every model number.
    expect(normalise('SONY WH1000XM5')).toBe('sony wh1000xm5');
  });

  it('folds typographic dashes, quotes and multiplication signs', () => {
    expect(normalise('Sony WH–1000XM5')).toBe('sony wh1000xm5');
    expect(normalise('Apple 2 × USB-C')).toContain('x');
  });

  it('strips HTML that leaked in from a description', () => {
    expect(normalise('<b>Sony</b> WH1000XM5')).toBe('sony wh1000xm5');
  });
});

describe('normaliseProductName — units', () => {
  it('joins non-breaking thousands separators', () => {
    // The seeded Anker power bank is written exactly this way.
    expect(normalise('Anker 737 Power Bank 24 000 mAh')).toContain('24000mah');
  });

  it.each([
    ['Apple MacBook Air 13" M4', '13in'],
    ['Apple MacBook Air 13,6 tuumaa', '13.6in'],
    ['Apple MacBook Air 13.6 inch', '13.6in'],
    ['LG OLED 55 tuuman televisio', '55in'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalise(input)).toContain(expected);
  });

  it('converts terabytes to gigabytes so 1 TB and 1024 GB agree', () => {
    expect(normalise('Seagate 1 TB SSD')).toContain('1024gb');
    expect(normalise('Seagate 1024 GB SSD')).toContain('1024gb');
  });

  it('normalises watts, kilowatts, millimetres and impedance', () => {
    expect(normalise('Anker 140 W charger')).toContain('140w');
    expect(normalise('Oven 2 kW')).toContain('2000w');
    expect(normalise('Apple Watch 45 mm')).toContain('45mm');
    expect(normalise('Apple Watch 4,5 cm')).toContain('45mm');
    expect(normalise('Beyerdynamic DT 770 PRO 250 ohm')).toContain('250ohm');
  });

  it('normalises resolution aliases onto one token', () => {
    expect(normalise('Samsung 2160p TV')).toContain('4k');
    expect(normalise('Samsung UHD TV')).toContain('4k');
    expect(normalise('Dell 1440p monitor')).toContain('qhd');
  });

  it('tags capacity with its role when the title says one', () => {
    expect(normalise('Lenovo Yoga 16 GB RAM 512 GB SSD')).toContain('ram:16gb');
    expect(normalise('Lenovo Yoga 16 GB RAM 512 GB SSD')).toContain('storage:512gb');
  });

  it('tags capacity as unknown-role when the title does not say', () => {
    // This is the iPhone case: nothing in the title distinguishes storage from
    // memory, and variants.ts relies on the `cap:` tag to keep 128 and 256 apart.
    expect(normalise('Apple iPhone 16 128 GB')).toContain('cap:128gb');
  });
});

describe('normaliseProductName — model separators', () => {
  it.each([
    ['Sony WH-1000XM5', 'wh1000xm5'],
    ['Sony WH1000XM5', 'wh1000xm5'],
    ['Sony WH_1000XM5', 'wh1000xm5'],
    ['LG OLED-55C5', 'oled55c5'],
    ['LG OLED55C54LA', 'oled55c54la'],
    ['Samsung QE65Q70DATXXC', 'qe65q70datxxc'],
  ])('collapses %s to contain %s', (input, expected) => {
    expect(normalise(input)).toContain(expected);
  });

  it('makes the two published spellings of one model identical', () => {
    // Gigantti writes "WH-1000XM5"; Power writes "WH1000XM5". Everything
    // downstream depends on these being the same token.
    expect(normalise('Sony WH-1000XM5')).toBe(normalise('Sony WH1000XM5'));
  });

  it('leaves digit-hyphen-digit alone so lens ranges survive', () => {
    expect(normalise('Canon EOS R50 + 18-45 mm')).toContain('18-45mm');
  });
});

describe('normaliseProductName — marketing removal', () => {
  it.each([
    'TARJOUS Sony WH-1000XM5',
    'Sony WH-1000XM5 kampanjahinta',
    'BLACK FRIDAY Sony WH-1000XM5',
    'Sony WH-1000XM5 clearance',
    'Sony WH-1000XM5 free shipping',
  ])('removes marketing from "%s"', (input) => {
    expect(normalise(input).trim()).toBe('sony wh1000xm5');
  });

  it('reports what it removed, for the explanation panel', () => {
    expect(normaliseProductName('TARJOUS Sony WH-1000XM5').marketingRemoved).toContain('tarjous');
  });

  it('strips a trailing store-name suffix', () => {
    expect(normalise('Sony WH-1000XM5 | Gigantti').trim()).toBe('sony wh1000xm5');
  });

  it('leaves a trailing segment alone when it is not a store', () => {
    expect(normalise('Sony WH-1000XM5 - Black')).toContain('black');
  });

  // The single most dangerous failure mode in this file: an over-eager
  // marketing list merges genuinely different products. These words carry
  // identity and must survive intact.
  it.each([
    ['Apple iPhone 16 Pro', 'pro'],
    ['Apple iPhone 16 Plus', 'plus'],
    ['Samsung Galaxy S25 Ultra', 'ultra'],
    ['Apple MacBook Air', 'air'],
    ['Apple iPad mini', 'mini'],
    ['LG OLED evo C5', 'evo'],
    ['AirPods Pro 3rd gen', 'gen'],
    ['Sonos Era 100 Musta', 'musta'],
    ['Apple case White', 'white'],
    ['Special Edition console', 'edition'],
  ])('keeps the identity term in "%s"', (input, mustKeep) => {
    expect(tokensOf(input)).toContain(mustKeep);
  });
});

describe('normaliseProductName — category extraction', () => {
  it.each([
    ['Sony WH-1000XM5 vastamelukuulokkeet', 'headphones'],
    ['Sony WH-1000XM5 Wireless Headphones', 'headphones'],
    ['Roborock Q7 Max robotti-imuri', 'home-appliances'],
    ['Canon EOS R50 järjestelmäkamera', 'cameras'],
    ['Samsung Odyssey G5 pelinäyttö', 'monitors'],
    ['Garmin Forerunner 265 juoksukello', 'smartwatches'],
  ])('infers a category from "%s"', (input, expected) => {
    expect(normaliseProductName(input).inferredCategory).toBe(expected);
  });

  it('lifts the category noun out of the identity tokens', () => {
    // Otherwise "kuulokkeet" and "headphones" would depress the similarity
    // score between two titles that agree on everything that matters.
    const finnish = normaliseProductName('Sony WH-1000XM5 vastamelukuulokkeet');
    const english = normaliseProductName('Sony WH-1000XM5 Wireless Headphones');
    expect(finnish.tokens).not.toContain('vastamelukuulokkeet');
    expect(english.tokens).not.toContain('headphones');
    expect(finnish.tokens).toEqual(expect.arrayContaining(['sony', 'wh1000xm5']));
  });
});

describe('normaliseProductName — invariants', () => {
  const SAMPLES = [
    'Sony WH-1000XM5 vastamelukuulokkeet, Musta',
    'Apple MacBook Air 13" M4 256 GB',
    'Apple iPhone 16 128 GB',
    'LG OLED evo C5 55" 4K -televisio',
    'Anker 737 Power Bank 24 000 mAh',
    'Canon EOS R50 -järjestelmäkamera + 18-45 mm',
    'Lenovo Yoga Slim 7 16 GB RAM 512 GB SSD',
    'TARJOUS Samsung QE65Q70DATXXC 65" QLED 4K Smart TV | Gigantti',
  ];

  it.each(SAMPLES)('is idempotent for "%s"', (input) => {
    const once = normaliseProductName(input);
    const twice = normaliseProductName(once.normalized);
    expect(twice.normalized).toBe(once.normalized);
  });

  it.each(SAMPLES)('is deterministic for "%s"', (input) => {
    expect(normaliseProductName(input)).toEqual(normaliseProductName(input));
  });

  it('never throws on degenerate input', () => {
    expect(() => normaliseProductName('')).not.toThrow();
    expect(normaliseProductName('').tokens).toEqual([]);
    expect(normaliseProductName('   ,,,   ').tokens).toEqual([]);
  });
});
