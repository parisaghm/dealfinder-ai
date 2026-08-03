import type { PrismaClient } from '@deal-finder/db';
import { dealsQuerySchema, type DealsQuery } from '@deal-finder/shared';
import { Router } from 'express';
import { validate, validated } from '../middleware/validate';
import { searchDeals } from '../services/deals.service';

/**
 * `GET /api/deals`
 *
 * Public: browsing does not require a user. When one is resolved, results are
 * annotated with whether they are already tracked.
 */
export function createDealsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/', validate(dealsQuerySchema, 'query'), async (req, res, next) => {
    try {
      const query = validated<DealsQuery>(req, 'query');
      const response = await searchDeals(prisma, query, { userId: req.user?.id });
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
