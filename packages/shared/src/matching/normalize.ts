import { categorySynonymIndex } from '../verticals/registry';
import {
  MARKETING_PHRASES_BY_LENGTH,
  STORE_TITLE_SUFFIXES,
  isProtectedTerm,
} from './marketing';

/**
 * Stage 2 — text normalisation.
 *
 * Turns "Sony WH-1000XM5 vastamelukuulokkeet, Musta" and
 * "Sony WH1000XM5 Wireless Headphones, Black" into token sets that can actually
 * be compared, without destroying the information that tells two *variants*
 * apart.
 *
 * **The step order is load-bearing.** Unit rules depend on characters that
 * later steps strip: `13"` must become `13in` before `"` is removed, and
 * `24 000 mAh` must lose its thousands separator before whitespace is
 * collapsed. Reordering these silently changes what matches what, which is why
 * each step is tested individually.
 *
 * What this deliberately does *not* do is remove variant information. Storage
 * sizes, colours, generations, screen sizes and pack quantities all survive
 * into `tokens` and `unitTokens`, because `variants.ts` needs them to refuse a
 * merge. Normalisation makes titles comparable; it never makes them equal.
 */

export interface NormalisedName {
  /** The fully normalised string, whitespace-collapsed. */
  normalized: string;
  /** Identity tokens: everything except recognised category terms. */
  tokens: string[];
  /** Tokens produced by unit normalisation (`256gb`, `13in`, `24000mah`). */
  unitTokens: string[];
  /** Category inferred from a recognised Finnish or English category noun. */
  inferredCategory: string | null;
  /** Marketing phrases that were removed, for the explanation panel. */
  marketingRemoved: string[];
}

/**
 * A deliberately tiny stopword list. Over-removal costs more signal than it
 * saves: "of" is noise, but "air" and "pro" are products.
 */
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'with',
  'for',
  'of',
  'in',
  'ja',
  'tai',
  'kanssa',
  'och',
  'med',
]);

const CAPACITY_ROLE_WINDOW = 3;
const RAM_NEIGHBOURS = /^(ram|muisti|muistia|ddr\d?|lpddr\d?x?|memory|unified)$/;
const STORAGE_NEIGHBOURS = /^(ssd|nvme|hdd|emmc|storage|tallennustila|levy|kiintolevy)$/;

/** Strip HTML tags — descriptions occasionally carry them into titles. */
function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ');
}

/**
 * Fold diacritics via NFKD + combining-mark removal. `näyttö → naytto`,
 * `Elgiganten Kök → elgiganten kok`. This is what lets a Finnish and an English
 * title meet in the middle.
 */
function foldDiacritics(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '');
}

/** Typographic characters retailers actually emit, folded onto ASCII. */
function foldTypography(value: string): string {
  return value
    .replace(/[–—‐‑‒−]/g, '-')
    .replace(/[“”„«»″]/g, '"')
    .replace(/[’′]/g, "'")
    .replace(/[×]/g, 'x')
    // Non-breaking, narrow no-break and thin spaces, written as escapes so the
    // no-irregular-whitespace rule can tell deliberate from accidental.
    .replace(/[\u00A0\u202F\u2009]/g, ' ');
}

/**
 * Join a space-separated thousands group: `24 000 mAh` → `24000 mAh`.
 *
 * Restricted to the units that genuinely reach four figures. A bare
 * `(\d) (\d{3})` rule looks harmless and is not: "iPhone 16 128 GB" would
 * become "iPhone 16128 GB", destroying both the model number and the storage
 * size in one step.
 */
function joinThousands(value: string): string {
  let previous: string;
  let current = value;
  do {
    previous = current;
    current = current.replace(
      /(\d)[ ](\d{3})(?!\d)(?=\s*(?:mah|w|watt(?:ia|s)?|kw)\b)/gi,
      '$1$2',
    );
  } while (current !== previous);
  return current;
}

function roundCapacity(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Decide whether a capacity figure refers to memory, storage, or something the
 * title never says. The unknown bucket is not a failure — it is the case
 * "iPhone 16 128 GB" falls into, and `variants.ts` handles it explicitly so the
 * 128 GB and 256 GB listings still refuse to merge.
 */
function capacityRole(tokens: readonly string[], index: number): 'ram' | 'storage' | 'cap' {
  // Search outward by distance, and at equal distance prefer the token *after*
  // the number. "16 GB RAM 512 GB SSD" puts both role words one token away from
  // both capacities; only the following-wins rule reads it correctly.
  for (let distance = 1; distance <= CAPACITY_ROLE_WINDOW; distance += 1) {
    for (const neighbour of [tokens[index + distance], tokens[index - distance]]) {
      if (!neighbour) continue;
      if (RAM_NEIGHBOURS.test(neighbour)) return 'ram';
      if (STORAGE_NEIGHBOURS.test(neighbour)) return 'storage';
    }
  }
  return 'cap';
}

/**
 * Unit normalisation, run before punctuation is stripped.
 *
 * Capacity is emitted role-tagged (`storage:256gb`, `ram:16gb`, `cap:128gb`) so
 * the variant layer can tell "256 GB of storage" from "256 GB of anything".
 */
function normaliseUnits(value: string): string {
  let text = joinThousands(value);

  // Decimal comma → dot, so "13,6 tuumaa" and "13.6 inch" agree.
  text = text.replace(/(\d),(\d)/g, '$1.$2');

  // Terabytes become gigabytes, so "1 TB" and "1024 GB" are one token.
  //
  // The `(?<![:\d.])` guard is what makes normalisation idempotent: without it
  // a second pass over an already-tagged `storage:256gb` would re-split it into
  // `storage: 256gb`, losing the role tag and changing the result.
  text = text.replace(
    /(?<![:\d.])(\d+(?:\.\d+)?)\s*(?:tb|tt|terabytes?|teratavua)\b/gi,
    (_match, amount: string) => ` ${roundCapacity(Number(amount) * 1024)}gb `,
  );
  text = text.replace(
    /(?<![:\d.])(\d+(?:\.\d+)?)\s*(?:gb|gt|gigabytes?|gigatavua)\b/gi,
    (_match, amount: string) => ` ${roundCapacity(Number(amount))}gb `,
  );

  // Screen size. `in` is word-bounded so "made in finland" is untouched.
  text = text.replace(
    /(\d+(?:\.\d+)?)\s*(?:"|''|inches|inch|in\b|tuumainen|tuumaa|tuuman|tuuma)/gi,
    (_match, amount: string) => ` ${roundCapacity(Number(amount))}in `,
  );

  // Power, kilowatts first so `kw` is not eaten by the `w` rule.
  text = text.replace(
    /(\d+(?:\.\d+)?)\s*(?:kw|kilowatt(?:ia)?)\b/gi,
    (_match, amount: string) => ` ${roundCapacity(Number(amount) * 1000)}w `,
  );
  text = text.replace(
    /(\d+(?:\.\d+)?)\s*(?:w|watt(?:ia|s)?)\b/gi,
    (_match, amount: string) => ` ${roundCapacity(Number(amount))}w `,
  );

  // Ranges first, so a lens spec survives as one token. Without this the
  // singular rule below would match only the upper bound and leave a dangling
  // "18-", turning "18-45 mm" into two unrelated tokens.
  text = text.replace(
    /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(?:mm|millimetria)\b/gi,
    (_match, from: string, to: string) =>
      ` ${roundCapacity(Number(from))}-${roundCapacity(Number(to))}mm `,
  );

  // Length, centimetres first for the same reason.
  text = text.replace(
    /(\d+(?:\.\d+)?)\s*(?:cm|senttimetria)\b/gi,
    (_match, amount: string) => ` ${roundCapacity(Number(amount) * 10)}mm `,
  );
  text = text.replace(
    /(?<![-\d.:])(\d+(?:\.\d+)?)\s*(?:mm|millimetria)\b/gi,
    (_match, amount: string) => ` ${roundCapacity(Number(amount))}mm `,
  );

  text = text.replace(/(\d+)\s*mah\b/gi, (_match, amount: string) => ` ${amount}mah `);
  text = text.replace(
    /(\d+)\s*(?:ohm(?:ia)?|Ω)\b/gi,
    (_match, amount: string) => ` ${amount}ohm `,
  );

  // Resolution aliases, so "4K", "UHD" and "2160p" are one token.
  text = text.replace(/\b(?:2160p|uhd)\b/gi, ' 4k ');
  text = text.replace(/\b(?:1440p|wqhd)\b/gi, ' qhd ');
  text = text.replace(/\b1080p\b/gi, ' fhd ');

  return text;
}

/**
 * Collapse model-number separators to a fixed point: `wh-1000xm5 → wh1000xm5`,
 * `oled55c5-4la → oled55c54la`.
 *
 * Digit–separator–digit is deliberately left alone, so `18-45mm` (a lens range)
 * and `1000-2000` survive as written.
 */
function collapseModelSeparators(value: string): string {
  let previous: string;
  let current = value;
  do {
    previous = current;
    current = current
      .replace(/([a-z])\s*[-_/.]\s*(\d)/g, '$1$2')
      .replace(/(\d)\s*[-_/.]\s*([a-z])/g, '$1$2');
  } while (current !== previous);
  return current;
}

/**
 * Split hyphenated *words* into separate tokens: `over-ear` → `over ear`.
 *
 * Stores disagree about this constantly ("Over-Ear" at one, "Over Ear" at
 * another), and leaving it alone costs real similarity on titles that are
 * otherwise identical. Only letter-hyphen-letter is split; model numbers were
 * already joined by `collapseModelSeparators`, and digit-hyphen-digit ranges
 * are left intact.
 */
function splitHyphenatedWords(value: string): string {
  return value.replace(/([a-z])-([a-z])/g, '$1 $2');
}

/** Drop a trailing " | Store" / " - Store" segment when it names a known store. */
function stripStoreSuffix(value: string): string {
  const match = /^(.*?)[\s]*[|–-][\s]*([^|–-]+)$/.exec(value);
  if (!match) return value;
  const head = match[1]?.trim();
  const tail = match[2]?.trim();
  if (!head || !tail) return value;
  return STORE_TITLE_SUFFIXES.includes(tail) ? head : value;
}

/** Remove marketing phrases, longest first, to a fixed point. */
function removeMarketing(value: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  let current = ` ${value} `;

  for (let pass = 0; pass < 5; pass += 1) {
    let changed = false;
    for (const phrase of MARKETING_PHRASES_BY_LENGTH) {
      const pattern = new RegExp(`(?<=\\s)${escapeRegExp(phrase)}(?=\\s)`, 'g');
      if (pattern.test(current)) {
        current = current.replace(pattern, ' ');
        removed.push(phrase);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return { text: current.trim(), removed: [...new Set(removed)] };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Punctuation stripping. `+` survives for `S25+`, `.` for `6.2`, `-` for
 * `18-45`, and `:` for the role-tagged capacity tokens produced above.
 */
function stripPunctuation(value: string): string {
  return value.replace(/[^\p{L}\p{N}+.\-:]+/gu, ' ');
}

function trimTokenEdges(token: string): string {
  return token.replace(/^[-.]+/, '').replace(/[-.]+$/, '');
}

const UNIT_TOKEN = /^(?:(?:ram|storage|cap):)?\d+(?:\.\d+)?(?:gb|in|w|mm|mah|ohm)$/;

/**
 * Category synonyms with diacritics folded the same way tokens are, cached per
 * vertical.
 *
 * Without the fold, "näyttö" in the taxonomy could never match the `naytto`
 * token this normaliser produces — every Finnish category term would silently
 * stop working here while continuing to work in the search parser, which reads
 * the raw index.
 */
const FOLDED_SYNONYMS = new Map<string, Array<{ synonym: string; categoryId: string }>>();

function foldedSynonymIndex(verticalId: string): Array<{ synonym: string; categoryId: string }> {
  const cached = FOLDED_SYNONYMS.get(verticalId);
  if (cached) return cached;

  const folded = categorySynonymIndex(verticalId)
    .map(({ synonym, category }) => ({
      synonym: foldDiacritics(synonym).toLowerCase(),
      categoryId: category.id,
    }))
    .sort((a, b) => b.synonym.length - a.synonym.length);

  FOLDED_SYNONYMS.set(verticalId, folded);
  return folded;
}

/**
 * Extract a category noun from the token stream, reusing the vertical's own
 * synonym index rather than inventing a second taxonomy. Matched terms leave
 * the identity token set so "kuulokkeet" and "headphones" do not depress the
 * similarity score between two titles that agree on everything else.
 *
 * Multi-word synonyms are matched as a token subsequence; single words against
 * individual tokens. Longest synonym wins, which the index guarantees by sort
 * order.
 */
function extractCategory(
  tokens: readonly string[],
  verticalId: string,
): { tokens: string[]; inferredCategory: string | null } {
  const index = foldedSynonymIndex(verticalId);
  const remaining = [...tokens];
  let inferred: string | null = null;

  for (const { synonym, categoryId } of index) {
    if (synonym.includes(' ')) {
      const parts = synonym.split(' ');
      const at = findSubsequence(remaining, parts);
      if (at >= 0) {
        remaining.splice(at, parts.length);
        inferred ??= categoryId;
      }
      continue;
    }

    const at = remaining.indexOf(synonym);
    if (at >= 0) {
      remaining.splice(at, 1);
      inferred ??= categoryId;
    }
  }

  return { tokens: remaining, inferredCategory: inferred };
}

function findSubsequence(haystack: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  outer: for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) continue outer;
    }
    return start;
  }
  return -1;
}

/**
 * Normalise a product title.
 *
 * Idempotent: `normaliseProductName(normaliseProductName(x).normalized)` yields
 * the same `normalized`. Deterministic: no clock, no randomness, no locale
 * sensitivity (`toLowerCase` is called without a locale precisely because a
 * Turkish locale would map `I` to a dotless ı and break every model number).
 */
export function normaliseProductName(
  raw: string,
  options: { verticalId?: string } = {},
): NormalisedName {
  const verticalId = options.verticalId ?? 'electronics';

  let text = stripHtml(raw ?? '');
  text = foldDiacritics(text);
  text = text.toLowerCase();
  text = foldTypography(text);
  text = stripStoreSuffix(text);
  text = normaliseUnits(text);
  text = collapseModelSeparators(text);
  text = splitHyphenatedWords(text);

  const { text: withoutMarketing, removed } = removeMarketing(text.replace(/\s+/g, ' ').trim());

  const rawTokens = stripPunctuation(withoutMarketing)
    .split(/\s+/)
    .map(trimTokenEdges)
    .filter((token) => token.length > 0)
    .filter((token) => !STOPWORDS.has(token) || isProtectedTerm(token));

  // Role-tag capacities now that neighbours are visible as discrete tokens.
  const roleTagged = rawTokens.map((token, index) => {
    const capacity = /^(\d+(?:\.\d+)?)gb$/.exec(token);
    if (!capacity?.[1]) return token;
    return `${capacityRole(rawTokens, index)}:${capacity[1]}gb`;
  });

  const { tokens, inferredCategory } = extractCategory(roleTagged, verticalId);
  const unitTokens = tokens.filter((token) => UNIT_TOKEN.test(token));

  return {
    normalized: roleTagged.join(' '),
    tokens,
    unitTokens,
    inferredCategory,
    marketingRemoved: removed,
  };
}
