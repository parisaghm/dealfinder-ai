import type { PrismaClient } from '@deal-finder/db';
import {
  clearDataSchema,
  updateUserSettingsSchema,
  type ClearDataInput,
  type UpdateUserSettingsInput,
} from '@deal-finder/shared';
import { Router } from 'express';
import { currentUser, requireUser } from '../middleware/auth';
import { validate, validated } from '../middleware/validate';
import { clearUserData, getUserSettings, updateUserSettings } from '../services/settings.service';

/**
 * `/api/settings`
 *
 * `POST /clear-data` is destructive, so it requires the literal confirmation
 * string enforced by `clearDataSchema` in addition to a resolved user.
 */
export function createSettingsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.use(requireUser);

  router.get('/', async (req, res, next) => {
    try {
      res.json(await getUserSettings(prisma, currentUser(req).id));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/', validate(updateUserSettingsSchema), async (req, res, next) => {
    try {
      const input = validated<UpdateUserSettingsInput>(req);
      res.json(await updateUserSettings(prisma, currentUser(req).id, input));
    } catch (error) {
      next(error);
    }
  });

  router.post('/clear-data', validate(clearDataSchema), async (req, res, next) => {
    try {
      const input = validated<ClearDataInput>(req);
      res.json(await clearUserData(prisma, currentUser(req).id, input));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
