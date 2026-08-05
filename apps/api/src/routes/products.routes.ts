import type { PrismaClient } from '@deal-finder/db';
import {
  destinationHistoryQuerySchema,
  idParamsSchema,
  productOffersQuerySchema,
  rematchBodySchema,
  type DestinationHistoryQuery,
  type IdParams,
  type ProductOffersQuery,
  type RematchBody,
} from '@deal-finder/shared';
import { Router } from 'express';
import { requireUser } from '../middleware/auth';
import { validate, validated } from '../middleware/validate';
import { rematchProduct } from '../services/match-candidate.service';
import {
  getDestinationHistory,
  getProductOffers,
} from '../services/product-offers.service';
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

  /**
   * Price history, list-price or destination-aware.
   *
   * `country` is the switch, exactly as on `/api/deals`. Absent, this is the
   * existing `PriceHistory` series with the existing response shape. Present, the
   * series comes from `StoreOfferPriceHistory` — the destination's own record of
   * price, shipping and delivered total. The two are never substituted for each
   * other: a product's list-price history says nothing about what delivery to a
   * particular country cost on a particular date.
   */
  router.get(
    '/:id/history',
    validate(idParamsSchema, 'params'),
    validate(destinationHistoryQuerySchema, 'query'),
    async (req, res, next) => {
      try {
        const { id } = validated<IdParams>(req, 'params');
        const query = validated<DestinationHistoryQuery>(req, 'query');

        if (query.country != null) {
          res.json(await getDestinationHistory(prisma, id, { ...query, country: query.country }));
          return;
        }

        res.json(await getPriceHistory(prisma, id, query.days));
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Every store's offer for this product, as it bears on one destination.
   *
   * Split into offers that can reach the destination and offers that cannot, so
   * "this store does not ship here" is something the response says rather than
   * something the client infers from a store's absence.
   */
  router.get(
    '/:id/offers',
    validate(idParamsSchema, 'params'),
    validate(productOffersQuerySchema, 'query'),
    async (req, res, next) => {
      try {
        const { id } = validated<IdParams>(req, 'params');
        const query = validated<ProductOffersQuery>(req, 'query');
        res.json(await getProductOffers(prisma, id, query));
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
