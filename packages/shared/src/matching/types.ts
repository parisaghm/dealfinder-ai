/**
 * Cross-store product matching — shared vocabulary.
 *
 * Everything here is pure data. The engine never touches a database, a clock or
 * the network, which is what lets the whole of stage 1–3 be unit-tested without
 * standing anything up, and what lets the seed script, the backfill job and the
 * API all run *identical* matching logic.
 */

/** How a store offer came to be attached to a canonical product. */
export const MATCH_METHODS = ['IDENTIFIER', 'MODEL', 'NAME', 'MANUAL', 'AI'] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];

export const MATCH_CONFIDENCES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type MatchConfidence = (typeof MATCH_CONFIDENCES)[number];

export const MATCH_CANDIDATE_STATUSES = [
  'PENDING',
  'AI_CONFIRMED',
  'APPROVED',
  'REJECTED',
  'SUPERSEDED',
] as const;
export type MatchCandidateStatus = (typeof MATCH_CANDIDATE_STATUSES)[number];

/**
 * One side of a comparison: either a store listing or an existing canonical
 * product. Both are reduced to this shape before scoring, so the engine cannot
 * accidentally depend on which kind it was handed.
 *
 * Identifiers may arrive raw — every consumer re-normalises defensively rather
 * than trusting that a caller remembered to.
 */
export interface MatchSubject {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  vertical: string;
  gtin: string | null;
  ean: string | null;
  mpn: string | null;
  modelNumber: string | null;
  attributes: Record<string, unknown> | null;
  /**
   * Enables the price-sanity guard. Never contributes to the score directly —
   * a bargain is not evidence of identity — it only caps an implausible match.
   */
  price?: number | null;
}

/** A factor that argued *for* the match, with the sentence shown to a reviewer. */
export interface MatchReason {
  key: string;
  label: string;
  detail: string;
  /** Relative weight of the factor this reason came from, 0 for informational. */
  weight: number;
  /** The factor's own 0–100 verdict, or null for informational reasons. */
  score: number | null;
}

export const CONFLICT_SEVERITIES = ['BLOCKING', 'REVIEWABLE'] as const;
export type ConflictSeverity = (typeof CONFLICT_SEVERITIES)[number];

/** A factor that argued *against* the match. Always surfaced, never collapsed. */
export interface MatchConflict {
  key: string;
  label: string;
  detail: string;
  severity: ConflictSeverity;
}

/**
 * The explainable result. Every field here is designed to be persisted verbatim
 * on `ProductMatchCandidate.reasons`, so a decision remains auditable after the
 * algorithm has moved on.
 */
export interface MatchExplanation {
  score: number;
  confidence: MatchConfidence;
  reasons: MatchReason[];
  conflicts: MatchConflict[];
  /** Which stage produced the strongest evidence. */
  method: MatchMethod;
  /** Bumped whenever the normaliser or the weights change; see MATCHER_VERSION. */
  engineVersion: string;
}

export interface MatchFactor {
  key: MatchFactorKey;
  label: string;
  weight: number;
  score: number;
  detail: string;
}

export const MATCH_FACTOR_KEYS = [
  'identifier',
  'brand',
  'model',
  'name',
  'category',
  'variant',
] as const;
export type MatchFactorKey = (typeof MATCH_FACTOR_KEYS)[number];

/** The full result of scoring one pair, including the intermediate factors. */
export interface MatchResult extends MatchExplanation {
  factors: MatchFactor[];
  /** True when the pair cleared `autoAttachMinScore` with no conflicts at all. */
  autoAttachable: boolean;
  /** True when the pair is worth a human's time but must not be merged. */
  reviewable: boolean;
}
