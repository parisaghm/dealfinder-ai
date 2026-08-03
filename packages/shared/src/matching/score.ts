import {
  BRAND_ALIASES,
  BRAND_ALIAS_SCORE,
  CATEGORY_NEIGHBOURS,
  CATEGORY_NEIGHBOUR_SCORE,
  MATCHER_VERSION,
  MATCH_WEIGHTS,
  MODEL_CONTAINMENT_MAX_LENGTH_DELTA,
  MODEL_CONTAINMENT_SCORE,
  NON_MATERIAL_MISMATCH_PENALTY,
  resolveThresholds,
  type MatchThresholds,
} from './config';
import { buildExplanation } from './explain';
import {
  hasIdentifierConflict,
  matchIdentifiers,
  normaliseIdentifiers,
  normaliseModelNumber,
  type NormalisedIdentifiers,
} from './identifiers';
import { normaliseProductName, type NormalisedName } from './normalize';
import { nameSimilarity, sharedTokens } from './similarity';
import type {
  MatchConfidence,
  MatchConflict,
  MatchFactor,
  MatchMethod,
  MatchResult,
  MatchSubject,
} from './types';
import {
  compareVariants,
  extractVariantAttributes,
  hasBlockingConflict,
  hasReviewableConflict,
  type VariantAttributes,
} from './variants';

/**
 * Stage 3 — deterministic weighted scoring.
 *
 * Structurally this imitates `pricing/deal-quality.ts`: a set of weighted
 * factors, each carrying the sentence that justifies it, combined as a weighted
 * mean over *the factors that could actually be evaluated*. A store that
 * publishes no brand is not punished for it; it simply contributes no brand
 * evidence.
 *
 * The caps applied afterwards are where the safety lives. A weighted mean is a
 * good way to rank plausible pairs and a terrible way to reject implausible
 * ones — 95 % name agreement will out-vote a storage mismatch every time. So
 * conflicts do not subtract points, they impose ceilings.
 */

/** One side, pre-normalised. Reused so a subject is normalised once per pass. */
export interface PreparedSubject {
  subject: MatchSubject;
  name: NormalisedName;
  identifiers: NormalisedIdentifiers;
  variants: VariantAttributes;
  /** Model numbers from the declared field *and* from the title. */
  modelCandidates: string[];
}

/**
 * Model-number candidates.
 *
 * The declared `modelNumber` field is preferred, but most stores do not publish
 * one, so title tokens that survive `normaliseModelNumber`'s stoplist are
 * accepted too. That stoplist is what stops `128gb` and `4k` becoming model
 * numbers and merging half the catalogue.
 */
function collectModelCandidates(subject: MatchSubject, name: NormalisedName): string[] {
  const candidates = new Set<string>();

  const declared = normaliseModelNumber(subject.modelNumber);
  if (declared) candidates.add(declared);

  const attributeModel = subject.attributes?.model;
  if (typeof attributeModel === 'string') {
    const normalised = normaliseModelNumber(attributeModel);
    if (normalised) candidates.add(normalised);
  }

  /**
   * The brand is never a model number.
   *
   * Plenty of real brands contain digits — 3M, Level 8, Bose 700 — and the
   * brand almost always appears in the title. Harvesting it as a model number
   * makes every pair of products from that manufacturer look like an exact
   * model match, which is enough on its own to trip the auto-attach rule. This
   * is one line and it prevents a whole class of confident wrong merges.
   */
  const brandTokens = new Set(
    (subject.brand ? normaliseProductName(subject.brand).tokens : [])
      .map((token) => normaliseModelNumber(token))
      .filter((token): token is string => token != null),
  );

  for (const token of name.tokens) {
    // Role-tagged unit tokens are specifications, never model numbers.
    if (token.includes(':')) continue;
    const normalised = normaliseModelNumber(token);
    if (!normalised || brandTokens.has(normalised)) continue;
    candidates.add(normalised);
  }

  return [...candidates];
}

export function prepareSubject(subject: MatchSubject): PreparedSubject {
  const name = normaliseProductName(subject.name, { verticalId: subject.vertical });
  return {
    subject,
    name,
    identifiers: normaliseIdentifiers(subject),
    variants: extractVariantAttributes({
      normalizedName: name.normalized,
      tokens: name.tokens,
      attributes: subject.attributes,
    }),
    modelCandidates: collectModelCandidates(subject, name),
  };
}

function scoreBrand(left: PreparedSubject, right: PreparedSubject): MatchFactor | null {
  const leftBrand = left.identifiers.brandKey;
  const rightBrand = right.identifiers.brandKey;
  if (!leftBrand || !rightBrand) return null;

  const canonical = (brand: string) => BRAND_ALIASES[brand] ?? brand;
  const base = { key: 'brand' as const, label: 'Brand', weight: MATCH_WEIGHTS.brand };

  if (leftBrand === rightBrand) {
    return { ...base, score: 100, detail: `Both listings are branded ${leftBrand}.` };
  }
  if (canonical(leftBrand) === canonical(rightBrand)) {
    return {
      ...base,
      score: BRAND_ALIAS_SCORE,
      detail: `"${leftBrand}" and "${rightBrand}" are the same manufacturer.`,
    };
  }
  return { ...base, score: 0, detail: `Different brands: ${leftBrand} versus ${rightBrand}.` };
}

function scoreModel(left: PreparedSubject, right: PreparedSubject): MatchFactor | null {
  if (left.modelCandidates.length === 0 || right.modelCandidates.length === 0) return null;

  const base = { key: 'model' as const, label: 'Model number', weight: MATCH_WEIGHTS.model };

  for (const candidate of left.modelCandidates) {
    if (right.modelCandidates.includes(candidate)) {
      return { ...base, score: 100, detail: `Exact normalised model number ${candidate}.` };
    }
  }

  // Containment covers the very common case of one store publishing the short
  // marketing model and another the full regional SKU: OLED55C5 ⊂ OLED55C54LA.
  for (const leftCandidate of left.modelCandidates) {
    for (const rightCandidate of right.modelCandidates) {
      const delta = Math.abs(leftCandidate.length - rightCandidate.length);
      if (delta > MODEL_CONTAINMENT_MAX_LENGTH_DELTA) continue;
      if (leftCandidate.includes(rightCandidate) || rightCandidate.includes(leftCandidate)) {
        return {
          ...base,
          score: MODEL_CONTAINMENT_SCORE,
          detail: `Model numbers overlap: ${leftCandidate} and ${rightCandidate}.`,
        };
      }
    }
  }

  return {
    ...base,
    score: 0,
    detail: `Model numbers disagree: ${left.modelCandidates.join(', ')} versus ${right.modelCandidates.join(', ')}.`,
  };
}

function areNeighbouringCategories(left: string, right: string): boolean {
  return CATEGORY_NEIGHBOURS.some(
    ([a, b]) => (a === left && b === right) || (a === right && b === left),
  );
}

function scoreCategory(left: PreparedSubject, right: PreparedSubject): MatchFactor | null {
  const leftCategory = left.subject.category;
  const rightCategory = right.subject.category;
  if (!leftCategory || !rightCategory) return null;

  const base = { key: 'category' as const, label: 'Category', weight: MATCH_WEIGHTS.category };

  if (leftCategory === rightCategory) {
    return { ...base, score: 100, detail: `Both are listed under ${leftCategory}.` };
  }
  if (areNeighbouringCategories(leftCategory, rightCategory)) {
    return {
      ...base,
      score: CATEGORY_NEIGHBOUR_SCORE,
      detail: `Related categories: ${leftCategory} and ${rightCategory}.`,
    };
  }
  return {
    ...base,
    score: 0,
    detail: `Different categories: ${leftCategory} versus ${rightCategory}.`,
  };
}

function scoreName(left: PreparedSubject, right: PreparedSubject): MatchFactor {
  const score = nameSimilarity(left.name.tokens, right.name.tokens);
  const shared = sharedTokens(left.name.tokens, right.name.tokens).slice(0, 5);
  return {
    key: 'name',
    label: 'Product name',
    weight: MATCH_WEIGHTS.name,
    score,
    detail:
      shared.length > 0
        ? `Name similarity ${score}% (shared: ${shared.join(', ')}).`
        : `Name similarity ${score}%.`,
  };
}

function scoreVariant(
  agreedAxes: readonly string[],
  nonMaterialMismatches: readonly string[],
  conflicts: readonly MatchConflict[],
): MatchFactor | null {
  if (conflicts.length === 0 && agreedAxes.length === 0 && nonMaterialMismatches.length === 0) {
    return null;
  }

  const base = { key: 'variant' as const, label: 'Variant attributes', weight: MATCH_WEIGHTS.variant };

  if (conflicts.length > 0) {
    return { ...base, score: 0, detail: 'At least one variant attribute contradicts the match.' };
  }

  const score = Math.max(0, 100 - nonMaterialMismatches.length * NON_MATERIAL_MISMATCH_PENALTY);
  const detail =
    agreedAxes.length > 0
      ? `Variant attributes agree: ${agreedAxes.join(', ')}.`
      : 'No conflicting variant attributes.';
  return { ...base, score, detail };
}

function weightedMean(factors: readonly MatchFactor[]): number {
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = factors.reduce((sum, factor) => sum + factor.weight * factor.score, 0);
  return weighted / totalWeight;
}

/** Name similarity required before corroborated specifications count as strong. */
const SPEC_CORROBORATION_MIN_NAME_SCORE = 85;

/**
 * Floor on name similarity for a pair with no identifier and no model number.
 *
 * A weighted mean is generous to pairs that agree on everything *generic*:
 * "Apple AirTag" and "Apple iPhone 16 silikonikuori" share a brand, a category
 * and a pack quantity, which is enough to drag them into the mid-seventies on
 * a name overlap of almost nothing. Reviewers should not be handed those. With
 * an identifier or an exact model number the names are allowed to disagree
 * freely — that is the whole point of an identifier.
 */
export const MIN_NAME_SIMILARITY_FOR_REVIEW = 45;

function decideConfidence(
  score: number,
  conflicts: readonly MatchConflict[],
  factors: readonly MatchFactor[],
  substantiveAgreedAxes: number,
  thresholds: MatchThresholds,
): MatchConfidence {
  const identifier = factors.find((factor) => factor.key === 'identifier');
  const brand = factors.find((factor) => factor.key === 'brand');
  const model = factors.find((factor) => factor.key === 'model');
  const name = factors.find((factor) => factor.key === 'name');
  const category = factors.find((factor) => factor.key === 'category');
  const variant = factors.find((factor) => factor.key === 'variant');

  /**
   * Three ways to be sure enough to merge without asking anyone. Each requires
   * evidence that is *about the product*, not about how its title is spelled.
   */
  const strongEvidence =
    // 1. A shared identifier. The whole point of stage 1.
    identifier?.score === 100 ||
    // 2. The same manufacturer and the same model number. A brand alias counts:
    //    "HP" and "Hewlett Packard" publishing ENVY-X360-14 is one product, and
    //    refusing that would send every aliased brand to a human forever.
    ((brand?.score ?? 0) >= BRAND_ALIAS_SCORE && model?.score === 100) ||
    // 3. Same brand, same category, near-identical name, and at least one
    //    *substantive* specification confirmed identical on both sides. That
    //    last clause is what separates this from case-4-below: two listings can
    //    only reach it by agreeing on something a shopper would actually
    //    compare, like storage size or screen size.
    ((brand?.score ?? 0) === 100 &&
      category?.score === 100 &&
      (name?.score ?? 0) >= SPEC_CORROBORATION_MIN_NAME_SCORE &&
      variant?.score === 100 &&
      substantiveAgreedAxes > 0);

  // 4. The clause that matters most, stated as what is *missing*: name
  //    similarity alone can never reach HIGH. A 0.97 Dice score with no brand,
  //    no model number and no confirmed specification is a coincidence until a
  //    human says otherwise.
  if (score >= thresholds.autoAttachMinScore && conflicts.length === 0 && strongEvidence) {
    return 'HIGH';
  }

  // Without an identifier or an exact model number, the titles have to actually
  // resemble each other before this is worth a person's attention.
  const hasHardEvidence = identifier?.score === 100 || model?.score === 100;
  if (!hasHardEvidence && (name?.score ?? 0) < MIN_NAME_SIMILARITY_FOR_REVIEW) return 'LOW';

  if (score >= thresholds.reviewMinScore && !hasBlockingConflict(conflicts)) return 'MEDIUM';
  return 'LOW';
}

export interface ScoreMatchOptions {
  thresholds?: Partial<MatchThresholds>;
}

/**
 * Score one pair. Pure, deterministic, symmetric.
 *
 * Callers that compare one product against many canonicals should prepare each
 * side once with `prepareSubject` and use `scorePrepared`, so a candidate list
 * of 50 does not re-normalise the source 50 times.
 */
export function scoreMatch(
  source: MatchSubject,
  candidate: MatchSubject,
  options: ScoreMatchOptions = {},
): MatchResult {
  return scorePrepared(prepareSubject(source), prepareSubject(candidate), options);
}

export function scorePrepared(
  left: PreparedSubject,
  right: PreparedSubject,
  options: ScoreMatchOptions = {},
): MatchResult {
  const thresholds = resolveThresholds(options.thresholds);
  const factors: MatchFactor[] = [];
  let method: MatchMethod = 'NAME';

  // ── Stage 1 ───────────────────────────────────────────────────────────────
  const identifierMatch = matchIdentifiers(
    { ...left.identifiers, category: left.subject.category },
    { ...right.identifiers, category: right.subject.category },
  );
  const identifierConflict = hasIdentifierConflict(left.identifiers, right.identifiers);

  if (identifierMatch) {
    method = identifierMatch.method;
    factors.push({
      key: 'identifier',
      label: 'Identifier',
      weight: MATCH_WEIGHTS.identifier,
      score: 100,
      detail: identifierMatch.detail,
    });
  } else if (identifierConflict) {
    factors.push({
      key: 'identifier',
      label: 'Identifier',
      weight: MATCH_WEIGHTS.identifier,
      score: 0,
      detail: 'The listings publish different identifiers for the same field.',
    });
  }

  // ── Stage 3 factors ───────────────────────────────────────────────────────
  const brand = scoreBrand(left, right);
  if (brand) factors.push(brand);

  const model = scoreModel(left, right);
  if (model) factors.push(model);

  factors.push(scoreName(left, right));

  const category = scoreCategory(left, right);
  if (category) factors.push(category);

  // Variant materiality follows the source's category; when the two disagree
  // the category factor has already registered that as evidence.
  const variantComparison = compareVariants(left.variants, right.variants, left.subject.category);
  const conflicts: MatchConflict[] = [...variantComparison.conflicts];

  const variant = scoreVariant(
    variantComparison.agreedAxes,
    variantComparison.nonMaterialMismatches,
    variantComparison.conflicts,
  );
  if (variant) factors.push(variant);

  if (identifierConflict && !identifierMatch) {
    conflicts.push({
      key: 'identifier:mismatch',
      label: 'Identifier',
      detail: 'Both listings publish an identifier of the same kind, and they differ.',
      severity: 'BLOCKING',
    });
  }

  if (method === 'NAME' && model?.score === 100 && brand?.score === 100) {
    method = 'MODEL';
  }

  // ── Caps ──────────────────────────────────────────────────────────────────
  let score = weightedMean(factors);

  if (hasBlockingConflict(conflicts)) {
    score = Math.min(score, thresholds.conflictScoreCap);
  } else if (hasReviewableConflict(conflicts)) {
    score = Math.min(score, thresholds.reviewableConflictScoreCap);
  }

  const priceConflict = detectPriceConflict(left.subject, right.subject, thresholds);
  if (priceConflict) {
    conflicts.push(priceConflict);
    score = Math.min(score, thresholds.priceConflictScoreCap);
  }

  // An identifier match across unrelated categories is a retailer data error,
  // not a product identity. Downgrade rather than trust it.
  if (identifierMatch && category?.score === 0) {
    conflicts.push({
      key: 'identifier:context',
      label: 'Identifier context',
      detail:
        'The shared identifier appears on listings in unrelated categories, which usually means one store published the wrong code.',
      severity: 'REVIEWABLE',
    });
    score = Math.min(score, thresholds.reviewableConflictScoreCap);
  }

  score = Math.round(Math.max(0, Math.min(100, score)));

  // Build the explanation *before* deciding, and decide against the conflicts
  // it actually reports. Judging on a narrower internal list would let a result
  // claim HIGH confidence while displaying a conflict beside it — the kind of
  // inconsistency that destroys a reviewer's trust in the whole feature.
  const explanation = buildExplanation(factors, conflicts);

  const confidence = decideConfidence(
    score,
    explanation.conflicts,
    factors,
    variantComparison.substantiveAgreedAxes.length,
    thresholds,
  );

  return {
    score,
    confidence,
    method,
    engineVersion: MATCHER_VERSION,
    factors,
    ...explanation,
    autoAttachable:
      confidence === 'HIGH' &&
      explanation.conflicts.length === 0 &&
      score >= thresholds.autoAttachMinScore,
    reviewable:
      confidence !== 'LOW' &&
      score >= thresholds.reviewMinScore &&
      !hasBlockingConflict(explanation.conflicts),
  };
}

/**
 * Price sanity.
 *
 * "Sony WH-1000XM5" at €329 and "Sony WH-1000XM5 replacement earpads" at €29
 * agree on brand, model and most of the title. Nothing in the text separates
 * them; the price does. This never *raises* a score — it only refuses to trust
 * a high one.
 */
function detectPriceConflict(
  left: MatchSubject,
  right: MatchSubject,
  thresholds: MatchThresholds,
): MatchConflict | null {
  const leftPrice = left.price;
  const rightPrice = right.price;
  if (leftPrice == null || rightPrice == null) return null;
  if (leftPrice <= 0 || rightPrice <= 0) return null;

  const ratio = Math.max(leftPrice, rightPrice) / Math.min(leftPrice, rightPrice);
  if (ratio <= thresholds.priceSanityRatio) return null;

  return {
    key: 'price:implausible',
    label: 'Price',
    detail: `Prices differ by ${ratio.toFixed(1)}×, which is far more than the same product varies between stores.`,
    severity: 'REVIEWABLE',
  };
}
