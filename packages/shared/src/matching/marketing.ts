/**
 * Store marketing phrases stripped from product titles before comparison.
 *
 * Two lists, and the second matters more than the first.
 *
 * `MARKETING_PHRASES` is what we remove. It is Finnish, English and Swedish
 * because Finnish retailers mix all three, and it is phrase-based rather than
 * word-based so "nyt vain" is removed while "nyt" alone survives.
 *
 * `PROTECTED_TERMS` is what we must *never* remove, whatever else changes here.
 * An over-eager marketing list is the single easiest way to turn this feature
 * into a bad-merge generator: strip "pro" and every iPhone merges with every
 * iPhone Pro; strip "musta" and a black case merges with a blue one. The list
 * has its own test, and any addition to `MARKETING_PHRASES` is checked against
 * it at module load.
 */

export const MARKETING_PHRASES: readonly string[] = [
  // Finnish
  'tarjoushinta',
  'tarjous',
  'alennettu hinta',
  'alennettu',
  'alennus',
  'kampanjahinta',
  'kampanja',
  'etuhinta',
  'nyt vain',
  'paivan diili',
  'huippudiili',
  'poistotuote',
  'poistomyynti',
  'loppuunmyynti',
  'viimeiset kappaleet',
  'rajoitettu era',
  'saasta',
  'uutuus',
  'joulutarjous',
  'kesaale',
  'talviale',
  'ilmainen toimitus',
  // English
  'best seller',
  'bestseller',
  'brand new',
  'black friday',
  'cyber monday',
  'limited offer',
  'special offer',
  'hot deal',
  'todays deal',
  'clearance',
  'free shipping',
  'on sale',
  'sale',
  'outlet',
  'new arrival',
  // Swedish
  'fyndvara',
  'kampanjpris',
  'kampanj',
  'rea',
  'nyhet',
];

/**
 * Words that carry product identity and must survive normalisation intact.
 *
 * Editions and tiers (`pro`, `max`, `ultra`) distinguish products a shopper
 * would never accept as substitutes. Colours matter for accessories. `gen`
 * feeds generation extraction. Removing any of these would merge genuinely
 * different SKUs.
 */
export const PROTECTED_TERMS: readonly string[] = [
  // Editions and tiers
  'pro',
  'max',
  'plus',
  'ultra',
  'air',
  'mini',
  'se',
  'lite',
  'evo',
  'gen',
  'edition',
  'premium',
  'standard',
  'signature',
  'special',
  // Colours (EN / FI / SV)
  'black',
  'musta',
  'svart',
  'white',
  'valkoinen',
  'vit',
  'silver',
  'hopea',
  'grey',
  'gray',
  'harmaa',
  'blue',
  'sininen',
  'navy',
  'midnight',
  'green',
  'vihrea',
  'red',
  'punainen',
  'pink',
  'rose',
  'gold',
  'kulta',
  'titanium',
  'titaani',
  'graphite',
  'starlight',
  'purple',
  'violetti',
  'yellow',
  'keltainen',
  'orange',
  'oranssi',
  'beige',
  'cream',
];

const PROTECTED_SET = new Set(PROTECTED_TERMS);

/**
 * Guard rail, evaluated once at module load: no marketing phrase may consist
 * solely of protected words. Catches the mistake at import time rather than
 * after it has quietly merged half the catalogue.
 */
for (const phrase of MARKETING_PHRASES) {
  const words = phrase.split(' ');
  if (words.every((word) => PROTECTED_SET.has(word))) {
    throw new Error(
      `Marketing phrase "${phrase}" is built entirely from protected identity terms. ` +
        'Removing it would merge genuinely different products.',
    );
  }
}

export function isProtectedTerm(term: string): boolean {
  return PROTECTED_SET.has(term);
}

/**
 * Phrases sorted longest-first, so "kampanjahinta" is consumed before
 * "kampanja" would leave a dangling "hinta".
 */
export const MARKETING_PHRASES_BY_LENGTH: readonly string[] = [...MARKETING_PHRASES].sort(
  (a, b) => b.length - a.length,
);

/**
 * Store-name suffixes retailers append to page titles
 * ("… | Gigantti", "… – Verkkokauppa.com").
 */
export const STORE_TITLE_SUFFIXES: readonly string[] = [
  'gigantti',
  'power',
  'verkkokauppa.com',
  'verkkokauppa',
  'elkjop',
  'elgiganten',
  'jimms',
  'proshop',
];
