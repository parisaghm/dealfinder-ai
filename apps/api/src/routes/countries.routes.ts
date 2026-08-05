import { Router } from 'express';
import { listCountries } from '../services/country.service';

/**
 * `GET /api/countries`
 *
 * Public and static: the destination picker has to render before a user exists.
 * Every modelled country is returned with its own `isSupported` flag rather than
 * only the selectable ones, so the UI can show why a destination is visible but
 * not yet offered instead of leaving it unexplained.
 */
export function createCountriesRouter(): Router {
  const router = Router();

  router.get('/', (_req, res, next) => {
    try {
      res.json(listCountries());
    } catch (error) {
      next(error);
    }
  });

  return router;
}
