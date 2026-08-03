import { z } from 'zod';
import { idSchema, isoDateTimeSchema, moneySchema, searchTextSchema } from './common';

/**
 * Saved searches — a stored set of filters the user can re-run from the
 * dashboard, and the hook a future "new matching deal" digest would use.
 */

export const savedSearchSchema = z.object({
  id: idSchema,
  name: z.string().max(120).nullable(),
  query: z.string().max(200).nullable(),
  maximumPrice: moneySchema.nullable(),
  minimumDiscount: z.number().min(0).max(99).nullable(),
  category: z.string().max(64).nullable(),
  /** Store slugs; empty array means "any store". */
  stores: z.array(z.string().max(64)),
  vertical: z.string().max(64),
  alertsEnabled: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type SavedSearch = z.infer<typeof savedSearchSchema>;

export const savedSearchesResponseSchema = z.object({
  items: z.array(savedSearchSchema),
  total: z.number().int().nonnegative(),
});
export type SavedSearchesResponse = z.infer<typeof savedSearchesResponseSchema>;

const savedSearchFields = {
  name: z.string().trim().max(120).nullable().optional(),
  query: searchTextSchema.nullable().optional(),
  maximumPrice: moneySchema.positive().max(10_000_000).nullable().optional(),
  minimumDiscount: z.number().min(0).max(99).nullable().optional(),
  category: z.string().trim().max(64).nullable().optional(),
  stores: z.array(z.string().trim().max(64)).max(50).optional(),
  vertical: z.string().trim().max(64).optional(),
  alertsEnabled: z.boolean().optional(),
};

/**
 * A saved search with no criteria at all would match the entire catalogue, so
 * at least one filter is required.
 */
export const createSavedSearchSchema = z
  .object(savedSearchFields)
  .refine(
    (value) =>
      Boolean(value.query) ||
      value.maximumPrice != null ||
      value.minimumDiscount != null ||
      value.category != null ||
      (value.stores?.length ?? 0) > 0,
    'A saved search needs at least one filter.',
  );
export type CreateSavedSearchInput = z.infer<typeof createSavedSearchSchema>;

export const updateSavedSearchSchema = z
  .object(savedSearchFields)
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');
export type UpdateSavedSearchInput = z.infer<typeof updateSavedSearchSchema>;
