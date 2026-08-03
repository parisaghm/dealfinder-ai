import {
  brandKey as toBrandKey,
  brandKeyVariants,
  MATCHER_VERSION,
  normaliseIdentifiers,
  normaliseProductName,
  prepareSubject,
  resolveThresholds,
  scorePrepared,
  type MatchConfidence,
  type MatchMethod,
  type MatchResult,
  type MatchSubject,
  type MatchThresholds,
  type PreparedSubject,
} from '@deal-finder/shared';
import { Prisma } from './generated/prisma/client';
import type { PrismaClient } from './generated/prisma/client';

/**
 * The single writer for cross-store product identity.
 *
 * Lives in `@deal-finder/db` rather than in the API for the same reason
 * `ingestion.ts` does: the seed script and the backfill job import this
 * package, not the API, and a second implementation of "attach or queue for
 * review" is exactly the kind of drift that makes a matching feature
 * untrustworthy. One writer, one set of rules.
 *
 * Two invariants worth stating up front, because breaking either is subtle:
 *
 *  1. **Array-form `$transaction([...])` only.** With `DATABASE_POOL_MAX=1` the
 *     interactive callback form is a foot-gun — one accidental use of the
 *     non-transaction client inside the callback deadlocks on the single
 *     connection, and it deadlocks intermittently. All reads happen before the
 *     transaction; the transaction is one batched round trip.
 *
 *  2. **Nothing below the review threshold is ever written.** "Never silently
 *     merge a low-confidence match" is enforced by not persisting a row at all,
 *     which is stronger than persisting one and filtering it out later.
 */

export type MatchAction =
  | 'ALREADY_ATTACHED'
  | 'ATTACHED'
  | 'CANDIDATES_RECORDED'
  | 'CANONICAL_CREATED'
  | 'UNMATCHED';

export interface MatchOutcome {
  productId: string;
  action: MatchAction;
  canonicalProductId: string | null;
  /** How many canonical products were scored against this listing. */
  evaluated: number;
  /** The winning result, when there was one. */
  best: MatchResult | null;
  /** Ids of the candidate rows written or refreshed by this call. */
  candidateIds: string[];
}

export interface ResolveCanonicalOptions {
  /**
   * Re-evaluate even a manual attachment, and ignore memoised rejections.
   *
   * This is what `POST /api/products/:id/rematch { force: true }` uses, and it
   * is the only way to undo a human decision from code.
   */
  force?: boolean;
  /** Create a canonical product when nothing matches. Default true. */
  createCanonicalWhenUnmatched?: boolean;
  thresholds?: Partial<MatchThresholds>;
  /** Injectable clock, as in `ingestion.ts`, so seeding stays deterministic. */
  now?: Date;
}

const PRODUCT_FOR_MATCHING = {
  id: true,
  name: true,
  brand: true,
  category: true,
  vertical: true,
  gtin: true,
  ean: true,
  mpn: true,
  modelNumber: true,
  attributes: true,
  imageUrl: true,
  currentPrice: true,
  canonicalProductId: true,
  canonicalMatchMethod: true,
} satisfies Prisma.ProductSelect;

const CANONICAL_FOR_MATCHING = {
  id: true,
  name: true,
  brand: true,
  brandKey: true,
  category: true,
  vertical: true,
  gtin: true,
  ean: true,
  mpn: true,
  modelNumber: true,
  specifications: true,
  createdAt: true,
  /**
   * The cheapest current offer, used *only* as a representative price for the
   * sanity guard.
   *
   * Without it that guard is dead on the main path: a product is scored against
   * a canonical record, not against another product, so leaving the canonical
   * priceless means "€549 espresso machine versus €39 milk jug" looks perfectly
   * plausible. One extra join is a cheap price for a working guard.
   */
  offers: {
    select: { currentPrice: true },
    orderBy: { currentPrice: 'asc' },
    take: 1,
  },
  _count: { select: { offers: true } },
} satisfies Prisma.CanonicalProductSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_FOR_MATCHING }>;
type CanonicalRow = Prisma.CanonicalProductGetPayload<{ select: typeof CANONICAL_FOR_MATCHING }>;

function asAttributes(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function productSubject(product: ProductRow): MatchSubject {
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    vertical: product.vertical,
    gtin: product.gtin,
    ean: product.ean,
    mpn: product.mpn,
    modelNumber: product.modelNumber,
    attributes: asAttributes(product.attributes),
    price: Number(product.currentPrice),
  };
}

function canonicalSubject(canonical: CanonicalRow): MatchSubject {
  return {
    id: canonical.id,
    name: canonical.name,
    brand: canonical.brand,
    category: canonical.category,
    vertical: canonical.vertical,
    gtin: canonical.gtin,
    ean: canonical.ean,
    mpn: canonical.mpn,
    modelNumber: canonical.modelNumber,
    attributes: asAttributes(canonical.specifications),
    // The cheapest current offer stands in for "what this product costs".
    // Using the minimum rather than an arbitrary store's price keeps the guard
    // from depending on which store happened to create the record.
    price: canonical.offers[0] ? Number(canonical.offers[0].currentPrice) : null,
  };
}

/**
 * Candidate retrieval, deliberately isolated.
 *
 * Every branch is index-backed and bounded. At the scale this app runs at the
 * naive approach is free; past roughly six figures of canonical products the
 * `normalizedName` prefix branch turns linear and wants `pg_trgm` plus a GIN
 * index. That upgrade is a change to this one function and one migration —
 * which is the whole reason it is one function. See docs/product-matching.md.
 */
async function findCandidateCanonicals(
  prisma: PrismaClient,
  subject: MatchSubject,
  prepared: PreparedSubject,
  limit: number,
): Promise<CanonicalRow[]> {
  const identifiers = normaliseIdentifiers(subject);
  const found = new Map<string, CanonicalRow>();

  const remember = (rows: readonly CanonicalRow[]) => {
    for (const row of rows) found.set(row.id, row);
  };

  // a. An exact identifier resolves to at most one record, by unique index.
  if (identifiers.gtin || identifiers.ean) {
    remember(
      await prisma.canonicalProduct.findMany({
        where: {
          OR: [
            ...(identifiers.gtin ? [{ gtin: identifiers.gtin }] : []),
            ...(identifiers.ean ? [{ ean: identifiers.ean }] : []),
          ],
        },
        select: CANONICAL_FOR_MATCHING,
        take: 2,
      }),
    );
  }

  // Brand lookups go through the alias table. Matching "HP" against
  // "Hewlett Packard" is useless if the two never land in the same candidate
  // set in the first place.
  const brandKeys = brandKeyVariants(identifiers.brandKey);

  // b. Brand plus manufacturer part number, also unique.
  if (brandKeys.length > 0 && identifiers.mpn) {
    remember(
      await prisma.canonicalProduct.findMany({
        where: { brandKey: { in: brandKeys }, mpn: identifiers.mpn },
        select: CANONICAL_FOR_MATCHING,
        take: 2,
      }),
    );
  }

  // c. Same brand, same category — the workhorse branch.
  if (brandKeys.length > 0) {
    remember(
      await prisma.canonicalProduct.findMany({
        where: {
          brandKey: { in: brandKeys },
          vertical: subject.vertical,
          OR: [{ category: subject.category }, { category: prepared.name.inferredCategory ?? subject.category }],
        },
        select: CANONICAL_FOR_MATCHING,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: limit,
      }),
    );
  } else {
    // d. No brand published: fall back to a prefix of the identity tokens.
    const prefix = prepared.name.tokens.slice(0, 3).join(' ');
    if (prefix.length >= 3) {
      remember(
        await prisma.canonicalProduct.findMany({
          where: {
            vertical: subject.vertical,
            category: subject.category,
            normalizedName: { startsWith: prefix },
          },
          select: CANONICAL_FOR_MATCHING,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          take: limit,
        }),
      );
    }
  }

  return [...found.values()];
}

interface ScoredCandidate {
  canonical: CanonicalRow;
  result: MatchResult;
}

/**
 * Rank scored candidates into a *total* order.
 *
 * Totality matters more than it looks: without the `createdAt`/`id` tiebreaks
 * two canonicals scoring identically could swap places between runs, and the
 * seed would stop being idempotent.
 */
function rank(a: ScoredCandidate, b: ScoredCandidate): number {
  return (
    b.result.score - a.result.score ||
    a.canonical.createdAt.getTime() - b.canonical.createdAt.getTime() ||
    a.canonical.id.localeCompare(b.canonical.id)
  );
}

/**
 * Does this listing know enough about itself to anchor a canonical product?
 *
 * Without a bar here, every unmatched listing spawns a canonical record and the
 * table becomes a second copy of `products` — which is worse than useless,
 * because the extra rows are then candidates for other listings to match badly
 * against.
 */
function hasUsableIdentity(subject: MatchSubject, prepared: PreparedSubject): boolean {
  const identifiers = normaliseIdentifiers(subject);
  if (identifiers.gtin ?? identifiers.ean ?? identifiers.mpn) return true;
  if (identifiers.brandKey && identifiers.modelNumber) return true;
  if (identifiers.brandKey && prepared.name.tokens.length >= 3) return true;
  return false;
}

function methodFor(result: MatchResult): MatchMethod {
  return result.method;
}

/**
 * Create the canonical product for a listing, tolerating a concurrent create.
 *
 * Two ingests learning about the same GTIN at the same moment will both try to
 * insert it and one will lose on the unique index. Losing that race is normal,
 * and failing the whole run over it would break an overlapping monitor pass and
 * seed.
 *
 * But losing the race is *not* proof that the two products are the same. A
 * retailer that publishes the wrong EAN — the sample catalogue contains a
 * deliberate example — produces exactly the same collision, and blindly
 * attaching to the winner would merge a €549 espresso machine with a €39 milk
 * jug through the back door, after stage 3 had already refused to. So the
 * recovery path re-scores, and only attaches on evidence.
 */
type CreateCanonicalOutcome =
  | { kind: 'created'; canonical: CanonicalRow }
  | { kind: 'identifier-taken'; canonical: CanonicalRow };

async function createCanonicalOrAttachExisting(
  prisma: PrismaClient,
  product: ProductRow,
  prepared: PreparedSubject,
  now: Date,
  options: { withoutIdentifiers?: boolean } = {},
): Promise<CreateCanonicalOutcome> {
  const identifiers = normaliseIdentifiers(productSubject(product));
  const bare = options.withoutIdentifiers ?? false;
  const data: Prisma.CanonicalProductCreateInput = {
    name: product.name,
    brand: product.brand,
    brandKey: identifiers.brandKey,
    modelNumber: bare ? null : (identifiers.modelNumber ?? prepared.modelCandidates[0] ?? null),
    category: product.category,
    vertical: product.vertical,
    gtin: bare ? null : identifiers.gtin,
    ean: bare ? null : identifiers.ean,
    mpn: bare ? null : identifiers.mpn,
    normalizedName: prepared.name.normalized,
    imageUrl: product.imageUrl,
    specifications: {
      ...(asAttributes(product.attributes) ?? {}),
      __matcherVersion: MATCHER_VERSION,
      ...(bare
        ? {
            __identifierDistrusted:
              'A different product already claims this listing’s published identifier, so it was not recorded here.',
          }
        : {}),
    } as Prisma.InputJsonValue,
    createdAt: now,
    updatedAt: now,
  };

  const claimedBy = bare ? null : await findByIdentifiers(prisma, identifiers);
  if (claimedBy) return { kind: 'identifier-taken', canonical: claimedBy };

  try {
    const canonical = await prisma.canonicalProduct.create({
      data,
      select: CANONICAL_FOR_MATCHING,
    });
    return { kind: 'created', canonical };
  } catch (error) {
    // The pre-check above handles the ordinary case without provoking an error
    // the Prisma client would log. Reaching here means we genuinely lost a race
    // with a concurrent writer between the check and the insert.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    const existing = await findByIdentifiers(prisma, identifiers);
    if (!existing) throw error;
    return { kind: 'identifier-taken', canonical: existing };
  }
}

/** Look up the canonical product that already owns any of these identifiers. */
async function findByIdentifiers(
  prisma: PrismaClient,
  identifiers: ReturnType<typeof normaliseIdentifiers>,
): Promise<CanonicalRow | null> {
  const clauses: Prisma.CanonicalProductWhereInput[] = [
    ...(identifiers.gtin ? [{ gtin: identifiers.gtin }] : []),
    ...(identifiers.ean ? [{ ean: identifiers.ean }] : []),
    ...(identifiers.brandKey && identifiers.mpn
      ? [{ brandKey: identifiers.brandKey, mpn: identifiers.mpn }]
      : []),
  ];
  if (clauses.length === 0) return null;

  return prisma.canonicalProduct.findFirst({
    where: { OR: clauses },
    select: CANONICAL_FOR_MATCHING,
  });
}

/**
 * Provenance for a canonical product this listing just created.
 *
 * Recorded so the comparison page can say *why* a group exists, and so a later
 * `--force` pass can tell an identifier-anchored group (trustworthy) from a
 * name-anchored one (worth revisiting when the normaliser changes).
 */
function creationMethod(canonical: CanonicalRow): MatchMethod {
  if (canonical.gtin ?? canonical.ean ?? canonical.mpn) return 'IDENTIFIER';
  if (canonical.modelNumber) return 'MODEL';
  return 'NAME';
}

/**
 * Resolve one listing's canonical product.
 *
 * Returns what it did rather than throwing on "no match": an unmatched listing
 * is a normal, permanent state, not an error.
 */
export async function resolveCanonicalForProduct(
  prisma: PrismaClient,
  productId: string,
  options: ResolveCanonicalOptions = {},
): Promise<MatchOutcome> {
  const now = options.now ?? new Date();
  const thresholds = resolveThresholds(options.thresholds);
  const force = options.force ?? false;
  const createWhenUnmatched = options.createCanonicalWhenUnmatched ?? true;

  let product = await prisma.product.findUnique({
    where: { id: productId },
    select: PRODUCT_FOR_MATCHING,
  });
  if (!product) {
    throw new Error(`Cannot match product ${productId}: it does not exist.`);
  }

  // A forced pass detaches first, then decides from scratch.
  //
  // Without this the re-evaluation is one-way: it can move a listing into a
  // group but never out of one, so a match the current engine would refuse
  // survives indefinitely just because an older version made it. Detaching up
  // front is what makes `--force` mean "recompute", not "top up".
  if (force && product.canonicalProductId) {
    await prisma.product.update({
      where: { id: productId },
      data: {
        canonicalProductId: null,
        canonicalMatchMethod: null,
        canonicalMatchScore: null,
        canonicalMatchedAt: null,
      },
    });
    product = { ...product, canonicalProductId: null, canonicalMatchMethod: null };
  }

  const subject = productSubject(product);
  const prepared = prepareSubject(subject);

  const unmatched = (action: MatchAction, best: MatchResult | null = null): MatchOutcome => ({
    productId,
    action,
    canonicalProductId: product.canonicalProductId,
    evaluated: 0,
    best,
    candidateIds: [],
  });

  // ── Stickiness ────────────────────────────────────────────────────────────
  // A human decision outranks the algorithm until someone explicitly forces a
  // re-evaluation. This short-circuit is also the idempotency mechanism that
  // lets `db:seed` and `db:match` run repeatedly without duplicating anything.
  if (product.canonicalProductId && !force) {
    if (product.canonicalMatchMethod === 'MANUAL') {
      return unmatched('ALREADY_ATTACHED');
    }

    const current = await prisma.canonicalProduct.findUnique({
      where: { id: product.canonicalProductId },
      select: CANONICAL_FOR_MATCHING,
    });

    if (current) {
      // A canonical whose only offer is this product describes nothing but this
      // product. There is no second opinion to seek, and re-deriving one is how
      // an ordinary re-seed ends up queueing every listing against its own group.
      if (current._count.offers <= 1) {
        return { ...unmatched('ALREADY_ATTACHED'), evaluated: 1 };
      }

      // Otherwise re-score — but against the bar for *staying*, not the bar for
      // joining. "Would I attach this from scratch today?" is the wrong
      // question for an existing member: answering it strictly makes grouping
      // oscillate between runs, while `reviewable` still catches a grouping the
      // engine now considers wrong. A forced pass applies the strict bar.
      const result = scorePrepared(prepared, prepareSubject(canonicalSubject(current)), {
        thresholds: options.thresholds,
      });
      if (result.reviewable) {
        return { ...unmatched('ALREADY_ATTACHED', result), evaluated: 1 };
      }
    }
  }

  // A forced re-evaluation discards the machine's previous opinions, so the
  // queue reflects the current engine rather than accumulating rows from every
  // version that ever ran. Human decisions (APPROVED / REJECTED) are kept —
  // discarding those is what `resetProductMatching` is for, and it is a
  // separate, explicit call.
  if (force) {
    await prisma.productMatchCandidate.deleteMany({
      where: { sourceProductId: productId, status: { in: ['PENDING', 'SUPERSEDED'] } },
    });
  }

  // ── Retrieval and scoring ─────────────────────────────────────────────────
  const candidates = await findCandidateCanonicals(
    prisma,
    subject,
    prepared,
    thresholds.candidateFetchLimit,
  );

  const rejected = force
    ? new Set<string>()
    : new Set(
        (
          await prisma.productMatchCandidate.findMany({
            where: { sourceProductId: productId, status: 'REJECTED' },
            select: { candidateCanonicalProductId: true },
          })
        ).map((row) => row.candidateCanonicalProductId),
      );

  const scored = candidates
    .filter((canonical) => !rejected.has(canonical.id))
    .map((canonical) => ({
      canonical,
      result: scorePrepared(prepared, prepareSubject(canonicalSubject(canonical)), {
        thresholds: options.thresholds,
      }),
    }))
    .sort(rank);

  const best = scored[0];

  // ── Decide ────────────────────────────────────────────────────────────────
  if (best?.result.autoAttachable) {
    await prisma.$transaction([
      prisma.product.update({
        where: { id: productId },
        data: {
          canonicalProductId: best.canonical.id,
          canonicalMatchMethod: methodFor(best.result),
          canonicalMatchScore: best.result.score,
          canonicalMatchedAt: now,
        },
      }),
      // Anything else this product was queued against is now moot. Marking it
      // SUPERSEDED rather than deleting keeps the audit trail intact.
      prisma.productMatchCandidate.updateMany({
        where: {
          sourceProductId: productId,
          status: 'PENDING',
          candidateCanonicalProductId: { not: best.canonical.id },
        },
        data: { status: 'SUPERSEDED', reviewedAt: now },
      }),
    ]);

    // Teach the group anything this listing knows that it did not.
    await enrichCanonicalIdentifiers(prisma, best.canonical, product);

    return {
      productId,
      action: 'ATTACHED',
      canonicalProductId: best.canonical.id,
      evaluated: scored.length,
      best: best.result,
      candidateIds: [],
    };
  }

  const reviewable = scored
    .filter((entry) => entry.result.reviewable)
    .slice(0, thresholds.maxCandidatesPerProduct);

  if (reviewable.length > 0) {
    const written = await prisma.$transaction(
      reviewable.map((entry) =>
        prisma.productMatchCandidate.upsert({
          where: {
            sourceProductId_candidateCanonicalProductId: {
              sourceProductId: productId,
              candidateCanonicalProductId: entry.canonical.id,
            },
          },
          create: {
            sourceProductId: productId,
            candidateCanonicalProductId: entry.canonical.id,
            score: entry.result.score,
            confidence: entry.result.confidence as MatchConfidence,
            reasons: toReasonsJson(entry.result),
            status: 'PENDING',
            createdAt: now,
            updatedAt: now,
          },
          // A re-run refreshes the evidence but never resurrects a decision:
          // `status` is deliberately absent from the update.
          update: {
            score: entry.result.score,
            confidence: entry.result.confidence as MatchConfidence,
            reasons: toReasonsJson(entry.result),
            updatedAt: now,
          },
          select: { id: true },
        }),
      ),
    );

    return {
      productId,
      action: 'CANDIDATES_RECORDED',
      canonicalProductId: product.canonicalProductId,
      evaluated: scored.length,
      best: best?.result ?? null,
      candidateIds: written.map((row) => row.id),
    };
  }

  if (createWhenUnmatched && !product.canonicalProductId && hasUsableIdentity(subject, prepared)) {
    const outcome = await createCanonicalOrAttachExisting(prisma, product, prepared, now);

    if (outcome.kind === 'identifier-taken') {
      // Another canonical already owns this identifier. Either we lost a
      // creation race with a genuinely identical product, or a store published
      // the wrong code. Re-score to find out, and attach only on evidence —
      // never because the database happened to say "taken".
      const recheck = scorePrepared(
        prepared,
        prepareSubject(canonicalSubject(outcome.canonical)),
        { thresholds: options.thresholds },
      );

      if (!recheck.autoAttachable) {
        // The identifier is claimed by a product this listing demonstrably is
        // not. It still deserves its own canonical record — a shopper should be
        // able to find the espresso machine — so create one with the disputed
        // identifier omitted. Dropping the code is the honest outcome: we have
        // just established that it points somewhere else.
        const fallback = await createCanonicalOrAttachExisting(prisma, product, prepared, now, {
          withoutIdentifiers: true,
        });

        await prisma.product.update({
          where: { id: productId },
          data: {
            canonicalProductId: fallback.canonical.id,
            canonicalMatchMethod: 'NAME',
            canonicalMatchScore: 100,
            canonicalMatchedAt: now,
          },
        });

        return {
          productId,
          action: 'CANONICAL_CREATED',
          canonicalProductId: fallback.canonical.id,
          evaluated: scored.length + 1,
          best: recheck,
          candidateIds: [],
        };
      }

      await prisma.product.update({
        where: { id: productId },
        data: {
          canonicalProductId: outcome.canonical.id,
          canonicalMatchMethod: recheck.method,
          canonicalMatchScore: recheck.score,
          canonicalMatchedAt: now,
        },
      });

      return {
        productId,
        action: 'ATTACHED',
        canonicalProductId: outcome.canonical.id,
        evaluated: scored.length + 1,
        best: recheck,
        candidateIds: [],
      };
    }

    const canonical = outcome.canonical;
    await prisma.product.update({
      where: { id: productId },
      data: {
        canonicalProductId: canonical.id,
        canonicalMatchMethod: creationMethod(canonical),
        canonicalMatchScore: 100,
        canonicalMatchedAt: now,
      },
    });

    return {
      productId,
      action: 'CANONICAL_CREATED',
      canonicalProductId: canonical.id,
      evaluated: scored.length,
      best: best?.result ?? null,
      candidateIds: [],
    };
  }

  return {
    productId,
    action: 'UNMATCHED',
    canonicalProductId: product.canonicalProductId,
    evaluated: scored.length,
    best: best?.result ?? null,
    candidateIds: [],
  };
}

/** The persisted explanation, shaped so the API can parse it back with Zod. */
function toReasonsJson(result: MatchResult): Prisma.InputJsonValue {
  return {
    score: result.score,
    confidence: result.confidence,
    method: result.method,
    engineVersion: result.engineVersion,
    reasons: result.reasons,
    conflicts: result.conflicts,
  } as unknown as Prisma.InputJsonValue;
}

// ── Review decisions ────────────────────────────────────────────────────────

export interface ReviewDecisionOptions {
  reviewedBy: string;
  note?: string | null;
  now?: Date;
}

export interface ReviewDecisionResult {
  candidateId: string;
  productId: string;
  canonicalProductId: string;
  status: 'APPROVED' | 'REJECTED';
}

/**
 * Approve a candidate: attach the listing, and mark the decision as human.
 *
 * `MANUAL` is sticky — a later matching run will not revisit it — which is the
 * whole point of asking a person.
 */
export async function approveMatchCandidate(
  prisma: PrismaClient,
  candidateId: string,
  options: ReviewDecisionOptions,
): Promise<ReviewDecisionResult> {
  const now = options.now ?? new Date();

  const candidate = await prisma.productMatchCandidate.findUnique({
    where: { id: candidateId },
    select: { id: true, sourceProductId: true, candidateCanonicalProductId: true, status: true, score: true },
  });
  if (!candidate) throw new MatchCandidateNotFoundError(candidateId);
  if (candidate.status === 'APPROVED') throw new MatchCandidateAlreadyReviewedError(candidateId, candidate.status);
  if (candidate.status === 'REJECTED') throw new MatchCandidateAlreadyReviewedError(candidateId, candidate.status);

  await prisma.$transaction([
    prisma.productMatchCandidate.update({
      where: { id: candidateId },
      data: {
        status: 'APPROVED',
        reviewedAt: now,
        reviewedBy: options.reviewedBy,
        note: options.note ?? null,
      },
    }),
    prisma.product.update({
      where: { id: candidate.sourceProductId },
      data: {
        canonicalProductId: candidate.candidateCanonicalProductId,
        canonicalMatchMethod: 'MANUAL',
        canonicalMatchScore: candidate.score,
        canonicalMatchedAt: now,
      },
    }),
    prisma.productMatchCandidate.updateMany({
      where: {
        sourceProductId: candidate.sourceProductId,
        status: 'PENDING',
        id: { not: candidateId },
      },
      data: { status: 'SUPERSEDED', reviewedAt: now },
    }),
  ]);

  return {
    candidateId,
    productId: candidate.sourceProductId,
    canonicalProductId: candidate.candidateCanonicalProductId,
    status: 'APPROVED',
  };
}

/**
 * Reject a candidate.
 *
 * The row stays, flipped to `REJECTED`, because it is the memory that stops the
 * next matching run proposing the same bad pair again. Deleting it would make
 * every rejection temporary.
 */
export async function rejectMatchCandidate(
  prisma: PrismaClient,
  candidateId: string,
  options: ReviewDecisionOptions,
): Promise<ReviewDecisionResult> {
  const now = options.now ?? new Date();

  const candidate = await prisma.productMatchCandidate.findUnique({
    where: { id: candidateId },
    select: { id: true, sourceProductId: true, candidateCanonicalProductId: true, status: true },
  });
  if (!candidate) throw new MatchCandidateNotFoundError(candidateId);
  if (candidate.status === 'APPROVED' || candidate.status === 'REJECTED') {
    throw new MatchCandidateAlreadyReviewedError(candidateId, candidate.status);
  }

  await prisma.productMatchCandidate.update({
    where: { id: candidateId },
    data: {
      status: 'REJECTED',
      reviewedAt: now,
      reviewedBy: options.reviewedBy,
      note: options.note ?? null,
    },
  });

  return {
    candidateId,
    productId: candidate.sourceProductId,
    canonicalProductId: candidate.candidateCanonicalProductId,
    status: 'REJECTED',
  };
}

export class MatchCandidateNotFoundError extends Error {
  constructor(readonly candidateId: string) {
    super(`Match candidate ${candidateId} does not exist.`);
    this.name = 'MatchCandidateNotFoundError';
  }
}

export class MatchCandidateAlreadyReviewedError extends Error {
  constructor(
    readonly candidateId: string,
    readonly status: string,
  ) {
    super(`Match candidate ${candidateId} has already been reviewed (${status}).`);
    this.name = 'MatchCandidateAlreadyReviewedError';
  }
}

/**
 * Discard everything this product knows about its identity and work it out
 * again from scratch.
 *
 * Used by `POST /api/products/:id/rematch { force: true }`. Unlike a plain
 * rematch it clears approved *and* rejected candidate rows and detaches an
 * existing canonical link, so the product returns to the state it was in before
 * anyone — human or algorithm — had an opinion about it. That is what makes the
 * end-to-end review test re-runnable without a database reset.
 */
export async function resetProductMatching(
  prisma: PrismaClient,
  productId: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.productMatchCandidate.deleteMany({ where: { sourceProductId: productId } }),
    prisma.product.update({
      where: { id: productId },
      data: {
        canonicalProductId: null,
        canonicalMatchMethod: null,
        canonicalMatchScore: null,
        canonicalMatchedAt: null,
      },
    }),
  ]);
}

/**
 * Delete canonical products that no longer have any offers.
 *
 * A detach (via rematch or a rejected approval) can leave a canonical record
 * with nothing pointing at it, and an empty group is not something any endpoint
 * should return. Safe to call at any time; it only ever removes rows that
 * describe nothing.
 */
export async function pruneOrphanedCanonicalProducts(prisma: PrismaClient): Promise<number> {
  const result = await prisma.canonicalProduct.deleteMany({
    where: { offers: { none: {} }, matchCandidates: { none: {} } },
  });
  return result.count;
}

/**
 * Fill in identifiers the canonical record does not have yet, from a listing
 * that does.
 *
 * The first store to list a product often publishes no EAN and the second one
 * does. Without this the canonical record is permanently as ignorant as
 * whichever listing happened to create it, and a third store publishing that
 * EAN would fail to match on the strongest signal available.
 *
 * Best-effort by design: a unique-constraint violation here means another
 * canonical already owns the code, which is information we act on elsewhere and
 * must not turn into a failed ingest.
 */
async function enrichCanonicalIdentifiers(
  prisma: PrismaClient,
  canonical: CanonicalRow,
  product: ProductRow,
): Promise<void> {
  const identifiers = normaliseIdentifiers(productSubject(product));

  const patch: Prisma.CanonicalProductUpdateInput = {};
  if (!canonical.gtin && identifiers.gtin) patch.gtin = identifiers.gtin;
  if (!canonical.ean && identifiers.ean) patch.ean = identifiers.ean;
  if (!canonical.mpn && identifiers.mpn) patch.mpn = identifiers.mpn;
  if (!canonical.modelNumber && identifiers.modelNumber) patch.modelNumber = identifiers.modelNumber;

  if (Object.keys(patch).length === 0) return;

  // Check before writing rather than catching the violation. Provoking a unique
  // error would work, but the Prisma client logs every one at `error` level,
  // and a routine "another group already owns this code" would then look like a
  // failure in the logs of an otherwise healthy ingest.
  if (patch.gtin ?? patch.ean ?? patch.mpn) {
    const owner = await findByIdentifiers(prisma, {
      ...identifiers,
      gtin: (patch.gtin as string | undefined) ?? null,
      ean: (patch.ean as string | undefined) ?? null,
      mpn: (patch.mpn as string | undefined) ?? null,
    });
    if (owner && owner.id !== canonical.id) return;
  }

  try {
    await prisma.canonicalProduct.update({ where: { id: canonical.id }, data: patch });
  } catch (error) {
    // Still possible if a concurrent writer claimed the code in between.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
  }
}

/**
 * Discard every machine-made matching decision so a pass can recompute from
 * scratch, while preserving everything a human decided.
 *
 * Kept: `APPROVED` and `REJECTED` candidate rows, the canonical products they
 * reference, and any offer attached by a `MANUAL` decision. Discarded:
 * machine attachments, `PENDING`/`SUPERSEDED` candidates, and canonical records
 * left describing nothing.
 *
 * This is what makes `npm run db:match -- --force` mean "recompute" rather than
 * "top up". Without it a canonical created by an older engine version keeps its
 * stale identity fields forever, and every later listing is matched against
 * that stale record instead of against current data.
 */
export async function resetMachineMatching(prisma: PrismaClient): Promise<{
  detached: number;
  candidatesRemoved: number;
  canonicalsPruned: number;
}> {
  const [detached, candidatesRemoved] = await prisma.$transaction([
    prisma.product.updateMany({
      where: { canonicalProductId: { not: null }, canonicalMatchMethod: { not: 'MANUAL' } },
      data: {
        canonicalProductId: null,
        canonicalMatchMethod: null,
        canonicalMatchScore: null,
        canonicalMatchedAt: null,
      },
    }),
    prisma.productMatchCandidate.deleteMany({
      where: { status: { in: ['PENDING', 'SUPERSEDED'] } },
    }),
  ]);

  const canonicalsPruned = await pruneOrphanedCanonicalProducts(prisma);

  return {
    detached: detached.count,
    candidatesRemoved: candidatesRemoved.count,
    canonicalsPruned,
  };
}

/** Normalised lookup key helpers, re-exported so callers need one import. */
export { toBrandKey as canonicalBrandKey, normaliseProductName as canonicalNormalisedName };
