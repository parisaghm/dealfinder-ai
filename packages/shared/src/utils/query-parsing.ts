import { DEFAULT_VERTICAL_ID, categorySynonymIndex } from '../verticals/registry';

/**
 * Turns a single search box into structured filters.
 *
 * The product brief asks for searches like "Laptop under €1,000" and "Philips
 * headphones with at least 30% discount" to work, so rather than making users
 * fill in three fields we interpret the sentence and *tell them what we did*
 * via `notes`. Everything it extracts is also editable in the filter panel,
 * so a wrong guess is never a dead end.
 *
 * Deliberately a small deterministic parser, not a language model: it must be
 * instant, offline, and unit-testable.
 */

export interface ParsedSearchQuery {
  /** Remaining free text after structured filters were lifted out. */
  query: string;
  maximumPrice?: number;
  minimumDiscount?: number;
  category?: string;
  /** Human-readable summary of each interpretation, for display. */
  notes: string[];
}

const CURRENCY_WORDS = String.raw`(?:€|eur|euros?)`;
const AMOUNT = String.raw`\d[\d\s.,\u00a0]*`;

/**
 * Parse a written amount into a number.
 *
 * Handles English thousands separators ("1,000"), Finnish/European ones
 * ("1 000", "1.000") and decimal commas ("24,90"), because a Finnish store
 * front and an English UI will both show up in real input.
 */
export function parseAmount(raw: string): number | null {
  let text = raw
    .toLowerCase()
    .replace(new RegExp(CURRENCY_WORDS, 'g'), '')
    .replace(/[\s\u00a0]/g, '')
    .trim();
  if (!text) return null;

  if (/^\d+(?:\.\d{3})+,\d{1,2}$/.test(text)) {
    // 1.099,00 — European: dot groups thousands, comma is the decimal mark.
    // Checked first because it is the only form containing *both* separators
    // in that order, and misreading it turns €1,099 into €1.10.
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+(?:,\d{3})+(?:\.\d+)?$/.test(text)) {
    // 1,000 / 1,099.00 — comma groups digits in threes.
    text = text.replace(/,/g, '');
  } else if (/^\d+(?:\.\d{3})+$/.test(text)) {
    // 1.000 — European thousands separator, no decimal part.
    text = text.replace(/\./g, '');
  } else if (/^\d+,\d{1,2}$/.test(text)) {
    // 24,90 — decimal comma.
    text = text.replace(',', '.');
  } else {
    text = text.replace(/,/g, '');
  }

  const value = Number.parseFloat(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

interface Extraction {
  text: string;
  value: number;
}

/** Apply the first matching pattern, returning the value and the cleaned text. */
function extract(text: string, patterns: readonly RegExp[]): Extraction | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const captured = match?.[1];
    if (!match || captured == null) continue;

    const value = parseAmount(captured);
    if (value == null) continue;

    return { text: text.replace(match[0], ' '), value };
  }
  return null;
}

const MAX_PRICE_PATTERNS: readonly RegExp[] = [
  new RegExp(
    String.raw`\b(?:under|below|less than|cheaper than|up to|no more than|at most|max(?:imum)?)\s*(?:price\s*)?(?:of\s*)?${CURRENCY_WORDS}?\s*(${AMOUNT})\s*${CURRENCY_WORDS}?`,
    'i',
  ),
  // No leading \b: a currency symbol is not a word character, so `\b€` can
  // never match after a space.
  new RegExp(String.raw`${CURRENCY_WORDS}\s*(${AMOUNT})\s*(?:or less|or below|and under)\b`, 'i'),
  new RegExp(String.raw`\b(${AMOUNT})\s*${CURRENCY_WORDS}?\s*(?:or less|or below|and under)\b`, 'i'),
];

const MIN_DISCOUNT_PATTERNS: readonly RegExp[] = [
  // "at least 30% discount", "minimum 25 % off", "over 40%"
  /\b(?:at least|atleast|minimum|min|over|more than|above)\s*(\d{1,2})\s*%/i,
  // "30%+ off", "30% or more"
  /\b(\d{1,2})\s*%\s*(?:\+|or more|or better|and up)/i,
  // "30% off", "30 % discount"
  /\b(\d{1,2})\s*%\s*(?:off|discount|reduction|sale)/i,
];

/** Filler words left behind once the structured parts are removed. */
const LEFTOVER_NOISE =
  /\b(?:with|and|that|which|has|have|having|is|are|a|an|the|for|of|deals?|offers?|discounts?|price|prices|show me|find|search)\b/gi;

/**
 * Interpret a search string.
 *
 * @param input   Raw text from the search box.
 * @param options `verticalId` selects which category taxonomy to match against.
 */
export function parseSearchQuery(
  input: string,
  options: { verticalId?: string } = {},
): ParsedSearchQuery {
  const verticalId = options.verticalId ?? DEFAULT_VERTICAL_ID;
  const notes: string[] = [];

  let working = (input ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
  if (!working) return { query: '', notes };

  const result: ParsedSearchQuery = { query: '', notes };

  // Discount before price: "30% off" must not have its digits eaten by the
  // price patterns.
  const discount = extract(working, MIN_DISCOUNT_PATTERNS);
  if (discount) {
    const percent = Math.min(99, Math.max(1, Math.round(discount.value)));
    result.minimumDiscount = percent;
    working = discount.text;
    notes.push(`Minimum discount ${percent}%`);
  }

  const maximumPrice = extract(working, MAX_PRICE_PATTERNS);
  if (maximumPrice && maximumPrice.value > 0) {
    result.maximumPrice = maximumPrice.value;
    working = maximumPrice.text;
    notes.push(`Maximum price €${maximumPrice.value.toLocaleString('fi-FI')}`);
  }

  // Category: match the longest synonym present, then lift it out of the text
  // so "Philips headphones" becomes { category: headphones, query: "philips" }.
  const cleaned = working.replace(/[\s\u00a0]+/g, ' ').trim();
  const haystack = ` ${cleaned.toLowerCase()} `;
  for (const { synonym, category } of categorySynonymIndex(verticalId)) {
    const boundary = new RegExp(`(^|\\s)${escapeRegExp(synonym)}(s?)(\\s|$)`, 'i');
    if (boundary.test(cleaned)) {
      result.category = category.id;
      working = cleaned.replace(boundary, ' ');
      notes.push(`Category ${category.label}`);
      break;
    }
    if (haystack.includes(` ${synonym} `)) {
      result.category = category.id;
      working = cleaned.replace(new RegExp(escapeRegExp(synonym), 'i'), ' ');
      notes.push(`Category ${category.label}`);
      break;
    }
  }

  result.query = working
    .replace(LEFTOVER_NOISE, ' ')
    .replace(/[\s\u00a0]+/g, ' ')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
    .trim();

  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
