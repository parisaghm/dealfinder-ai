-- Europe-wide destination-aware offers.
--
-- Additive except for one index swap on `watchlist_items`, which is called out
-- and ordered deliberately below.
--
-- STATEMENT ORDER IS LOAD-BEARING. Prisma generated the `DROP INDEX` for the old
-- watchlist uniqueness constraint as the *second* statement in the file, before
-- the replacement index existed. That would leave a window — however brief — in
-- which no uniqueness constraint protected the table at all. The statements have
-- been reordered by hand so the new four-column index is created first and the
-- old two-column one is dropped last. Between those two points both constraints
-- are enforced simultaneously, which is the intent.
--
-- The new constraint is destination-aware, NOT stricter: it deliberately admits
-- several rows for one (userId, productId) so Finland and Germany can be tracked
-- independently. Every row valid under the old constraint remains valid under the
-- new one, because steps 6a/6b give every existing row 'FI'/'EUR' and the
-- four-column tuple is therefore unique wherever the two-column one was.

-- ── 1. New enum ─────────────────────────────────────────────────────────────
CREATE TYPE "ImportDutyStatus" AS ENUM ('NONE', 'INCLUDED', 'POSSIBLE', 'UNKNOWN');

-- ── 2-6. Additive columns. Every one is nullable or carries a DEFAULT, so no
--         existing row is rewritten and no populated column changes type.
ALTER TABLE "notifications" ADD COLUMN     "deliveredPriceAtAlert" DECIMAL(10,2),
ADD COLUMN     "destinationCountry" TEXT;

ALTER TABLE "saved_searches" ADD COLUMN     "destinationCountry" TEXT,
ADD COLUMN     "preferredCurrency" TEXT,
ADD COLUMN     "storeRegion" TEXT;

ALTER TABLE "stores" ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "dataSourceType" TEXT NOT NULL DEFAULT 'mock',
ADD COLUMN     "isDemoStore" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "region" TEXT NOT NULL DEFAULT 'local',
ADD COLUMN     "supportedCurrencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "supportedDeliveryCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "vatRegistrationCountry" TEXT;

ALTER TABLE "user_settings" ADD COLUMN     "defaultCountryCode" TEXT NOT NULL DEFAULT 'FI',
ADD COLUMN     "defaultStoreRegion" TEXT NOT NULL DEFAULT 'local',
ADD COLUMN     "deliveryTimePreference" TEXT NOT NULL DEFAULT 'any',
ADD COLUMN     "includeNonEuStores" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showUnknownShipping" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "warnAboutImportCharges" BOOLEAN NOT NULL DEFAULT true;

-- 6a/6b. NOT NULL *with* defaults, so Postgres backfills every existing row in
-- place. They must be NOT NULL: Postgres treats NULLs as distinct in a unique
-- index, so nullable columns here would let two rows with a NULL destination
-- coexist and would silently destroy the "track a product once per destination"
-- guarantee that step 8 is establishing.
ALTER TABLE "watchlist_items" ADD COLUMN     "destinationCountry" TEXT NOT NULL DEFAULT 'FI',
ADD COLUMN     "preferredCurrency" TEXT NOT NULL DEFAULT 'EUR',
ADD COLUMN     "targetDeliveredPrice" DECIMAL(10,2);

-- ── 7. New tables ───────────────────────────────────────────────────────────
CREATE TABLE "countries" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "isEuMember" BOOLEAN NOT NULL,
    "isEeaMember" BOOLEAN NOT NULL,
    "isSupported" BOOLEAN NOT NULL DEFAULT false,
    "standardVatPercent" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "store_offers" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "productPrice" DECIMAL(10,2) NOT NULL,
    "originalPrice" DECIMAL(10,2),
    "shippingPrice" DECIMAL(10,2),
    "taxesIncluded" BOOLEAN,
    "estimatedTax" DECIMAL(10,2),
    "importDutyStatus" "ImportDutyStatus" NOT NULL DEFAULT 'UNKNOWN',
    "estimatedImportFees" DECIMAL(10,2),
    "totalDeliveredPrice" DECIMAL(10,2),
    "availability" "Availability" NOT NULL DEFAULT 'UNKNOWN',
    "deliveryMinDays" INTEGER,
    "deliveryMaxDays" INTEGER,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_offers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_offer_price_history" (
    "id" TEXT NOT NULL,
    "storeOfferId" TEXT NOT NULL,
    "productPrice" DECIMAL(10,2) NOT NULL,
    "shippingPrice" DECIMAL(10,2),
    "estimatedTax" DECIMAL(10,2),
    "estimatedImportFees" DECIMAL(10,2),
    "totalDeliveredPrice" DECIMAL(10,2),
    "originalCurrency" TEXT NOT NULL,
    "displayCurrency" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,8),
    "exchangeRateTimestamp" TIMESTAMP(3),
    "availability" "Availability" NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_offer_price_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'seed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- ── 8. Indexes on the new tables and columns ────────────────────────────────
CREATE UNIQUE INDEX "countries_name_key" ON "countries"("name");

CREATE INDEX "countries_isSupported_idx" ON "countries"("isSupported");

-- The index that keeps `sort=lowest-delivered` a SQL sort applied before
-- pagination, rather than an in-memory reshuffle of an already-chosen page.
CREATE INDEX "store_offers_countryCode_totalDeliveredPrice_idx" ON "store_offers"("countryCode", "totalDeliveredPrice");

CREATE INDEX "store_offers_countryCode_currency_idx" ON "store_offers"("countryCode", "currency");

CREATE INDEX "store_offers_countryCode_deliveryMaxDays_idx" ON "store_offers"("countryCode", "deliveryMaxDays");

CREATE INDEX "store_offers_storeId_idx" ON "store_offers"("storeId");

CREATE INDEX "store_offers_productId_idx" ON "store_offers"("productId");

CREATE UNIQUE INDEX "store_offers_productId_countryCode_currency_key" ON "store_offers"("productId", "countryCode", "currency");

CREATE INDEX "store_offer_price_history_storeOfferId_recordedAt_idx" ON "store_offer_price_history"("storeOfferId", "recordedAt");

CREATE INDEX "store_offer_price_history_recordedAt_idx" ON "store_offer_price_history"("recordedAt");

CREATE INDEX "exchange_rates_baseCurrency_quoteCurrency_fetchedAt_idx" ON "exchange_rates"("baseCurrency", "quoteCurrency", "fetchedAt");

CREATE UNIQUE INDEX "exchange_rates_baseCurrency_quoteCurrency_fetchedAt_key" ON "exchange_rates"("baseCurrency", "quoteCurrency", "fetchedAt");

CREATE INDEX "stores_countryCode_idx" ON "stores"("countryCode");

CREATE INDEX "stores_region_idx" ON "stores"("region");

CREATE INDEX "watchlist_items_destinationCountry_idx" ON "watchlist_items"("destinationCountry");

-- The replacement uniqueness constraint. Created BEFORE the old one is dropped,
-- so the table is never left unprotected. Named explicitly because Prisma's
-- generated name would exceed Postgres's 63-character identifier limit.
CREATE UNIQUE INDEX "watchlist_items_user_product_destination_key" ON "watchlist_items"("userId", "productId", "destinationCountry", "preferredCurrency");

-- ── 9. Retire the superseded index. LAST, and the only DROP in this migration.
--       Dropping an index removes no rows.
DROP INDEX "watchlist_items_userId_productId_key";

-- ── 10. Foreign keys ────────────────────────────────────────────────────────
ALTER TABLE "store_offers" ADD CONSTRAINT "store_offers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "store_offers" ADD CONSTRAINT "store_offers_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "store_offers" ADD CONSTRAINT "store_offers_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "store_offer_price_history" ADD CONSTRAINT "store_offer_price_history_storeOfferId_fkey" FOREIGN KEY ("storeOfferId") REFERENCES "store_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
