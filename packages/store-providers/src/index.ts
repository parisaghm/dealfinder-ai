/**
 * @deal-finder/store-providers — every integration with an outside store.
 *
 * The rest of the application depends only on the `StoreProvider` interface and
 * the registry. Nothing above this package knows whether data arrived from a
 * bundled fixture, an official API, embedded JSON-LD or a headless browser,
 * which is what makes those choices changeable one file at a time.
 *
 * Live adapters are intentionally NOT exported here: importing this module must
 * never pull in Playwright. See ./live/index.ts.
 */

export * from './types';
export * from './errors';
export * from './registry';

export * from './http/fetch-with-timeout';
export * from './http/retry';

export * from './mock/types';
export * from './mock/history';
export * from './mock/mock-provider';
export { gigantiDataset } from './mock/data/gigantti';
export { powerDataset } from './mock/data/power';
export { verkkokauppaDataset } from './mock/data/verkkokauppa';
