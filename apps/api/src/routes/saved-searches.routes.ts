import type { PrismaClient } from '@deal-finder/db';
import {
  createSavedSearchSchema,
  idParamsSchema,
  updateSavedSearchSchema,
  type CreateSavedSearchInput,
  type IdParams,
  type UpdateSavedSearchInput,
} from '@deal-finder/shared';
import { Router } from 'express';
import { currentUser, requireUser } from '../middleware/auth';
import { validate, validated } from '../middleware/validate';
import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  updateSavedSearch,
} from '../services/saved-search.service';

/** `/api/saved-searches` */
export function createSavedSearchesRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.use(requireUser);

  router.get('/', async (req, res, next) => {
    try {
      res.json(await listSavedSearches(prisma, currentUser(req).id));
    } catch (error) {
      next(error);
    }
  });

  router.post('/', validate(createSavedSearchSchema), async (req, res, next) => {
    try {
      const input = validated<CreateSavedSearchInput>(req);
      res.status(201).json(await createSavedSearch(prisma, currentUser(req).id, input));
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    '/:id',
    validate(idParamsSchema, 'params'),
    validate(updateSavedSearchSchema),
    async (req, res, next) => {
      try {
        const { id } = validated<IdParams>(req, 'params');
        const input = validated<UpdateSavedSearchInput>(req);
        res.json(await updateSavedSearch(prisma, currentUser(req).id, id, input));
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete('/:id', validate(idParamsSchema, 'params'), async (req, res, next) => {
    try {
      const { id } = validated<IdParams>(req, 'params');
      await deleteSavedSearch(prisma, currentUser(req).id, id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
