/**
 * Name similarity — weighted Dice coefficient over identity tokens.
 *
 * Dice rather than Levenshtein because product titles are *bags of facts* in
 * arbitrary order, not sequences: "Sony WH-1000XM5 vastamelukuulokkeet" and
 * "Sony WH-1000XM5 Musta langattomat vastamelukuulokkeet" describe one product,
 * and an edit-distance metric would punish the second for being longer. Order
 * is deliberately ignored, and the function is symmetric by construction.
 *
 * The weighting is what makes it useful on this data: tokens containing digits
 * carry double weight, because that is where model fragments live. Two
 * headphones agreeing on "wireless noise cancelling headphones" prove nothing;
 * two agreeing on "wh1000xm5" prove almost everything.
 */

const DIGIT_TOKEN_WEIGHT = 2;
const LONG_TOKEN_WEIGHT = 1.5;
const LONG_TOKEN_MIN_LENGTH = 5;
const SHORT_TOKEN_WEIGHT = 1;

export function tokenWeight(token: string): number {
  if (/\d/.test(token)) return DIGIT_TOKEN_WEIGHT;
  if (token.length >= LONG_TOKEN_MIN_LENGTH) return LONG_TOKEN_WEIGHT;
  return SHORT_TOKEN_WEIGHT;
}

function weighTokens(tokens: readonly string[]): Map<string, number> {
  const weights = new Map<string, number>();
  for (const token of tokens) {
    // A set, not a multiset: a title that repeats "pro" three times is not
    // three times more about "pro".
    if (!weights.has(token)) weights.set(token, tokenWeight(token));
  }
  return weights;
}

function totalWeight(weights: ReadonlyMap<string, number>): number {
  let sum = 0;
  for (const weight of weights.values()) sum += weight;
  return sum;
}

/**
 * Weighted Dice similarity, 0–100.
 *
 * Two empty token sets score 0 rather than 100: "we know nothing about either
 * name" is not evidence that they match.
 */
export function nameSimilarity(left: readonly string[], right: readonly string[]): number {
  const leftWeights = weighTokens(left);
  const rightWeights = weighTokens(right);

  const leftTotal = totalWeight(leftWeights);
  const rightTotal = totalWeight(rightWeights);
  if (leftTotal === 0 || rightTotal === 0) return 0;

  let shared = 0;
  for (const [token, weight] of leftWeights) {
    if (rightWeights.has(token)) shared += weight;
  }

  return Math.round((100 * (2 * shared)) / (leftTotal + rightTotal));
}

/** The tokens both titles share, heaviest first — used in the explanation. */
export function sharedTokens(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left)]
    .filter((token) => rightSet.has(token))
    .sort((a, b) => tokenWeight(b) - tokenWeight(a) || a.localeCompare(b));
}
