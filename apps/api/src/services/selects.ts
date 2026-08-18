import type { Prisma } from '@deal-finder/db';

/**
 * Shared Prisma selections.
 *
 * `PRODUCT_SELECT` lived in `deals.service.ts` and is still exported from there,
 * unchanged, for every existing importer. It moved here because the
 * destination-aware search needs it at module scope while `deals.service` needs
 * to dispatch *into* that search: two modules importing each other, where one of
 * them evaluates the shared constant during its own initialisation, is a
 * temporal-dead-zone crash waiting for whichever module happens to load first.
 * A leaf module both can depend on removes the cycle rather than relying on load
 * order to keep working.
 */
export const PRODUCT_SELECT = {
  id: true,
  externalId: true,
  name: true,
  description: true,
  brand: true,
  category: true,
  vertical: true,
  attributes: true,
  imageUrl: true,
  productUrl: true,
  currentPrice: true,
  originalPrice: true,
  shippingPrice: true,
  currency: true,
  discountPercent: true,
  availability: true,
  dataSourceType: true,
  lastCheckedAt: true,
  createdAt: true,
  updatedAt: true,
  // Selected but never emitted in `ProductSummary`: the grouping decoration
  // needs it, and adding it to the DTO would change a published response shape
  // for every existing client.
  canonicalProductId: true,
  store: {
    select: { id: true, slug: true, name: true, websiteUrl: true, logoUrl: true, isActive: true },
  },
} satisfies Prisma.ProductSelect;
