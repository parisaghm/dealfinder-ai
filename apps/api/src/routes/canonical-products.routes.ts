import type { PrismaClient } from '@deal-finder/db';
import {
  canonicalHistoryQuerySchema,
  canonicalOffersQuerySchema,
  canonicalProductsQuerySchema,
  idParamsSchema,
  type CanonicalHistoryQuery,
  type CanonicalOffersQuery,
  type CanonicalProductsQuery,
  type IdParams,
} from '@deal-finder/shared';
import { Router } from 'express';
import { validate, validated } from '../middleware/validate';
import {
  getCanonicalHistory,
  getCanonicalOffers,
  getCanonicalProduct,
  listCanonicalProducts,
} from '../services/canonical-product.service';

/**
 * `/api/canonical-products` — cross-store comparison.
 *
 * Read-only and public, like `/api/deals`: comparing prices does not require an
 * account, and nothing here is user-specific.
 */
export function createCanonicalProductsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/', validate(canonicalProductsQuerySchema, 'query'), async (req, res, next) => {
    try {
      const query = validated<CanonicalProductsQuery>(req, 'query');
      res.json(await listCanonicalProducts(prisma, query));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', validate(idParamsSchema, 'params'), async (req, res, next) => {
    try {
      const { id } = validated<IdParams>(req, 'params');
      res.json(await getCanonicalProduct(prisma, id));
    } catch (error) {
      next(error);
    }
  });

  router.get(
    '/:id/offers',
    validate(idParamsSchema, 'params'),
    validate(canonicalOffersQuerySchema, 'query'),
    async (req, res, next) => {
      try {
        const { id } = validated<IdParams>(req, 'params');
        const query = validated<CanonicalOffersQuery>(req, 'query');
        res.json(await getCanonicalOffers(prisma, id, query));
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/:id/history',
    validate(idParamsSchema, 'params'),
    validate(canonicalHistoryQuerySchema, 'query'),
    async (req, res, next) => {
      try {
        const { id } = validated<IdParams>(req, 'params');
        const query = validated<CanonicalHistoryQuery>(req, 'query');
        res.json(await getCanonicalHistory(prisma, id, query));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
