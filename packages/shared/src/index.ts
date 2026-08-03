/**
 * @deal-finder/shared — the contract between every other package.
 *
 * Contains only pure code: domain types, Zod schemas and pricing/scoring
 * maths. No database access, no HTTP, no React. That is what allows the API
 * and the browser to import the identical validation rules and the identical
 * discount arithmetic, and is why the pricing logic can be unit-tested without
 * standing anything up.
 */

// ── Schemas & types ─────────────────────────────────────────────────────────
export * from './schemas/common';
export * from './schemas/price';
export * from './schemas/deal-quality';
export * from './schemas/product';
export * from './schemas/matching';
export * from './schemas/canonical';
export * from './schemas/destination';
export * from './schemas/deals';
export * from './schemas/watchlist';
export * from './schemas/saved-search';
export * from './schemas/notification';
export * from './schemas/dashboard';
export * from './schemas/settings';

// ── Countries, regions, tax and duty ────────────────────────────────────────
export * from './countries';

// ── Money (integer minor units) ─────────────────────────────────────────────
// Destination-aware arithmetic — FX, VAT, duty, delivered totals — happens
// here, in integers. The float `moneySchema` fields above remain the wire
// format for the pre-existing payloads; see money/money.ts for why both exist.
export * from './money';

// ── Pricing & deal quality ──────────────────────────────────────────────────
export * from './pricing/discount';
export * from './pricing/statistics';
export * from './pricing/deal-quality';

// ── Cross-store matching ────────────────────────────────────────────────────
export * from './matching';

// ── Verticals ───────────────────────────────────────────────────────────────
export * from './verticals/types';
export * from './verticals/electronics';
export * from './verticals/registry';

// ── Utilities ───────────────────────────────────────────────────────────────
export * from './utils/format';
export * from './utils/query-parsing';
