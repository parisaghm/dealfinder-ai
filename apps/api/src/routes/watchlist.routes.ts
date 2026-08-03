import type { PrismaClient } from '@deal-finder/db';
import {
  createWatchlistItemSchema,
  idParamsSchema,
  updateWatchlistItemSchema,
  type CreateWatchlistItemInput,
  type IdParams,
  type UpdateWatchlistItemInput,
} from '@deal-finder/shared';
import { Router } from 'express';
import { currentUser, requireUser } from '../middleware/auth';
import { validate, validated } from '../middleware/validate';
import {
  addToWatchlist,
  listWatchlist,
  removeFromWatchlist,
  updateWatchlistItem,
} from '../services/watchlist.service';

/**
 * `/api/watchlist` — all routes require a resolved user, and every service call
 * is scoped to that user's id.
 */
export function createWatchlistRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.use(requireUser);

  router.get('/', async (req, res, next) => {
    try {
      res.json(await listWatchlist(prisma, currentUser(req).id));
    } catch (error) {
      next(error);
    }
  });

  router.post('/', validate(createWatchlistItemSchema), async (req, res, next) => {
    try {
      const input = validated<CreateWatchlistItemInput>(req);
      const item = await addToWatchlist(prisma, currentUser(req).id, input);
      res.status(201).json(item);
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    '/:id',
    validate(idParamsSchema, 'params'),
    validate(updateWatchlistItemSchema),
    async (req, res, next) => {
      try {
        const { id } = validated<IdParams>(req, 'params');
        const input = validated<UpdateWatchlistItemInput>(req);
        res.json(await updateWatchlistItem(prisma, currentUser(req).id, id, input));
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete('/:id', validate(idParamsSchema, 'params'), async (req, res, next) => {
    try {
      const { id } = validated<IdParams>(req, 'params');
      await removeFromWatchlist(prisma, currentUser(req).id, id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
