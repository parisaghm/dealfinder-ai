-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('IDENTIFIER', 'MODEL', 'NAME', 'MANUAL', 'AI');

-- CreateEnum
CREATE TYPE "MatchConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "MatchCandidateStatus" AS ENUM ('PENDING', 'AI_CONFIRMED', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "canonicalMatchMethod" "MatchMethod",
ADD COLUMN     "canonicalMatchScore" INTEGER,
ADD COLUMN     "canonicalMatchedAt" TIMESTAMP(3),
ADD COLUMN     "canonicalProductId" TEXT,
ADD COLUMN     "ean" TEXT,
ADD COLUMN     "gtin" TEXT,
ADD COLUMN     "modelNumber" TEXT,
ADD COLUMN     "mpn" TEXT;

-- CreateTable
CREATE TABLE "canonical_products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "modelNumber" TEXT,
    "category" TEXT NOT NULL,
    "vertical" TEXT NOT NULL DEFAULT 'electronics',
    "gtin" TEXT,
    "ean" TEXT,
    "mpn" TEXT,
    "brandKey" TEXT,
    "normalizedName" TEXT NOT NULL,
    "imageUrl" TEXT,
    "specifications" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canonical_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_match_candidates" (
    "id" TEXT NOT NULL,
    "sourceProductId" TEXT NOT NULL,
    "candidateCanonicalProductId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "confidence" "MatchConfidence" NOT NULL,
    "reasons" JSONB NOT NULL,
    "status" "MatchCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_match_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "canonical_products_category_idx" ON "canonical_products"("category");

-- CreateIndex
CREATE INDEX "canonical_products_vertical_category_idx" ON "canonical_products"("vertical", "category");

-- CreateIndex
CREATE INDEX "canonical_products_brandKey_category_idx" ON "canonical_products"("brandKey", "category");

-- CreateIndex
CREATE INDEX "canonical_products_normalizedName_idx" ON "canonical_products"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_products_gtin_key" ON "canonical_products"("gtin");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_products_ean_key" ON "canonical_products"("ean");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_products_brandKey_mpn_key" ON "canonical_products"("brandKey", "mpn");

-- CreateIndex
CREATE INDEX "product_match_candidates_status_score_idx" ON "product_match_candidates"("status", "score");

-- CreateIndex
CREATE INDEX "product_match_candidates_sourceProductId_idx" ON "product_match_candidates"("sourceProductId");

-- CreateIndex
CREATE INDEX "product_match_candidates_candidateCanonicalProductId_idx" ON "product_match_candidates"("candidateCanonicalProductId");

-- CreateIndex
CREATE UNIQUE INDEX "product_match_candidates_sourceProductId_candidateCanonical_key" ON "product_match_candidates"("sourceProductId", "candidateCanonicalProductId");

-- CreateIndex
CREATE INDEX "products_canonicalProductId_idx" ON "products"("canonicalProductId");

-- CreateIndex
CREATE INDEX "products_gtin_idx" ON "products"("gtin");

-- CreateIndex
CREATE INDEX "products_ean_idx" ON "products"("ean");

-- CreateIndex
CREATE INDEX "products_brand_modelNumber_idx" ON "products"("brand", "modelNumber");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "canonical_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_match_candidates" ADD CONSTRAINT "product_match_candidates_sourceProductId_fkey" FOREIGN KEY ("sourceProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_match_candidates" ADD CONSTRAINT "product_match_candidates_candidateCanonicalProductId_fkey" FOREIGN KEY ("candidateCanonicalProductId") REFERENCES "canonical_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

