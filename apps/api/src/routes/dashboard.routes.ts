import type { PrismaClient } from '@deal-finder/db';
import { Router } from 'express';
import { currentUser, requireUser } from '../middleware/auth';
import { getDashboard } from '../services/dashboard.service';

/** `GET /api/dashboard` */
export function createDashboardRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/', requireUser, async (req, res, next) => {
    try {
      res.json(await getDashboard(prisma, currentUser(req).id));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
