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
 * default. `offer-sort` and `best-price-series` serve the comparison view
 * rather than matching itself, but belong to the same feature.
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
export * from './best-price-series';
