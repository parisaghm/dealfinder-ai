import type { PrismaClient } from '@deal-finder/db';
import { listVerticals } from '@deal-finder/shared';
import { Router } from 'express';

/**
 * `GET /api/meta`
 *
 * Everything the filter UI needs to render itself: the active stores, and the
 * category taxonomy and example searches of each registered vertical.
 *
 * Served from the vertical registry rather than hard-coded in the frontend, so
 * adding a vertical or a category makes the UI reflect it without a frontend
 * change.
 */
export function createMetaRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const stores = await prisma.store.findMany({
        where: { isActive: true },
        select: { id: true, slug: true, name: true, websiteUrl: true, logoUrl: true, isActive: true },
        orderBy: { name: 'asc' },
      });

      res.json({
        stores,
        verticals: listVerticals({ enabledOnly: true }).map((vertical) => ({
          id: vertical.id,
          label: vertical.label,
          tagline: vertical.tagline,
          currency: vertical.currency,
          exampleSearches: vertical.exampleSearches,
          categories: vertical.categories.map((category) => ({
            id: category.id,
            label: category.label,
            description: category.description ?? null,
          })),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
