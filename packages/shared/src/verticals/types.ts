import type { z } from 'zod';
import type { Currency } from '../schemas/common';

/**
 * A "vertical" is a market DealFinder can shop in. The MVP ships electronics;
 * cars, cottages, flights, hotels, courses, apartments and event tickets are
 * intended to arrive as additional descriptors rather than as changes to the
 * search, scoring or storage layers.
 *
 * What makes that possible: every vertical is priced, discounted and tracked
 * over time, so the generic machinery (filters on price/discount/store, price
 * history, deal-quality scoring, watchlists, alerts) is vertical-agnostic. Only
 * three things vary, and all three live in a descriptor:
 *
 *   1. the category taxonomy,
 *   2. the vertical-specific attributes stored on `Product.attributes`,
 *   3. copy shown to the user (labels, example searches).
 */

export interface CategoryDescriptor {
  /** Stable slug persisted in `Product.category`. */
  id: string;
  label: string;
  /**
   * Lowercase terms that map free-text search onto this category, so
   * "Laptop under €1,000" filters to laptops instead of relying on a name match.
   */
  synonyms: readonly string[];
  /** Short description used on the home-page category tiles. */
  description?: string;
}

export interface VerticalDescriptor<TAttributes = unknown> {
  /** Stable slug persisted in `Product.vertical`. */
  id: string;
  label: string;
  tagline: string;
  /** Default currency for products in this vertical. */
  currency: Currency;
  categories: readonly CategoryDescriptor[];
  /**
   * Validates whatever is stored in `Product.attributes` for this vertical.
   * Kept as a Zod schema so a new vertical's extra fields are checked at the
   * boundary instead of being trusted blindly.
   */
  attributesSchema: z.ZodType<TAttributes>;
  /** Example searches surfaced on the home page. */
  exampleSearches: readonly string[];
  /** Verticals can be registered before their providers exist. */
  enabled: boolean;
}
