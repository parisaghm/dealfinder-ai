import {
  approveMatchCandidate,
  MatchCandidateAlreadyReviewedError,
  MatchCandidateNotFoundError,
  type Prisma,
  rejectMatchCandidate,
  resetProductMatching,
  resolveCanonicalForProduct,
  type PrismaClient,
} from '@deal-finder/db';
import {
  type MatchCandidate,
  type MatchCandidatesQuery,
  type MatchCandidatesResponse,
  type MatchDecisionResponse,
  type RematchBody,
  type RematchResponse,
} from '@deal-finder/shared';
import { env } from '../env';
import { ApiError } from '../errors';
import { parseExplanation, toMatchSubjectSummary } from '../mappers/canonical.mapper';

/**
 * Thresholds as configured for this deployment.
 *
 * Read here rather than inside the engine, so the pure matcher stays free of
 * environment lookups and remains unit-testable without one.
 */
const thresholds = {
  autoAttachMinScore: env.MATCH_AUTO_ATTACH_MIN_SCORE,
  reviewMinScore: env.MATCH_REVIEW_MIN_SCORE,
};

/**
 * The match-review queue.
 *
 * This is the human half of the matching pipeline. The engine deliberately
 * refuses to merge anything it is not sure about, which only works if the
 * uncertain cases go somewhere a person will see them — so these endpoints are
 * part of the safety mechanism, not an admin convenience bolted on afterwards.
 */

const CANDIDATE_SELECT = {
  id: true,
  score: true,
  confidence: true,
  status: true,
  reasons: true,
  createdAt: true,
  reviewedAt: true,
  reviewedBy: true,
  note: true,
  sourceProduct: {
    select: {
      id: true,
      name: true,
      brand: true,
      category: true,
      imageUrl: true,
      productUrl: true,
      gtin: true,
      ean: true,
      mpn: true,
      modelNumber: true,
      attributes: true,
      currentPrice: true,
      currency: true,
      store: { select: { name: true, slug: true } },
    },
  },
  candidateCanonicalProduct: {
    select: {
      id: true,
      name: true,
      brand: true,
      category: true,
      imageUrl: true,
      gtin: true,
      ean: true,
      mpn: true,
      modelNumber: true,
      specifications: true,
      _count: { select: { offers: true } },
    },
  },
} satisfies Prisma.ProductMatchCandidateSelect;

type CandidateRow = Prisma.ProductMatchCandidateGetPayload<{ select: typeof CANDIDATE_SELECT }>;

function toMatchCandidate(row: CandidateRow): MatchCandidate {
  return {
    id: row.id,
    score: row.score,
    confidence: row.confidence,
    status: row.status,
    explanation: parseExplanation(row.reasons),
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    reviewedBy: row.reviewedBy,
    note: row.note,
    sourceProduct: {
      ...toMatchSubjectSummary(row.sourceProduct),
      storeName: row.sourceProduct.store.name,
      storeSlug: row.sourceProduct.store.slug,
      productUrl: row.sourceProduct.productUrl,
      currentPrice: Number(row.sourceProduct.currentPrice),
      currency: row.sourceProduct.currency,
    },
    candidateCanonicalProduct: {
      ...toMatchSubjectSummary(row.candidateCanonicalProduct),
      offerCount: row.candidateCanonicalProduct._count.offers,
    },
  };
}

export async function listMatchCandidates(
  prisma: PrismaClient,
  query: MatchCandidatesQuery,
): Promise<MatchCandidatesResponse> {
  const where: Prisma.ProductMatchCandidateWhereInput = {
    status: query.status,
    ...(query.confidence ? { confidence: query.confidence } : {}),
    ...(query.minScore != null ? { score: { gte: query.minScore } } : {}),
    ...(query.category ? { sourceProduct: { category: query.category } } : {}),
    ...(query.store ? { sourceProduct: { store: { slug: query.store } } } : {}),
  };

  const skip = (query.page - 1) * query.limit;

  const [total, rows, statusCounts] = await Promise.all([
    prisma.productMatchCandidate.count({ where }),
    prisma.productMatchCandidate.findMany({
      where,
      select: CANDIDATE_SELECT,
      // Highest score first: the most likely matches are the cheapest to judge.
      // `id` keeps the ordering total across pages.
      orderBy: [{ score: 'desc' }, { id: 'asc' }],
      skip,
      take: query.limit,
    }),
    prisma.productMatchCandidate.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const counts = { pending: 0, aiConfirmed: 0, approved: 0, rejected: 0 };
  for (const row of statusCounts) {
    if (row.status === 'PENDING') counts.pending = row._count._all;
    else if (row.status === 'AI_CONFIRMED') counts.aiConfirmed = row._count._all;
    else if (row.status === 'APPROVED') counts.approved = row._count._all;
    else if (row.status === 'REJECTED') counts.rejected = row._count._all;
  }

  const totalPages = Math.ceil(total / query.limit);

  return {
    items: rows.map(toMatchCandidate),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasMore: query.page < totalPages,
    },
    counts,
  };
}

async function loadCandidateOrThrow(prisma: PrismaClient, id: string): Promise<MatchCandidate> {
  const row = await prisma.productMatchCandidate.findUnique({
    where: { id },
    select: CANDIDATE_SELECT,
  });
  if (!row) throw ApiError.notFound('Match candidate');
  return toMatchCandidate(row);
}

/** Translate the db layer's typed failures into HTTP ones. */
function asApiError(error: unknown): never {
  if (error instanceof MatchCandidateNotFoundError) {
    throw ApiError.notFound('Match candidate');
  }
  if (error instanceof MatchCandidateAlreadyReviewedError) {
    throw ApiError.conflict(
      `This candidate has already been reviewed (${error.status.toLowerCase()}).`,
    );
  }
  throw error;
}

export async function approveCandidate(
  prisma: PrismaClient,
  candidateId: string,
  reviewedBy: string,
  note: string | null,
): Promise<MatchDecisionResponse> {
  try {
    const result = await approveMatchCandidate(prisma, candidateId, { reviewedBy, note });
    return {
      candidate: await loadCandidateOrThrow(prisma, candidateId),
      productId: result.productId,
      canonicalProductId: result.canonicalProductId,
    };
  } catch (error) {
    asApiError(error);
  }
}

export async function rejectCandidate(
  prisma: PrismaClient,
  candidateId: string,
  reviewedBy: string,
  note: string | null,
): Promise<MatchDecisionResponse> {
  try {
    const result = await rejectMatchCandidate(prisma, candidateId, { reviewedBy, note });
    return {
      candidate: await loadCandidateOrThrow(prisma, candidateId),
      productId: result.productId,
      canonicalProductId: null,
    };
  } catch (error) {
    asApiError(error);
  }
}

/**
 * Re-run matching for one listing.
 *
 * `force` is a full reset: every candidate row for this product is deleted
 * whatever its status, the canonical link is cleared, and identity is worked
 * out again from nothing. That is deliberately destructive of *decisions* —
 * never of products, offers or history — and it is what makes an end-to-end
 * test of the review flow re-runnable without touching the database directly.
 */
export async function rematchProduct(
  prisma: PrismaClient,
  productId: string,
  body: RematchBody,
): Promise<RematchResponse> {
  const exists = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!exists) throw ApiError.notFound('Product');

  if (body.force) await resetProductMatching(prisma, productId);

  const outcome = await resolveCanonicalForProduct(prisma, productId, {
    force: body.force,
    thresholds,
  });

  return {
    productId: outcome.productId,
    action: outcome.action,
    canonicalProductId: outcome.canonicalProductId,
    evaluated: outcome.evaluated,
    candidateIds: outcome.candidateIds,
  };
}
