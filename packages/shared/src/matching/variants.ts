import {
  GENERATION_IMPLICIT_FIRST,
  MULTIPACK_UNKNOWN,
  SCREEN_INCH_RELATIVE_TOLERANCE,
} from './config';
import type { ConflictSeverity, MatchConflict } from './types';

/**
 * Variant attributes — the layer that refuses a merge.
 *
 * Normalisation makes two titles comparable; this makes sure "comparable" never
 * becomes "identical" for products a shopper would not accept as substitutes.
 * iPhone 16 128 GB and 256 GB, a single AirTag and a four-pack, a 55" and a 65"
 * TV: each of these scores extremely high on name similarity and must still be
 * kept apart.
 *
 * Attribute values already validated into `Product.attributes` win over
 * anything parsed out of a title, because a store that publishes structured
 * data is more trustworthy than a regex reading marketing copy.
 */

export interface VariantAttributes {
  storageGb?: number;
  memoryGb?: number;
  /** Capacities whose role the title never stated. See `capacityRole`. */
  unknownCapacityGb?: number[];
  screenInches?: number;
  impedanceOhm?: number;
  caseSizeMm?: number;
  colour?: string;
  generation?: number;
  /** Always defined, so 1-vs-4 is always comparable and always blocking. */
  packQuantity: number;
  cpu?: string;
  gpu?: string;
  connectivity?: 'wifi' | 'cellular' | 'gps';
  edition?: string;
}

export type VariantAxis = Exclude<keyof VariantAttributes, 'unknownCapacityGb'>;

/**
 * Which axes may block a merge, per category.
 *
 * **Colour is material only for accessories.** A black and a white Sonos Era
 * 100 at the same price are the same purchase decision and *should* be compared
 * together; a black and a blue phone case are separate SKUs a shopper searches
 * for individually. Expressing that as one table entry rather than a special
 * case in code is what keeps the rule reviewable.
 */
export const VARIANT_AXES_BY_CATEGORY: Record<string, readonly VariantAxis[]> = {
  phones: ['storageGb', 'generation', 'packQuantity'],
  tablets: ['storageGb', 'screenInches', 'connectivity', 'generation', 'packQuantity'],
  laptops: ['storageGb', 'memoryGb', 'cpu', 'gpu', 'screenInches', 'generation', 'packQuantity'],
  televisions: ['screenInches', 'generation', 'packQuantity'],
  monitors: ['screenInches', 'generation', 'packQuantity'],
  headphones: ['impedanceOhm', 'generation', 'packQuantity'],
  smartwatches: ['caseSizeMm', 'connectivity', 'generation', 'packQuantity'],
  gaming: ['storageGb', 'edition', 'generation', 'packQuantity'],
  speakers: ['generation', 'packQuantity'],
  cameras: ['edition', 'generation', 'packQuantity'],
  'home-appliances': ['generation', 'packQuantity'],
  accessories: ['colour', 'storageGb', 'packQuantity'],
};

export const DEFAULT_VARIANT_AXES: readonly VariantAxis[] = ['generation', 'packQuantity'];

/**
 * Severity per axis.
 *
 * BLOCKING means "these are different products" — capped below the review
 * threshold, so no candidate row is ever written. REVIEWABLE means "probably
 * different, but a human should look" — capped below auto-attach, so it lands
 * in the queue instead of merging.
 */
const BLOCKING_AXES = new Set<VariantAxis>([
  'storageGb',
  'memoryGb',
  'cpu',
  'gpu',
  'packQuantity',
  'impedanceOhm',
  'caseSizeMm',
  'colour',
]);

/** Screen size blocks on displays, where it *is* the product, and not elsewhere. */
const SCREEN_BLOCKING_CATEGORIES = new Set(['televisions', 'monitors']);

const AXIS_LABELS: Record<VariantAxis, string> = {
  storageGb: 'Storage capacity',
  memoryGb: 'Memory',
  screenInches: 'Screen size',
  impedanceOhm: 'Impedance',
  caseSizeMm: 'Case size',
  colour: 'Colour',
  generation: 'Generation',
  packQuantity: 'Pack quantity',
  cpu: 'Processor',
  gpu: 'Graphics',
  connectivity: 'Connectivity',
  edition: 'Edition',
};

// ── Extraction ──────────────────────────────────────────────────────────────

const COLOURS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['space-grey', ['space grey', 'space gray', 'tahtiharmaa']],
  ['rose-gold', ['rose gold', 'ruusukulta', 'rosegold']],
  ['black', ['black', 'musta', 'svart', 'midnight black']],
  ['white', ['white', 'valkoinen', 'vit']],
  ['silver', ['silver', 'hopea', 'silfver']],
  ['grey', ['grey', 'gray', 'harmaa']],
  ['blue', ['blue', 'sininen', 'navy', 'midnight']],
  ['green', ['green', 'vihrea']],
  ['red', ['red', 'punainen']],
  ['pink', ['pink', 'rose', 'pinkki']],
  ['gold', ['gold', 'kulta']],
  ['titanium', ['titanium', 'titaani']],
  ['graphite', ['graphite', 'grafiitti']],
  ['starlight', ['starlight']],
  ['purple', ['purple', 'violetti', 'lila']],
  ['yellow', ['yellow', 'keltainen']],
  ['orange', ['orange', 'oranssi']],
  ['beige', ['beige', 'cream']],
];

const EDITIONS: readonly string[] = ['pro', 'max', 'ultra', 'plus', 'se', 'mini', 'lite', 'air'];

const ROMAN_GENERATIONS: Record<string, number> = {
  ii: 2,
  iii: 3,
  iv: 4,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
};

function firstNumber(match: RegExpMatchArray | null, group = 1): number | undefined {
  const raw = match?.[group];
  if (raw == null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function extractPackQuantity(text: string): number {
  const explicit =
    /(\d+)\s*(?:kpl|kappaletta|pack|pakkaus|paketti|stk)\b/.exec(text) ??
    // "of" is a stopword and has already been removed by normalisation, so the
    // pattern has to accept both "pack of 4" and the "pack 4" it becomes.
    /\bpack\s*(?:of\s+)?(\d+)\b/.exec(text) ??
    /^(\d+)\s*x\s/.exec(text);
  const quantity = firstNumber(explicit);
  if (quantity != null && quantity > 0 && quantity < 1000) return quantity;

  if (/\b(?:twin\s*pack|kaksoispakkaus|2\s*pack)\b/.test(text)) return 2;
  if (/\b(?:multipack|monipakkaus|monipakkau)\b/.test(text)) return MULTIPACK_UNKNOWN;

  return 1;
}

function extractGeneration(text: string, tokens: readonly string[]): number | undefined {
  const patterns = [
    /(\d+)(?:st|nd|rd|th)?\s*gen(?:eration)?\b/,
    /\bgen\s*(\d+)\b/,
    /(\d+)\.?\s*sukupolvi/,
  ];
  for (const pattern of patterns) {
    const value = firstNumber(pattern.exec(text));
    if (value != null && value >= 1 && value <= 30) return value;
  }

  const mark = /\bmk\s*(ii|iii|iv|v|vi)\b/.exec(text)?.[1];
  if (mark) return mark === 'v' ? 5 : ROMAN_GENERATIONS[mark];

  // A standalone Roman numeral, but never in first position (that is a brand,
  // not a generation) and never bare `i` or `v` — `v` collides with Dyson V15.
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token && token in ROMAN_GENERATIONS) return ROMAN_GENERATIONS[token];
  }

  return undefined;
}

function extractColour(text: string): string | undefined {
  for (const [canonical, spellings] of COLOURS) {
    for (const spelling of spellings) {
      const pattern = new RegExp(`(?:^|\\s)${spelling.replace(/\s/g, '\\s')}(?:$|\\s|,)`);
      if (pattern.test(text)) return canonical;
    }
  }
  return undefined;
}

function extractCpu(text: string): string | undefined {
  const apple = /\bm([1-9])\s*(pro|max|ultra)?\b/.exec(text);
  if (apple?.[1]) return `m${apple[1]}${apple[2] ?? ''}`;

  const ryzen = /\bryzen\s*([3579])\b/.exec(text);
  if (ryzen?.[1]) return `ryzen${ryzen[1]}`;

  const intel = /\b(?:core\s*)?i([3579])\b/.exec(text);
  if (intel?.[1]) return `i${intel[1]}`;

  const snapdragon = /\bsnapdragon\s*8\s*gen\s*(\d)\b/.exec(text);
  if (snapdragon?.[1]) return `snapdragon8g${snapdragon[1]}`;

  return undefined;
}

function extractGpu(text: string): string | undefined {
  const nvidia = /\brtx\s*(\d{4})\b/.exec(text);
  if (nvidia?.[1]) return `rtx${nvidia[1]}`;
  return undefined;
}

function extractConnectivity(text: string): VariantAttributes['connectivity'] {
  if (/\b(?:cellular|5g|lte|4g)\b/.test(text)) return 'cellular';
  if (/\bgps(?:\s*only)?\b/.test(text)) return 'gps';
  if (/\bwi?-?fi\b/.test(text)) return 'wifi';
  return undefined;
}

function extractEdition(tokens: readonly string[]): string | undefined {
  for (const edition of EDITIONS) {
    if (tokens.includes(edition)) return edition;
  }
  return undefined;
}

function unitValues(tokens: readonly string[], suffix: string, prefix?: string): number[] {
  const pattern = new RegExp(`^${prefix ? `${prefix}:` : ''}(\\d+(?:\\.\\d+)?)${suffix}$`);
  return tokens
    .map((token) => pattern.exec(token)?.[1])
    .filter((value): value is string => value != null)
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Build the variant profile for one subject.
 *
 * `attributes` wins over `tokens` wherever both speak, because structured store
 * data beats a regex reading a title.
 */
export function extractVariantAttributes(input: {
  normalizedName: string;
  tokens: readonly string[];
  attributes?: Record<string, unknown> | null;
}): VariantAttributes {
  const text = input.normalizedName;
  const tokens = input.tokens;
  const attributes = input.attributes ?? {};

  const storageFromTokens = unitValues(tokens, 'gb', 'storage');
  const memoryFromTokens = unitValues(tokens, 'gb', 'ram');
  const unknownCapacity = unitValues(tokens, 'gb', 'cap');
  const screenFromTokens = unitValues(tokens, 'in');
  const impedance = unitValues(tokens, 'ohm');
  const caseSize = unitValues(tokens, 'mm');

  const colourAttribute =
    typeof attributes.colour === 'string' ? extractColour(attributes.colour.toLowerCase()) : undefined;

  const result: VariantAttributes = { packQuantity: extractPackQuantity(text) };

  const storage = asNumber(attributes.storageGb) ?? storageFromTokens[0];
  if (storage != null) result.storageGb = storage;

  const memory = asNumber(attributes.memoryGb) ?? memoryFromTokens[0];
  if (memory != null) result.memoryGb = memory;

  if (unknownCapacity.length > 0) result.unknownCapacityGb = unknownCapacity;

  const screen = asNumber(attributes.screenInches) ?? screenFromTokens[0];
  if (screen != null) result.screenInches = screen;

  // Impedance and case size share the raw unit tokens with nothing else in the
  // catalogue, so the first occurrence is unambiguous.
  if (impedance[0] != null) result.impedanceOhm = impedance[0];
  if (caseSize[0] != null) result.caseSizeMm = caseSize[0];

  const colour = colourAttribute ?? extractColour(text);
  if (colour != null) result.colour = colour;

  const generation = extractGeneration(text, tokens);
  if (generation != null) result.generation = generation;

  const cpu = extractCpu(text);
  if (cpu != null) result.cpu = cpu;

  const gpu = extractGpu(text);
  if (gpu != null) result.gpu = gpu;

  const connectivity = extractConnectivity(text);
  if (connectivity != null) result.connectivity = connectivity;

  const edition = extractEdition(tokens);
  if (edition != null) result.edition = edition;

  return result;
}

// ── Comparison ──────────────────────────────────────────────────────────────

export interface VariantComparison {
  conflicts: MatchConflict[];
  /** Axes that differ but are not material for this category. */
  nonMaterialMismatches: string[];
  /** Material axes both sides defined and agreed on. */
  agreedAxes: string[];
  /**
   * Agreed axes excluding `packQuantity`.
   *
   * `packQuantity` defaults to 1, so it is defined on *every* subject and
   * "1 versus 1" agrees for free. Counting it as corroborating evidence would
   * mean every pair of single items looks specification-verified, which is
   * exactly the kind of cheap signal a confidence rule must not accept.
   */
  substantiveAgreedAxes: string[];
}

export function materialAxesFor(category: string): readonly VariantAxis[] {
  return VARIANT_AXES_BY_CATEGORY[category] ?? DEFAULT_VARIANT_AXES;
}

function severityFor(axis: VariantAxis, category: string): ConflictSeverity {
  if (axis === 'screenInches') {
    return SCREEN_BLOCKING_CATEGORIES.has(category) ? 'BLOCKING' : 'REVIEWABLE';
  }
  return BLOCKING_AXES.has(axis) ? 'BLOCKING' : 'REVIEWABLE';
}

function describe(axis: VariantAxis, value: unknown): string {
  if (axis === 'storageGb' || axis === 'memoryGb') return `${String(value)} GB`;
  if (axis === 'screenInches') return `${String(value)}"`;
  if (axis === 'impedanceOhm') return `${String(value)} Ω`;
  if (axis === 'caseSizeMm') return `${String(value)} mm`;
  if (axis === 'packQuantity') {
    return value === MULTIPACK_UNKNOWN ? 'a multipack' : `${String(value)}`;
  }
  return String(value);
}

function valuesAgree(axis: VariantAxis, left: unknown, right: unknown): boolean {
  if (axis === 'screenInches' && typeof left === 'number' && typeof right === 'number') {
    const largest = Math.max(left, right);
    if (largest === 0) return true;
    return Math.abs(left - right) / largest <= SCREEN_INCH_RELATIVE_TOLERANCE;
  }
  return left === right;
}

/**
 * Compare two variant profiles under one category's materiality rules.
 *
 * An axis only produces a verdict when *both* sides define it — one side's
 * silence is missing data, not disagreement. The single exception is
 * `packQuantity`, which always defaults to 1 and is therefore always defined,
 * because "the title does not say four-pack" genuinely does mean "one".
 */
export function compareVariants(
  left: VariantAttributes,
  right: VariantAttributes,
  category: string,
): VariantComparison {
  const material = new Set(materialAxesFor(category));
  const conflicts: MatchConflict[] = [];
  const nonMaterialMismatches: string[] = [];
  const agreedAxes: string[] = [];

  for (const axis of Object.keys(AXIS_LABELS) as VariantAxis[]) {
    let leftValue: unknown = left[axis];
    let rightValue: unknown = right[axis];

    // Generation is implicitly 1 when unmarked, so "gen 2 vs unmarked" is a
    // real difference rather than a gap in the data.
    if (axis === 'generation' && GENERATION_IMPLICIT_FIRST) {
      if (leftValue != null || rightValue != null) {
        leftValue ??= 1;
        rightValue ??= 1;
      }
    }

    if (leftValue == null || rightValue == null) continue;

    if (valuesAgree(axis, leftValue, rightValue)) {
      if (material.has(axis)) agreedAxes.push(axis);
      continue;
    }

    if (!material.has(axis)) {
      nonMaterialMismatches.push(axis);
      continue;
    }

    conflicts.push({
      key: `variant:${axis}`,
      label: AXIS_LABELS[axis],
      detail: `${AXIS_LABELS[axis]} differs: ${describe(axis, leftValue)} versus ${describe(axis, rightValue)}.`,
      severity: severityFor(axis, category),
    });
  }

  const capacityConflict = compareUnknownCapacity(left, right, material);
  if (capacityConflict) conflicts.push(capacityConflict);

  return {
    conflicts,
    nonMaterialMismatches,
    agreedAxes,
    substantiveAgreedAxes: agreedAxes.filter((axis) => axis !== 'packQuantity'),
  };
}

/**
 * The "iPhone 16 128 GB" case.
 *
 * Neither title says whether its gigabytes are storage or memory, so the
 * capacities land in `unknownCapacityGb`. Comparing those sets is the only
 * thing that keeps the 128 GB and 256 GB listings apart, since every other
 * signal — brand, model, name, category — agrees perfectly.
 */
function compareUnknownCapacity(
  left: VariantAttributes,
  right: VariantAttributes,
  material: ReadonlySet<VariantAxis>,
): MatchConflict | null {
  if (!material.has('storageGb')) return null;

  const leftSet = new Set([...(left.unknownCapacityGb ?? []), ...(left.storageGb != null ? [left.storageGb] : [])]);
  const rightSet = new Set([
    ...(right.unknownCapacityGb ?? []),
    ...(right.storageGb != null ? [right.storageGb] : []),
  ]);

  if (leftSet.size === 0 || rightSet.size === 0) return null;
  if ([...leftSet].some((value) => rightSet.has(value))) return null;

  const format = (values: Set<number>) => [...values].sort((a, b) => a - b).join('/');
  return {
    key: 'variant:capacity',
    label: 'Capacity',
    detail: `Capacity differs: ${format(leftSet)} GB versus ${format(rightSet)} GB.`,
    severity: 'BLOCKING',
  };
}

export function hasBlockingConflict(conflicts: readonly MatchConflict[]): boolean {
  return conflicts.some((conflict) => conflict.severity === 'BLOCKING');
}

export function hasReviewableConflict(conflicts: readonly MatchConflict[]): boolean {
  return conflicts.some((conflict) => conflict.severity === 'REVIEWABLE');
}
