/**
 * Cross-store product matching.
 *
 * Pure and deterministic end to end: no database, no clock, no network. The
 * seed script, the backfill job, the API and the browser all import the same
 * engine, so a match explained on the review page is the same match the
 * scoring pass made.
 *
 * Read the stages in order: `normalize` → `identifiers` → `variants` →
 * `similarity` → `score` → `explain`. `review` is the optional AI hook, off by
 * default. `offer-sort`, `delivered-sort` and `best-price-series` serve the
 * comparison view rather than matching itself, but belong to the same feature.
 *
 * `offer-sort` compares listed price plus published shipping in one currency;
 * `delivered-sort` compares delivered totals to a chosen destination. Both are
 * live — the first serves the pre-expansion pages, the second the
 * destination-aware ones.
 */
export * from './types';
export * from './config';
export * from './marketing';
export * from './normalize';
export * from './identifiers';
export * from './variants';
export * from './similarity';
export * from './explain';
export * from './score';
export * from './review';
export * from './offer-sort';
export * from './delivered-sort';
export * from './best-price-series';
