/**
 * Shared identifiers for the synthetic European demo catalogue.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ALL SEVEN EUROPEAN STORES IN THIS DIRECTORY ARE FICTIONAL DEMO DATA.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The store names, the brands, the product names, the prices, the delivery costs
 * and the delivery estimates are all invented. None of it describes a real
 * retailer or a real offer, and none of it should be presented — in the UI, in a
 * screenshot or in a report — as commercial data. Every one of these stores
 * carries `isDemoStore: true`, which the API and the UI surface explicitly.
 *
 * They exist for one reason: the product's central claim is that *which stores
 * can deliver to you* changes with your destination, and that the cheapest listed
 * price is routinely not the cheapest delivered price. Demonstrating either
 * requires several stores in several countries with genuinely different delivery
 * rules, and that cannot be shown with three Finnish shops.
 *
 * Why invented brands rather than real hardware names. The three Finnish datasets
 * deliberately use real product names, on the grounds that search is meaningless
 * with invented model numbers. That reasoning does not carry over here: a
 * fictional store quoting a *real* product at a *fictional* price is exactly the
 * kind of thing that gets screenshotted and mistaken for a price comparison. So
 * these are invented brands with real category names — searchable, and impossible
 * to confuse with a genuine quote.
 *
 * ── Reserved identifiers ────────────────────────────────────────────────────
 *
 * Two EANs must never appear in this directory:
 *
 *   4548736132443  the seeded Sony trio, whose offer count of exactly 3 is
 *                  asserted by e2e/cross-store.spec.ts
 *   8879617123455  the deliberately-unsafe Philips pair, whose non-merge
 *                  prisma/seed.ts asserts and throws over
 *
 * Publishing either would silently change a canonical group that existing tests
 * depend on. `demo-catalogue.test.ts` enforces their absence rather than trusting
 * this comment.
 *
 * The `DEMO_EAN` codes below are in an unassigned GS1 range and carry valid
 * check digits, so the matching engine treats them as real identifiers — which is
 * the point, since cross-store grouping is what makes the comparison table
 * interesting.
 */

/**
 * Products deliberately sold by more than one demo store.
 *
 * Each key is one real-world product; the stores selling it publish the same EAN,
 * so cross-store matching groups them and the comparison table has something to
 * compare. Grouping happens **only among the demo stores** — none of these codes
 * appears in a Finnish dataset, so no existing canonical group changes shape.
 */
export const DEMO_EAN = {
  /**
   * The headline cross-border case, sold by four stores with four different
   * answers for Finland. See `demo-catalogue.test.ts` for the assertions.
   */
  auralisNc700: '9010000000017',
  lumenta27Qhd: '9010000000024',
  nordkraftUltra14: '9010000000031',
  sonarisFlow2: '9010000000048',
  voltaro140Charger: '9010000000055',
  kestrelAction8: '9010000000062',
  pixmoTab11: '9010000000079',
  auralisBudsAir: '9010000000086',
} as const;

/** EANs no demo dataset may publish. Enforced by a test, not by convention. */
export const RESERVED_EANS = ['4548736132443', '8879617123455'] as const;

/** Prefix every demo external id carries, so provenance is obvious in the data. */
export const DEMO_ID_PREFIXES = [
  'nby-',
  'thl-',
  'kns-',
  'mnq-',
  'ibd-',
  'adt-',
  'dke-',
] as const;
