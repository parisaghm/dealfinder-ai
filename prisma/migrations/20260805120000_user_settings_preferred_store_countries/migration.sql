-- Preferred store countries on user_settings.
--
-- Purely additive and safe on a populated table: one ADD COLUMN with a default,
-- so every existing row gets an empty array in place and nothing is rewritten.
-- No DROP, no ALTER ... TYPE, no NOT NULL on an existing column. Verified with
-- `prisma migrate diff --from-config-datasource --to-schema` before applying,
-- and applied with `migrate deploy` so no shadow database is involved (see
-- docs/database-environment.md for why that matters here).

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "preferredStoreCountries" TEXT[] DEFAULT ARRAY[]::TEXT[];
