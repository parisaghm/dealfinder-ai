-- Offer-level data provenance.
--
-- `stores.dataSourceType` already records how a *store's* data is obtained, but a
-- real retailer can carry an invented listing: the sample catalogues interpolate
-- synthetic ids into Gigantti's, Power's and Verkkokauppa's genuine URL shapes, so
-- those product URLs are well-formed, sit on real domains, and are 404s. Those
-- stores have `isDemoStore = false` — correctly, they exist — so neither existing
-- column can decide whether a product URL may be opened.
--
-- Additive, and `'mock'` is the accurate value for every existing row rather than
-- a placeholder: in the default provider mode every listing and every quote in
-- this database came from a bundled fixture.

ALTER TABLE "products" ADD COLUMN     "dataSourceType" TEXT NOT NULL DEFAULT 'mock';

ALTER TABLE "store_offers" ADD COLUMN     "dataSourceType" TEXT NOT NULL DEFAULT 'mock';
