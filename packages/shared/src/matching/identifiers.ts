/**
 * Stage 1 — strong identifiers.
 *
 * When two listings publish the same GTIN they are the same product, and no
 * amount of title similarity is needed to prove it. That makes this the highest
 * signal in the pipeline — and also the one that must be strictest about what
 * it accepts, because a mis-parsed identifier produces a *confident* wrong
 * answer rather than an uncertain one.
 *
 * Every function here returns `null` rather than throwing. These values come
 * from third-party retail feeds; malformed input is expected, not exceptional.
 */

import {
  BRAND_ALIASES,
  IDENTIFIER_MATCH_SCORE,
  MODEL_MATCH_SCORE,
  MPN_MATCH_SCORE,
} from './config';
import type { MatchMethod } from './types';

/** Valid GS1 lengths. Anything else is not a GTIN, whatever the field is named. */
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * GS1 modulo-10 check digit. Weights alternate 3/1 from the rightmost
 * *data* digit, which is what makes the algorithm length-independent.
 */
function hasValidCheckDigit(digits: string): boolean {
  const body = digits.slice(0, -1);
  const expected = Number(digits.slice(-1));

  let sum = 0;
  for (let index = body.length - 1, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[index]) * weight;
  }

  return (10 - (sum % 10)) % 10 === expected;
}

/**
 * Normalise to the 14-digit zero-padded GTIN, the identity of record.
 *
 * Zero-padding is what lets a UPC-A (12) published by one store and an EAN-13
 * published by another resolve to the same canonical product — they encode the
 * same GS1 key.
 */
export function normaliseGtin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!GTIN_LENGTHS.has(digits.length)) return null;
  if (!hasValidCheckDigit(digits)) return null;
  return digits.padStart(14, '0');
}

/**
 * The EAN as published (13 or 8 digits), kept for display and lookup alongside
 * the padded GTIN. A 12-digit UPC is *not* an EAN, so it is rejected here and
 * carried only as a GTIN.
 */
export function normaliseEan(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length !== 13 && digits.length !== 8) return null;
  if (!hasValidCheckDigit(digits)) return null;
  return digits;
}

/**
 * Manufacturer part number: uppercase alphanumerics.
 *
 * Short and all-numeric values are rejected because they are almost always
 * something else — a shelf code, a pack size, a year — and treating one as an
 * identifier would merge unrelated products with total confidence.
 */
export function normaliseMpn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < 3) return null;
  if (/^\d+$/.test(cleaned) && cleaned.length < 4) return null;
  return cleaned;
}

/**
 * Tokens that look like model numbers but are specifications.
 *
 * Without this list `128GB` is a "model number" and every 128 GB device on the
 * market merges into one canonical product. It is the single most important
 * guard in stage 1.
 */
const MODEL_NUMBER_STOPLIST: readonly RegExp[] = [
  /^\d+(?:GB|MB|TB|KB)$/,
  /^(?:4K|8K|2K|FHD|QHD|UHD|HD)$/,
  /^USB[A-C]?\d*$/,
  /^HDMI\d*$/,
  /^BLUETOOTH\d*$/,
  /^WIFI\d*$/,
  /^(?:19|20)\d{2}$/,
  /^\d+HZ$/,
  /^\d+MAH$/,
  /^\d+OHM$/,
  /^\d+MM$/,
  /^\d+CM$/,
  /^\d+W$/,
  /^\d+IN$/,
  /^\d+PA$/,
];

/**
 * Normalise a model number: uppercase, separators stripped, then filtered.
 *
 * Requires either a letter *and* a digit, or at least four digits. "PRO" alone
 * is not a model number; "C5" is; "2024" is caught by the stoplist.
 */
export function normaliseModelNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).toUpperCase().replace(/[-_/.\s]/g, '');
  if (cleaned.length < 2) return null;
  if (!/^[A-Z0-9+]+$/.test(cleaned)) return null;

  const hasLetter = /[A-Z]/.test(cleaned);
  const hasDigit = /\d/.test(cleaned);
  const digitCount = (cleaned.match(/\d/g) ?? []).length;
  if (!((hasLetter && hasDigit) || digitCount >= 4)) return null;

  if (MODEL_NUMBER_STOPLIST.some((pattern) => pattern.test(cleaned))) return null;

  return cleaned;
}

/** Lowercased brand, used only as a lookup and uniqueness key. */
export function brandKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
  return cleaned.length > 0 ? cleaned.replace(/\s+/g, ' ') : null;
}

/**
 * Every brand key that names the same manufacturer as this one.
 *
 * Candidate retrieval needs this, not just scoring. A store publishing
 * "Hewlett Packard" and one publishing "HP" produce different `brandKey`
 * values, so an exact-match lookup never puts the two listings in the same
 * candidate set — and a scorer that would have recognised them never gets the
 * chance. The alias table has to be applied at both ends of the pipeline.
 */
export function brandKeyVariants(key: string | null | undefined): string[] {
  if (!key) return [];
  const canonical = BRAND_ALIASES[key] ?? key;
  const variants = new Set<string>([key, canonical]);
  for (const [alias, target] of Object.entries(BRAND_ALIASES)) {
    if (target === canonical) variants.add(alias);
  }
  return [...variants];
}

export interface NormalisedIdentifiers {
  gtin: string | null;
  ean: string | null;
  mpn: string | null;
  modelNumber: string | null;
  brandKey: string | null;
}

export function normaliseIdentifiers(subject: {
  gtin?: string | null;
  ean?: string | null;
  mpn?: string | null;
  modelNumber?: string | null;
  brand?: string | null;
}): NormalisedIdentifiers {
  // An EAN is a GTIN; carrying it in both slots means a store that publishes
  // only `ean` still matches a store that publishes only `gtin`.
  const gtin = normaliseGtin(subject.gtin) ?? normaliseGtin(subject.ean);
  return {
    gtin,
    ean: normaliseEan(subject.ean) ?? normaliseEan(subject.gtin),
    mpn: normaliseMpn(subject.mpn),
    modelNumber: normaliseModelNumber(subject.modelNumber),
    brandKey: brandKey(subject.brand),
  };
}

export interface IdentifierMatch {
  kind: 'gtin' | 'ean' | 'mpn' | 'model';
  score: number;
  method: MatchMethod;
  detail: string;
}

/**
 * The stage-1 decision ladder. First hit wins; a lower rank never overrides a
 * higher one.
 *
 * A hit here does *not* end the pipeline. Variant conflicts and the price
 * sanity guard still run, because retailers do publish the wrong EAN — the
 * sample catalogue contains a deliberate example of exactly that.
 */
export function matchIdentifiers(
  left: NormalisedIdentifiers & { category?: string },
  right: NormalisedIdentifiers & { category?: string },
): IdentifierMatch | null {
  if (left.gtin && right.gtin && left.gtin === right.gtin) {
    return {
      kind: 'gtin',
      score: IDENTIFIER_MATCH_SCORE,
      method: 'IDENTIFIER',
      detail: `Both listings publish GTIN ${left.gtin}.`,
    };
  }

  if (left.ean && right.ean && left.ean === right.ean) {
    return {
      kind: 'ean',
      score: IDENTIFIER_MATCH_SCORE,
      method: 'IDENTIFIER',
      detail: `Both listings publish EAN ${left.ean}.`,
    };
  }

  if (left.brandKey && left.brandKey === right.brandKey && left.mpn && left.mpn === right.mpn) {
    return {
      kind: 'mpn',
      score: MPN_MATCH_SCORE,
      method: 'IDENTIFIER',
      detail: `Same brand and manufacturer part number (${left.mpn}).`,
    };
  }

  if (
    left.brandKey &&
    left.brandKey === right.brandKey &&
    left.modelNumber &&
    left.modelNumber === right.modelNumber &&
    left.category != null &&
    left.category === right.category
  ) {
    return {
      kind: 'model',
      score: MODEL_MATCH_SCORE,
      method: 'MODEL',
      detail: `Same brand, category and model number (${left.modelNumber}).`,
    };
  }

  return null;
}

/**
 * True when both sides publish an identifier of the same kind and they differ.
 * Silence is not disagreement — only a *contradiction* counts.
 */
export function hasIdentifierConflict(
  left: NormalisedIdentifiers,
  right: NormalisedIdentifiers,
): boolean {
  if (left.gtin && right.gtin && left.gtin !== right.gtin) return true;
  if (left.ean && right.ean && left.ean !== right.ean) return true;
  if (left.brandKey && left.brandKey === right.brandKey && left.mpn && right.mpn) {
    return left.mpn !== right.mpn;
  }
  return false;
}

/** True when either side publishes any usable identifier at all. */
export function hasAnyIdentifier(identifiers: NormalisedIdentifiers): boolean {
  return Boolean(identifiers.gtin ?? identifiers.ean ?? identifiers.mpn);
}
