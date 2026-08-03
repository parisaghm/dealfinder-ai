import { z } from 'zod';

/**
 * Primitives shared by every request/response schema.
 *
 * Everything the API accepts or returns is described here or in a sibling
 * schema file, and both the server and the browser client import the *same*
 * object. The server validates inbound requests with it; the web client
 * re-parses responses with it. A contract drift therefore fails loudly in
 * development instead of surfacing as `undefined` deep inside a component.
 */

/**
 * Currencies the application can represent.
 *
 * Appended to rather than reordered: `CHF` and `GBP` arrived with the European
 * expansion, for Switzerland and the United Kingdom. Those two destinations are
 * modelled but not yet selectable — their currencies exist so the country table
 * can name them honestly rather than defaulting to EUR.
 */
export const CURRENCIES = ['EUR', 'SEK', 'NOK', 'DKK', 'USD', 'CHF', 'GBP'] as const;
export const currencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof currencySchema>;

/**
 * Stock states normalised across stores. Providers map their own wording
 * ("Saatavilla", "Loppunut", …) onto these values.
 */
export const AVAILABILITY_VALUES = [
  'IN_STOCK',
  'LOW_STOCK',
  'OUT_OF_STOCK',
  'PREORDER',
  'DISCONTINUED',
  'UNKNOWN',
] as const;
export const availabilitySchema = z.enum(AVAILABILITY_VALUES);
export type Availability = z.infer<typeof availabilitySchema>;

/** Dates cross the wire as ISO-8601 UTC strings (`Date#toISOString`). */
export const isoDateTimeSchema = z.iso.datetime();

export const idSchema = z.string().trim().min(1).max(64);
export const idParamsSchema = z.object({ id: idSchema });
export type IdParams = z.infer<typeof idParamsSchema>;

/** Non-negative, finite monetary amount in major units (e.g. euros). */
export const moneySchema = z.number().finite().nonnegative();

/** Percentage in the 0–100 range. */
export const percentSchema = z.number().finite().min(0).max(100);

/**
 * Normalise *before* validating. In Zod 4 chained `.trim()`/`.toLowerCase()`
 * run as checks after the format assertion, so `z.email().trim()` would reject
 * " User@Example.com " instead of accepting and normalising it.
 */
export const emailSchema = z
  .string()
  .max(254)
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.email());

export const urlSchema = z
  .string()
  .max(2048)
  .transform((value) => value.trim())
  .pipe(z.url());

export const paginationMetaSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

/**
 * Query parameters arrive as strings. Accept both repeated keys
 * (`?stores=a&stores=b`) and a comma-separated list (`?stores=a,b`), and
 * normalise either into a de-duplicated array.
 */
export function commaSeparatedList<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess((value) => {
    const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : value;
    if (!Array.isArray(raw)) return raw;
    const cleaned = raw
      .map((entry) => (typeof entry === 'string' ? entry.trim() : entry))
      .filter((entry) => entry !== '' && entry != null);
    return [...new Set(cleaned)];
  }, z.array(item));
}

/** Matches C0 and C1 control characters, which are never legitimate input. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARACTERS = new RegExp('[\u0000-\u001F\u007F-\u009F]', 'g');

/**
 * Free-text input that gets embedded in SQL `contains` filters and rendered
 * back to the user. Strips control characters and angle brackets so a stray
 * `<script>` can never round-trip through the API, and caps the length so a
 * pathological query cannot become a denial-of-service vector.
 *
 * This is defence in depth, not the primary protection: Prisma parameterises
 * every query and React escapes every interpolation.
 */
export const searchTextSchema = z
  .string()
  .max(200)
  .transform((value) =>
    value.replace(CONTROL_CHARACTERS, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim(),
  );

/** The single error envelope every failing endpoint returns. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
