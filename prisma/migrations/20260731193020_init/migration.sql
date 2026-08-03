-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'PREORDER', 'DISCONTINUED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TARGET_REACHED', 'PRICE_DROP', 'BACK_IN_STOCK', 'TEST');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CheckFrequency" AS ENUM ('HOURLY', 'EVERY_6_HOURS', 'DAILY', 'WEEKLY');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notifyByEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnTargetReached" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnPriceDrop" BOOLEAN NOT NULL DEFAULT false,
    "checkFrequency" "CheckFrequency" NOT NULL DEFAULT 'EVERY_6_HOURS',
    "preferredStores" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "brand" TEXT,
    "category" TEXT NOT NULL,
    "vertical" TEXT NOT NULL DEFAULT 'electronics',
    "attributes" JSONB,
    "imageUrl" TEXT,
    "productUrl" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "currentPrice" DECIMAL(10,2) NOT NULL,
    "originalPrice" DECIMAL(10,2),
    "shippingPrice" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "availability" "Availability" NOT NULL DEFAULT 'UNKNOWN',
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "targetPrice" DECIMAL(10,2),
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastAlertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "query" TEXT,
    "maximumPrice" DECIMAL(10,2),
    "minimumDiscount" INTEGER,
    "category" TEXT,
    "stores" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vertical" TEXT NOT NULL DEFAULT 'electronics',
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT,
    "type" "NotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "priceAtAlert" DECIMAL(10,2),
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_userId_key" ON "user_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "stores_slug_key" ON "stores"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "stores_name_key" ON "stores"("name");

-- CreateIndex
CREATE INDEX "stores_isActive_idx" ON "stores"("isActive");

-- CreateIndex
CREATE INDEX "products_storeId_idx" ON "products"("storeId");

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category");

-- CreateIndex
CREATE INDEX "products_vertical_category_idx" ON "products"("vertical", "category");

-- CreateIndex
CREATE INDEX "products_currentPrice_idx" ON "products"("currentPrice");

-- CreateIndex
CREATE INDEX "products_discountPercent_idx" ON "products"("discountPercent");

-- CreateIndex
CREATE INDEX "products_lastCheckedAt_idx" ON "products"("lastCheckedAt");

-- CreateIndex
CREATE INDEX "products_brand_idx" ON "products"("brand");

-- CreateIndex
CREATE UNIQUE INDEX "products_storeId_externalId_key" ON "products"("storeId", "externalId");

-- CreateIndex
CREATE INDEX "price_history_productId_recordedAt_idx" ON "price_history"("productId", "recordedAt");

-- CreateIndex
CREATE INDEX "price_history_recordedAt_idx" ON "price_history"("recordedAt");

-- CreateIndex
CREATE INDEX "watchlist_items_userId_idx" ON "watchlist_items"("userId");

-- CreateIndex
CREATE INDEX "watchlist_items_alertsEnabled_idx" ON "watchlist_items"("alertsEnabled");

-- CreateIndex
CREATE INDEX "watchlist_items_productId_idx" ON "watchlist_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_items_userId_productId_key" ON "watchlist_items"("userId", "productId");

-- CreateIndex
CREATE INDEX "saved_searches_userId_idx" ON "saved_searches"("userId");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_productId_idx" ON "notifications"("productId");

-- CreateIndex
CREATE INDEX "notifications_type_status_idx" ON "notifications"("type", "status");

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
