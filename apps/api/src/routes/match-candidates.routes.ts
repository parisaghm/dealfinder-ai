import type { PrismaClient } from '@deal-finder/db';
import {
  idParamsSchema,
  matchCandidatesQuerySchema,
  matchDecisionBodySchema,
  type IdParams,
  type MatchCandidatesQuery,
  type MatchDecisionBody,
} from '@deal-finder/shared';
import { Router } from 'express';
import { currentUser, requireUser } from '../middleware/auth';
import { validate, validated } from '../middleware/validate';
import {
  approveCandidate,
  listMatchCandidates,
  rejectCandidate,
} from '../services/match-candidate.service';

/**
 * `/api/match-candidates` — the review queue.
 *
 * Reading the queue is open, because the explanations are the same ones shown
 * on the public comparison page and there is nothing private in them. Deciding
 * requires a user: an approval changes what every visitor sees, and the
 * reviewer's identity is recorded on the row so the decision can be traced back
 * to a person.
 */
export function createMatchCandidatesRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/', validate(matchCandidatesQuerySchema, 'query'), async (req, res, next) => {
    try {
      const query = validated<MatchCandidatesQuery>(req, 'query');
      res.json(await listMatchCandidates(prisma, query));
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/:id/approve',
    requireUser,
    validate(idParamsSchema, 'params'),
    validate(matchDecisionBodySchema),
    async (req, res, next) => {
      try {
        const { id } = validated<IdParams>(req, 'params');
        const body = validated<MatchDecisionBody>(req);
        const user = currentUser(req);
        res.json(await approveCandidate(prisma, id, user.email, body.note ?? null));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/:id/reject',
    requireUser,
    validate(idParamsSchema, 'params'),
    validate(matchDecisionBodySchema),
    async (req, res, next) => {
      try {
        const { id } = validated<IdParams>(req, 'params');
        const body = validated<MatchDecisionBody>(req);
        const user = currentUser(req);
        res.json(await rejectCandidate(prisma, id, user.email, body.note ?? null));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
