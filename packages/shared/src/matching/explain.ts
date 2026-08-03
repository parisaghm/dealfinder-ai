import type { MatchConflict, MatchFactor, MatchReason } from './types';

/**
 * Explanation generation.
 *
 * The product promise is that a match is *auditable*: a reviewer must be able
 * to read why two listings were grouped and disagree with it. That rules out
 * exposing a bare score, and it rules out reasons that restate the factor name
 * ("Brand: 100") instead of the evidence ("Both listings are branded sony").
 *
 * Two rules enforced here and covered by tests:
 *  - every reason and every conflict carries a complete sentence,
 *  - conflicts are never summarised away, however strong the reasons are.
 */

/** Factors scoring at or above this are stated as supporting reasons. */
const REASON_MIN_SCORE = 50;

export interface Explanation {
  reasons: MatchReason[];
  conflicts: MatchConflict[];
}

export function buildExplanation(
  factors: readonly MatchFactor[],
  conflicts: readonly MatchConflict[],
): Explanation {
  const reasons: MatchReason[] = factors
    .filter((factor) => factor.score >= REASON_MIN_SCORE)
    .map((factor) => ({
      key: factor.key,
      label: factor.label,
      detail: factor.detail,
      weight: factor.weight,
      score: factor.score,
    }))
    // Ordered by actual contribution, so the strongest evidence reads first.
    .sort((a, b) => b.weight * (b.score ?? 0) - a.weight * (a.score ?? 0));

  // Factors that scored below the reason threshold are not silently dropped:
  // "the brands disagree" is information a reviewer needs, and it is not the
  // same thing as a variant conflict.
  //
  // `name` is excluded, because it is the one continuous factor. Brand, model,
  // category and identifier are effectively binary — a low score means they
  // *contradict* each other. A name similarity of 46 % contradicts nothing; it
  // is simply weak evidence, and it is already fully priced into the weighted
  // mean and into the minimum-similarity floor in `score.ts`. Treating it as a
  // conflict would block auto-attach for every identifier match between two
  // stores that describe a product differently, which is the exact case
  // identifiers exist to handle.
  const weakFactors = factors.filter(
    (factor) => factor.score < REASON_MIN_SCORE && factor.key !== 'name',
  );
  const derivedConflicts: MatchConflict[] = weakFactors
    .filter((factor) => !conflicts.some((conflict) => conflict.key.startsWith(factor.key)))
    .map((factor) => ({
      key: `factor:${factor.key}`,
      label: factor.label,
      detail: factor.detail,
      severity: 'REVIEWABLE' as const,
    }));

  return {
    reasons,
    conflicts: dedupeConflicts([...conflicts, ...derivedConflicts]),
  };
}

function dedupeConflicts(conflicts: readonly MatchConflict[]): MatchConflict[] {
  const byKey = new Map<string, MatchConflict>();
  for (const conflict of conflicts) {
    const existing = byKey.get(conflict.key);
    // A BLOCKING verdict always wins over a REVIEWABLE one for the same key.
    if (!existing || (existing.severity === 'REVIEWABLE' && conflict.severity === 'BLOCKING')) {
      byKey.set(conflict.key, conflict);
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'BLOCKING' ? -1 : 1;
    return a.key.localeCompare(b.key);
  });
}

/** One-line summary for a card or a list row. */
export function summariseMatch(
  score: number,
  confidence: string,
  reasons: readonly MatchReason[],
  conflicts: readonly MatchConflict[],
): string {
  if (conflicts.length > 0) {
    const first = conflicts[0];
    return `${confidence.toLowerCase()} confidence (${score}/100) — ${first?.detail ?? 'a conflicting attribute was found.'}`;
  }
  const first = reasons[0];
  return first
    ? `${confidence.toLowerCase()} confidence (${score}/100) — ${first.detail}`
    : `${confidence.toLowerCase()} confidence (${score}/100).`;
}
