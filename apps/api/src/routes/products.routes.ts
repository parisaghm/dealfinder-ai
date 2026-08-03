import type { PrismaClient } from '@deal-finder/db';
import {
  idParamsSchema,
  priceHistoryQuerySchema,
  rematchBodySchema,
  type IdParams,
  type PriceHistoryQuery,
  type RematchBody,
} from '@deal-finder/shared';
import { Router } from 'express';
import { requireUser } from '../middleware/auth';
import { validate, validated } from '../middleware/validate';
import { rematchProduct } from '../services/match-candidate.service';
import { getPriceHistory, getProductDetails } from '../services/product.service';

/**
 * `GET /api/products/:id`, its price history, and cross-store rematching.
 */
export function createProductsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/:id', validate(idParamsSchema, 'params'), async (req, res, next) => {
    try {
      const { id } = validated<IdParams>(req, 'params');
      res.json(await getProductDetails(prisma, id, { userId: req.user?.id }));
    } catch (error) {
      next(error);
    }
  });

  router.get(
    '/:id/history',
    validate(idParamsSchema, 'params'),
    validate(priceHistoryQuerySchema, 'query'),
    async (req, res, next) => {
      try {
        const { id } = validated<IdParams>(req, 'params');
        const { days } = validated<PriceHistoryQuery>(req, 'query');
        res.json(await getPriceHistory(prisma, id, days));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Re-run cross-store matching for one listing.
   *
   * Behind `requireUser` because it changes what every visitor sees, and
   * because `force: true` discards review decisions.
   */
  router.post(
    '/:id/rematch',
    requireUser,
    validate(idParamsSchema, 'params'),
    validate(rematchBodySchema),
    async (req, res, next) => {
      try {
        const { id } = validated<IdParams>(req, 'params');
        const body = validated<RematchBody>(req);
        res.json(await rematchProduct(prisma, id, body));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
