import { z } from 'zod';
import {
  CONFLICT_SEVERITIES,
  MATCH_CANDIDATE_STATUSES,
  MATCH_CONFIDENCES,
  MATCH_METHODS,
} from '../matching/types';
import { idSchema, isoDateTimeSchema, paginationMetaSchema } from './common';

/**
 * The match-review contract.
 *
 * The engine's own types live in `matching/types.ts` and are plain TypeScript,
 * because the scorer must stay usable without Zod in the hot path. These
 * schemas are the *wire* shapes: the server validates requests with them, the
 * browser re-parses responses with them, and — importantly — the API parses the
 * `reasons` JSON column back with them, since a row written by an older engine
 * version is exactly the kind of thing that should fail loudly at a boundary
 * rather than crash a component.
 */

export const matchMethodSchema = z.enum(MATCH_METHODS);
export const matchConfidenceSchema = z.enum(MATCH_CONFIDENCES);
export const matchCandidateStatusSchema = z.enum(MATCH_CANDIDATE_STATUSES);
export const conflictSeveritySchema = z.enum(CONFLICT_SEVERITIES);

export const matchReasonSchema = z.object({
  key: z.string().max(64),
  label: z.string().max(120),
  detail: z.string().max(500),
  weight: z.number().finite().nonnegative(),
  score: z.number().finite().min(0).max(100).nullable(),
});
export type MatchReasonDto = z.infer<typeof matchReasonSchema>;

export const matchConflictSchema = z.object({
  key: z.string().max(64),
  label: z.string().max(120),
  detail: z.string().max(500),
  severity: conflictSeveritySchema,
});
export type MatchConflictDto = z.infer<typeof matchConflictSchema>;

/** Exactly what is persisted on `ProductMatchCandidate.reasons`. */
export const matchExplanationSchema = z.object({
  score: z.number().int().min(0).max(100),
  confidence: matchConfidenceSchema,
  method: matchMethodSchema,
  engineVersion: z.string().max(32),
  reasons: z.array(matchReasonSchema).max(20),
  conflicts: z.array(matchConflictSchema).max(20),
});
export type MatchExplanationDto = z.infer<typeof matchExplanationSchema>;

/** Enough of a listing or a canonical product to review a proposed match. */
export const matchSubjectSummarySchema = z.object({
  id: idSchema,
  name: z.string().max(300),
  brand: z.string().max(120).nullable(),
  category: z.string().max(64),
  imageUrl: z.string().max(2048).nullable(),
  identifiers: z.object({
    gtin: z.string().max(20).nullable(),
    ean: z.string().max(20).nullable(),
    mpn: z.string().max(120).nullable(),
    modelNumber: z.string().max(120).nullable(),
  }),
  /** Key specifications, flattened to strings so the two sides line up visually. */
  specifications: z.record(z.string(), z.string()),
});
export type MatchSubjectSummary = z.infer<typeof matchSubjectSummarySchema>;

export const matchCandidateSchema = z.object({
  id: idSchema,
  score: z.number().int().min(0).max(100),
  confidence: matchConfidenceSchema,
  status: matchCandidateStatusSchema,
  explanation: matchExplanationSchema,
  createdAt: isoDateTimeSchema,
  reviewedAt: isoDateTimeSchema.nullable(),
  reviewedBy: z.string().max(120).nullable(),
  note: z.string().max(500).nullable(),

  /** The store listing being placed. */
  sourceProduct: matchSubjectSummarySchema.extend({
    storeName: z.string().max(120),
    storeSlug: z.string().max(64),
    productUrl: z.string().max(2048),
    currentPrice: z.number().finite().nonnegative(),
    currency: z.string().max(8),
  }),
  /** The group it is proposed for. */
  candidateCanonicalProduct: matchSubjectSummarySchema.extend({
    offerCount: z.number().int().nonnegative(),
  }),
});
export type MatchCandidate = z.infer<typeof matchCandidateSchema>;

export const matchCandidatesQuerySchema = z.object({
  status: matchCandidateStatusSchema.default('PENDING'),
  confidence: matchConfidenceSchema.optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  category: z.string().trim().max(64).optional(),
  store: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().positive().max(1000).default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type MatchCandidatesQuery = z.infer<typeof matchCandidatesQuerySchema>;

export const matchCandidatesResponseSchema = z.object({
  items: z.array(matchCandidateSchema),
  pagination: paginationMetaSchema,
  /** Queue sizes, so the reviewer can see what is left without paging. */
  counts: z.object({
    pending: z.number().int().nonnegative(),
    aiConfirmed: z.number().int().nonnegative(),
    approved: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }),
});
export type MatchCandidatesResponse = z.infer<typeof matchCandidatesResponseSchema>;

export const matchDecisionBodySchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type MatchDecisionBody = z.infer<typeof matchDecisionBodySchema>;

export const rematchBodySchema = z.object({
  /**
   * Discard every prior decision for this listing — machine *and* human — and
   * work its identity out again from scratch.
   */
  force: z.coerce.boolean().default(false),
});
export type RematchBody = z.infer<typeof rematchBodySchema>;

export const MATCH_ACTIONS = [
  'ALREADY_ATTACHED',
  'ATTACHED',
  'CANDIDATES_RECORDED',
  'CANONICAL_CREATED',
  'UNMATCHED',
] as const;
export const matchActionSchema = z.enum(MATCH_ACTIONS);
export type MatchActionDto = z.infer<typeof matchActionSchema>;

export const rematchResponseSchema = z.object({
  productId: idSchema,
  action: matchActionSchema,
  canonicalProductId: idSchema.nullable(),
  /** How many canonical products were scored against this listing. */
  evaluated: z.number().int().nonnegative(),
  candidateIds: z.array(idSchema),
});
export type RematchResponse = z.infer<typeof rematchResponseSchema>;

export const matchDecisionResponseSchema = z.object({
  candidate: matchCandidateSchema,
  productId: idSchema,
  canonicalProductId: idSchema.nullable(),
});
export type MatchDecisionResponse = z.infer<typeof matchDecisionResponseSchema>;
