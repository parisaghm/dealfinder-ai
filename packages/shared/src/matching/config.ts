import type { MatchFactorKey } from './types';

/**
 * Matching configuration: weights, thresholds and the calibration constants
 * behind them.
 *
 * Everything tunable lives here rather than being scattered as literals through
 * the scorer, for the same reason `pricing/deal-quality.ts` collects its
 * constants at the top: a reviewer needs to see the whole calibration on one
 * screen to judge whether it is defensible.
 *
 * Documented in `docs/product-matching.md`, and overridable per call via the
 * `MatchThresholds` argument to `scoreMatch` (the API reads env overrides once
 * at boot and passes them down).
 */

/**
 * Bumped whenever the normaliser, the variant rules or the weights change.
 *
 * Persisted alongside every stored decision so a stale one is *recognisable*
 * rather than silently wrong: `npm run db:match -- --force` re-derives anything
 * produced by an older engine.
 */
export const MATCHER_VERSION = '1.0.0';

/**
 * Factor weights. They need not total 100 — the score is the weighted mean of
 * the factors that could actually be evaluated, so a missing signal is neutral
 * rather than punitive. This is the same normalisation `scoreDealQuality`
 * performs, and for the same reason: stores publish wildly different amounts of
 * metadata, and punishing silence would make sparse listings unmatchable.
 */
export const MATCH_WEIGHTS: Record<MatchFactorKey, number> = {
  identifier: 40,
  brand: 20,
  model: 22,
  name: 18,
  category: 8,
  variant: 12,
};

export interface MatchThresholds {
  /** Score at or above which a HIGH, conflict-free pair attaches automatically. */
  autoAttachMinScore: number;
  /** Score at or above which a pair is stored as a candidate for review. */
  reviewMinScore: number;
  /** Ceiling applied when any BLOCKING variant conflict is present. */
  conflictScoreCap: number;
  /** Ceiling applied when any REVIEWABLE variant conflict is present. */
  reviewableConflictScoreCap: number;
  /** Ceiling applied when the two prices are implausibly far apart. */
  priceConflictScoreCap: number;
  /** `max/min` price ratio above which the pair is treated as implausible. */
  priceSanityRatio: number;
  /** Never store more than this many candidates per source product. */
  maxCandidatesPerProduct: number;
  /** Upper bound on canonicals pulled from the database per retrieval branch. */
  candidateFetchLimit: number;
}

/**
 * Default thresholds.
 *
 * `autoAttachMinScore` sits at 88 because the only pairs that reach it without
 * an identifier are exact brand + exact model number matches; everything softer
 * lands in review. `reviewMinScore` at 62 is the point below which the pairs we
 * saw in the sample catalogue were consistently unrelated — and anything below
 * it is *discarded, never written*, which is a stronger reading of "never
 * silently merge low-confidence matches" than persisting and filtering later.
 */
export const DEFAULT_MATCH_THRESHOLDS: MatchThresholds = {
  autoAttachMinScore: 88,
  reviewMinScore: 62,
  conflictScoreCap: 40,
  reviewableConflictScoreCap: 70,
  priceConflictScoreCap: 55,
  priceSanityRatio: 3,
  maxCandidatesPerProduct: 3,
  candidateFetchLimit: 50,
};

export function resolveThresholds(overrides?: Partial<MatchThresholds>): MatchThresholds {
  return overrides ? { ...DEFAULT_MATCH_THRESHOLDS, ...overrides } : DEFAULT_MATCH_THRESHOLDS;
}

// ── Stage-1 identifier scores ───────────────────────────────────────────────

export const IDENTIFIER_MATCH_SCORE = 100;
export const MPN_MATCH_SCORE = 98;
export const MODEL_MATCH_SCORE = 92;

// ── Factor calibration ──────────────────────────────────────────────────────

/** Brands that are the same company under two published spellings. */
export const BRAND_ALIASES: Record<string, string> = {
  'hewlett packard': 'hp',
  'hewlett-packard': 'hp',
  'lg electronics': 'lg',
  'samsung electronics': 'samsung',
  'apple inc': 'apple',
  'sony corporation': 'sony',
  'asus tek': 'asus',
  asustek: 'asus',
};

export const BRAND_ALIAS_SCORE = 85;

/**
 * Categories close enough that a cross-listing is plausible rather than
 * disqualifying. Kept deliberately tiny: a permissive neighbour table is how a
 * coffee machine ends up matched to a milk jug.
 */
export const CATEGORY_NEIGHBOURS: ReadonlyArray<readonly [string, string]> = [
  ['televisions', 'monitors'],
  ['laptops', 'tablets'],
];

export const CATEGORY_NEIGHBOUR_SCORE = 60;

/** Model-number containment (`OLED55C5` inside `OLED55C54LA`) scores this. */
export const MODEL_CONTAINMENT_SCORE = 70;
/** Containment only counts when the length gap is at most this many characters. */
export const MODEL_CONTAINMENT_MAX_LENGTH_DELTA = 2;

/** Points deducted from the variant factor per non-material attribute mismatch. */
export const NON_MATERIAL_MISMATCH_PENALTY = 6;

/**
 * Screen sizes are compared *relatively*, not absolutely.
 *
 * Retailers advertise the same MacBook Air as 13" and 13.6" — 4.4 % apart, and
 * unmistakably one product. Meanwhile 55" vs 65" is 15 % and 11" vs 12.9" is
 * 14.7 %, both unmistakably two. No absolute tolerance separates those cases.
 */
export const SCREEN_INCH_RELATIVE_TOLERANCE = 0.06;

/**
 * An unmarked title is generation 1, so "generation 2 on one side, unmarked on
 * the other" is a real difference rather than missing data. Without this,
 * "QuietComfort Ultra" and "QuietComfort Ultra (2. sukupolvi)" merge silently.
 */
export const GENERATION_IMPLICIT_FIRST = true;

/** Sentinel for "the title says multipack but not how many". */
export const MULTIPACK_UNKNOWN = -1;
