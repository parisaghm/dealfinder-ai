import type { PrismaClient } from '@deal-finder/db';
import { storesQuerySchema, type StoresQuery } from '@deal-finder/shared';
import { Router } from 'express';
import { validate, validated } from '../middleware/validate';
import { listStores } from '../services/store.service';

/**
 * `GET /api/stores?country=FI&region=european`
 *
 * With a country, only stores that have at least one offer to it — deliverability
 * is read from offers, never from the store's own declared delivery list. Without
 * one, every active store, with its declaration returned as exactly that.
 */
export function createStoresRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/', validate(storesQuerySchema, 'query'), async (req, res, next) => {
    try {
      const query = validated<StoresQuery>(req, 'query');
      res.json(await listStores(prisma, query));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
