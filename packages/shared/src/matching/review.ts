import type { MatchConfidence, MatchResult, MatchSubject } from './types';

/**
 * Stage 4 — the optional AI-assisted reviewer.
 *
 * This file defines a shape and a no-op. There is deliberately no
 * implementation, no model client, no API key and no network dependency
 * anywhere in the matching path: **the application must work completely without
 * one**, and the deterministic engine must remain the thing that decides.
 *
 * Where an LLM can genuinely help is the narrow band the deterministic scorer
 * is honest about being unsure of — two listings that look alike, publish no
 * identifiers, and differ in ways a regex cannot interpret. It is offered
 * *only* those, and only ever as an opinion.
 *
 * The authority rules are enforced by the orchestrator (`packages/db/src/matching.ts`),
 * not here, so a reviewer implementation cannot widen its own remit:
 *
 *  - `REJECT`  — always honoured. A veto is safe in a way an endorsement is not.
 *  - `CONFIRM` — marks the candidate `AI_CONFIRMED` and surfaces it pre-endorsed
 *                in the review queue. It still needs the human approve call
 *                unless `MATCH_AI_AUTO_APPROVE` is explicitly turned on.
 *  - `ABSTAIN` — leaves the candidate exactly as the deterministic pass left it.
 *
 * And three things a verdict can never do: override an exact identifier
 * conflict, override a deterministic variant conflict, or raise a pair that
 * scored below the review threshold.
 */

export interface MatchReviewRequest {
  source: MatchSubject;
  candidate: MatchSubject;
  /** The deterministic verdict. A reviewer must be given the reasoning it is second-guessing. */
  deterministic: MatchResult;
}

export const MATCH_REVIEW_DECISIONS = ['CONFIRM', 'REJECT', 'ABSTAIN'] as const;
export type MatchReviewDecision = (typeof MATCH_REVIEW_DECISIONS)[number];

export interface MatchReviewVerdict {
  decision: MatchReviewDecision;
  confidence: MatchConfidence;
  /** Shown verbatim to the human reviewer. Never used programmatically. */
  rationale: string;
}

export interface MatchReviewer {
  readonly id: string;
  review(request: MatchReviewRequest, signal?: AbortSignal): Promise<MatchReviewVerdict>;
}

/**
 * The default reviewer, and the one that ships enabled.
 *
 * Abstaining is not a placeholder for a missing feature — it is the correct
 * behaviour when no reviewer is configured, and it keeps the "works with no API
 * key" guarantee true by construction rather than by a branch somewhere.
 */
export const noopMatchReviewer: MatchReviewer = {
  id: 'noop',
  review(): Promise<MatchReviewVerdict> {
    return Promise.resolve({
      decision: 'ABSTAIN',
      confidence: 'LOW',
      rationale: 'AI-assisted review is disabled; the deterministic verdict stands.',
    });
  },
};

/**
 * Whether a candidate is eligible for AI review at all.
 *
 * Only genuinely ambiguous medium-confidence pairs qualify. A HIGH pair does
 * not need an opinion, and a pair with a blocking conflict must not be given
 * the chance to acquire one.
 */
export function isEligibleForAiReview(result: MatchResult): boolean {
  return (
    result.confidence === 'MEDIUM' &&
    !result.conflicts.some((conflict) => conflict.severity === 'BLOCKING')
  );
}
