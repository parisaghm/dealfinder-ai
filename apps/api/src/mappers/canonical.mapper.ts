import type { Prisma } from '@deal-finder/db';
import {
  compareOffers,
  matchExplanationSchema,
  offerTotalPrice,
  summariseMatch,
  type CanonicalIdentifiers,
  type CanonicalOffer,
  type CanonicalProductSummary,
  type ComparableOffer,
  type Currency,
  type MatchConfidence,
  type MatchExplanationDto,
  type MatchSubjectSummary,
  type OfferComparisonDto,
  type ProductSummary,
} from '@deal-finder/shared';
import type { ProductRow } from './product.mapper';

/**
 * Prisma rows → canonical-product DTOs.
 *
 * Sits alongside `product.mapper.ts` rather than inside it, and builds on the
 * `ProductSummary` that file produces rather than re-deriving anything. That is
 * deliberate: an offer on the comparison page and the same product on a search
 * card must report identical prices, discounts and deal-quality verdicts, and
 * the only way to guarantee that is for both to come from one function.
 */

export interface CanonicalRow {
  id: string;
  name: string;
  brand: string | null;
  modelNumber: string | null;
  category: string;
  vertical: string;
  gtin: string | null;
  ean: string | null;
  mpn: string | null;
  imageUrl: string | null;
  specifications: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OfferRow extends ProductRow {
  canonicalProductId: string | null;
  canonicalMatchMethod: 'IDENTIFIER' | 'MODEL' | 'NAME' | 'MANUAL' | 'AI' | null;
  canonicalMatchScore: number | null;
  canonicalMatchedAt: Date | null;
}

/** Keys that are matcher bookkeeping, not product specifications. */
const INTERNAL_SPEC_KEYS = new Set(['__matcherVersion', '__identifierDistrusted']);

const SPEC_LABELS: Record<string, string> = {
  storageGb: 'Storage',
  memoryGb: 'Memory',
  screenInches: 'Screen size',
  batteryHours: 'Battery life',
  colour: 'Colour',
  connectivity: 'Connectivity',
  warrantyMonths: 'Warranty',
  energyClass: 'Energy class',
  model: 'Model',
};

const SPEC_UNITS: Record<string, string> = {
  storageGb: ' GB',
  memoryGb: ' GB',
  screenInches: '"',
  batteryHours: ' h',
  warrantyMonths: ' months',
};

/**
 * Flatten a specifications bag to labelled strings.
 *
 * Rendering happens against strings so the comparison table and the review page
 * can line two products up field by field without either knowing the vertical's
 * attribute schema.
 */
export function flattenSpecifications(value: Prisma.JsonValue | null): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (INTERNAL_SPEC_KEYS.has(key)) continue;
    if (raw == null) continue;

    const label = SPEC_LABELS[key] ?? key;
    const unit = SPEC_UNITS[key] ?? '';

    if (Array.isArray(raw)) {
      const joined = raw.filter((entry) => entry != null).join(', ');
      if (joined) result[label] = joined;
      continue;
    }
    if (typeof raw === 'object') continue;

    result[label] = `${String(raw)}${unit}`;
  }
  return result;
}

export function toCanonicalIdentifiers(row: CanonicalRow): CanonicalIdentifiers {
  return { gtin: row.gtin, ean: row.ean, mpn: row.mpn, modelNumber: row.modelNumber };
}

/**
 * Parse a stored explanation back into its typed shape.
 *
 * Rows written by an older engine version, or hand-edited, must not crash a
 * page — the same defensive posture `product.mapper.ts` takes with
 * `attributes`. An unreadable explanation degrades to "no stated reasons",
 * which the UI can render honestly.
 */
export function parseExplanation(value: Prisma.JsonValue | null): MatchExplanationDto {
  const parsed = matchExplanationSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return {
    score: 0,
    confidence: 'LOW',
    method: 'NAME',
    engineVersion: 'unknown',
    reasons: [],
    conflicts: [
      {
        key: 'explanation:unreadable',
        label: 'Explanation',
        detail:
          'The stored explanation could not be read — it was probably written by an older version of the matcher. Re-run matching for this listing to regenerate it.',
        severity: 'REVIEWABLE',
      },
    ],
  };
}

/**
 * The weakest link in a group.
 *
 * A group is only as trustworthy as its least-justified member, so the card
 * reports the *minimum* confidence rather than the average. Averaging would let
 * two identifier matches hide a third offer that was grouped on a guess.
 */
function weakestConfidence(offers: readonly OfferRow[]): MatchConfidence {
  // A published identifier, an exact model number and a human decision are all
  // hard evidence. A name match is a judgement, however good the score, and so
  // is an AI endorsement — both must be visible to the reader as such.
  const HARD_EVIDENCE = new Set(['IDENTIFIER', 'MODEL', 'MANUAL']);
  const anySoft = offers.some(
    (offer) => offer.canonicalMatchMethod != null && !HARD_EVIDENCE.has(offer.canonicalMatchMethod),
  );
  return anySoft ? 'MEDIUM' : 'HIGH';
}

/**
 * Differences between the grouped offers that did not block the merge.
 *
 * Surfaced rather than smoothed over: a shopper comparing a black and a white
 * speaker should be told which is which, even though the matcher was right to
 * treat them as one purchase decision.
 */
function variantNotes(offers: readonly OfferRow[]): string[] {
  const byColour = new Map<string, string[]>();
  for (const offer of offers) {
    const attributes = offer.attributes;
    if (typeof attributes !== 'object' || attributes === null || Array.isArray(attributes)) continue;
    const colour = (attributes as Record<string, unknown>).colour;
    if (typeof colour !== 'string') continue;
    const stores = byColour.get(colour) ?? [];
    stores.push(offer.store.name);
    byColour.set(colour, stores);
  }

  if (byColour.size <= 1) return [];
  return [
    `Colour differs between stores: ${[...byColour.entries()]
      .map(([colour, stores]) => `${colour} (${stores.join(', ')})`)
      .join(' · ')}.`,
  ];
}

export interface CanonicalMappingContext {
  offers: readonly ProductSummary[];
  offerRows: readonly OfferRow[];
  pendingCandidateCount?: number;
}

export function toCanonicalSummary(
  canonical: CanonicalRow,
  context: CanonicalMappingContext,
): CanonicalProductSummary {
  const { offers, offerRows } = context;
  const comparison = compareOffers(offers.map(toComparableOffer));

  const currency: Currency = offers[0]?.currency ?? 'EUR';
  const storeSlugs = [...new Set(offers.map((offer) => offer.store.slug))].sort();

  const totals = offers
    .map((offer) => offerTotalPrice(toComparableOffer(offer)))
    .filter((total): total is number => total != null);

  // The offer to lead with: the cheapest a shopper can actually complete,
  // falling back to the cheapest listed price when no delivery cost is known.
  const bestOffer =
    offers.find((offer) => offer.id === comparison.cheapestTotalOfferId) ??
    [...offers].sort((a, b) => a.currentPrice - b.currentPrice || a.id.localeCompare(b.id))[0] ??
    null;

  return {
    id: canonical.id,
    name: canonical.name,
    brand: canonical.brand,
    category: canonical.category,
    vertical: canonical.vertical,
    imageUrl: canonical.imageUrl ?? bestOffer?.imageUrl ?? null,
    identifiers: toCanonicalIdentifiers(canonical),

    offerCount: offers.length,
    storeCount: storeSlugs.length,
    storeSlugs,

    currency,
    lowestPrice: comparison.lowestPrice,
    highestPrice: comparison.highestPrice,
    lowestEffectivePrice: totals.length > 0 ? Math.min(...totals) : null,
    highestEffectivePrice: totals.length > 0 ? Math.max(...totals) : null,
    priceSpread: comparison.priceSpread,
    savingsAgainstHighest: comparison.savingsAgainstHighest,
    savingsPercentAgainstHighest: comparison.savingsPercentAgainstHighest,

    bestOffer,
    matchConfidence: weakestConfidence(offerRows),
    variantNotes: variantNotes(offerRows),
    pendingCandidateCount: context.pendingCandidateCount ?? 0,

    updatedAt: canonical.updatedAt.toISOString(),
  };
}

export function toComparableOffer(offer: ProductSummary): ComparableOffer {
  return {
    id: offer.id,
    currentPrice: offer.currentPrice,
    shippingPrice: offer.shippingPrice,
    discountPercent: offer.discountPercent,
    lastCheckedAt: offer.lastCheckedAt,
    dealQuality: { score: offer.dealQuality.score },
    availability: offer.availability,
    storeName: offer.store.name,
  };
}

export function toOfferComparison(offers: readonly ProductSummary[]): OfferComparisonDto {
  return compareOffers(offers.map(toComparableOffer));
}

export function toCanonicalOffer(
  offer: ProductSummary,
  row: OfferRow,
  comparison: OfferComparisonDto,
  bestQualityScore: number,
): CanonicalOffer {
  const total = offerTotalPrice(toComparableOffer(offer));
  const lowest = comparison.lowestPrice ?? offer.currentPrice;
  const difference = Math.max(0, Math.round((offer.currentPrice - lowest) * 100) / 100);

  return {
    ...offer,
    totalPrice: total,
    match: {
      method: row.canonicalMatchMethod,
      score: row.canonicalMatchScore,
      matchedAt: row.canonicalMatchedAt ? row.canonicalMatchedAt.toISOString() : null,
      explanation: describeAttachment(row),
    },
    isLowestPrice: comparison.lowestPrice != null && offer.currentPrice === comparison.lowestPrice,
    isLowestTotalPrice: comparison.cheapestTotalOfferId === offer.id,
    isBestDealQuality: offer.dealQuality.score === bestQualityScore,
    priceDifferenceVsLowest: difference,
    priceDifferenceVsLowestPercent:
      lowest > 0 ? Math.round((difference / lowest) * 1000) / 10 : 0,
  };
}

/** One sentence naming the evidence that put this offer in the group. */
function describeAttachment(row: OfferRow): string | null {
  switch (row.canonicalMatchMethod) {
    case 'IDENTIFIER':
      return 'Grouped because this listing publishes the same product identifier as the others.';
    case 'MODEL':
      return 'Grouped on an exact brand and model-number match.';
    case 'NAME':
      return 'Grouped on brand, category and a close product-name match, with no conflicting specifications.';
    case 'MANUAL':
      return 'Grouped by a reviewer, who confirmed the listings describe the same product.';
    case 'AI':
      return 'Grouped after an AI-assisted review of an ambiguous match.';
    default:
      return null;
  }
}

// ── Match candidates ────────────────────────────────────────────────────────

export interface CandidateProductRow {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  imageUrl: string | null;
  productUrl: string;
  gtin: string | null;
  ean: string | null;
  mpn: string | null;
  modelNumber: string | null;
  attributes: Prisma.JsonValue | null;
  currentPrice: Prisma.Decimal;
  currency: string;
  store: { name: string; slug: string };
}

export function toMatchSubjectSummary(row: {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  imageUrl: string | null;
  gtin: string | null;
  ean: string | null;
  mpn: string | null;
  modelNumber: string | null;
  attributes?: Prisma.JsonValue | null;
  specifications?: Prisma.JsonValue | null;
}): MatchSubjectSummary {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    imageUrl: row.imageUrl,
    identifiers: {
      gtin: row.gtin,
      ean: row.ean,
      mpn: row.mpn,
      modelNumber: row.modelNumber,
    },
    specifications: flattenSpecifications(row.attributes ?? row.specifications ?? null),
  };
}

export function summariseCandidate(explanation: MatchExplanationDto): string {
  return summariseMatch(
    explanation.score,
    explanation.confidence,
    explanation.reasons,
    explanation.conflicts,
  );
}
