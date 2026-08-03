import { z } from 'zod';
import { countryCodeSchema, importDutyStatusSchema, storeRegionSchema } from '../countries';
import {
  availabilitySchema,
  currencySchema,
  idSchema,
  isoDateTimeSchema,
  moneySchema,
} from './common';
import { productSummarySchema, storeSummarySchema } from './product';

/**
 * Destination-aware offer payloads.
 *
 * Everything here is *additive*. The pre-existing `productSummarySchema` and
 * `dealsResponseSchema` shapes are unchanged, and the destination block hangs off
 * them as a nullable field — so a client that has not been taught about
 * destinations parses a destination-aware response without noticing, and a
 * component handed `null` renders exactly what it rendered before.
 */

/**
 * Money on the wire.
 *
 * Carries both representations on purpose. `minorUnits` is the truth and is what
 * any further arithmetic must use; `major` is a convenience mirror for the
 * existing `Intl.NumberFormat` formatters, which take a float. Sending only the
 * float would put the client back in the position this whole module exists to
 * avoid.
 */
export const moneyAmountSchema = z.object({
  minorUnits: z.number().int(),
  major: moneySchema,
  currency: currencySchema,
});
export type MoneyAmountDto = z.infer<typeof moneyAmountSchema>;

export const RATE_DERIVATIONS = ['direct', 'inverted', 'triangulated'] as const;
export const rateDerivationSchema = z.enum(RATE_DERIVATIONS);

export const CONVERSION_STATUSES = [
  'same-currency',
  'converted',
  'converted-stale',
  'rate-missing',
  'rate-unusable',
] as const;
export const conversionStatusSchema = z.enum(CONVERSION_STATUSES);
export type ConversionStatusDto = z.infer<typeof conversionStatusSchema>;

/**
 * A converted amount, with everything needed to present it honestly.
 *
 * The rate and its timestamp are not optional extras — a converted price shown
 * without them is a number the user has no way to judge. `isEstimate` is
 * therefore always true for a real conversion, and the UI always labels it.
 */
export const convertedMoneySchema = z.object({
  /** The amount as the store charges it, in the store's own currency. */
  original: moneyAmountSchema,
  /** The converted amount, or null when no honest conversion was possible. */
  converted: moneyAmountSchema.nullable(),
  status: conversionStatusSchema,
  /** Units of display currency per unit of source currency. Null if unconverted. */
  exchangeRate: z.number().positive().nullable(),
  exchangeRateTimestamp: isoDateTimeSchema.nullable(),
  /** How old the rate was when this response was built. */
  rateAgeHours: z.number().nonnegative().nullable(),
  derivation: rateDerivationSchema.nullable(),
  /** True whenever a conversion happened. Converted money is always an estimate. */
  isEstimate: z.boolean(),
  /** True when this figure may not be presented as the cheapest delivered total. */
  blocksCheapestClaim: z.boolean(),
});
export type ConvertedMoneyDto = z.infer<typeof convertedMoneySchema>;

/**
 * What one store offer means for one delivery destination.
 *
 * `shipsToDestination` is authoritative and is derived from the existence of a
 * `StoreOffer` row — never from `Store.supportedDeliveryCountries`, which is
 * only a coarse declaration of where a store says it reaches. A product can sit
 * in a store that ships to Finland and still have no Finnish offer.
 */
export const deliveryToDestinationSchema = z.object({
  destinationCountry: countryCodeSchema,
  /** Always sent, so no surface has to look a name up or show a bare code. */
  destinationCountryName: z.string().min(1),

  sourceCountry: countryCodeSchema,
  sourceCountryName: z.string().min(1),

  /** Authoritative. False means we have no offer proving delivery is possible. */
  shipsToDestination: z.boolean(),

  productPrice: convertedMoneySchema,
  /**
   * Null means the store does not publish a delivery cost.
   *
   * Not zero, and never to be rendered as "free". An unknown delivery cost is
   * the single most common way a comparison tool ends up recommending the most
   * expensive option.
   */
  shippingPrice: moneyAmountSchema.nullable(),

  /** Null means we could not determine the tax treatment of this route. */
  taxesIncluded: z.boolean().nullable(),
  /** Estimated import VAT, when the route crosses the customs border. */
  estimatedTax: moneyAmountSchema.nullable(),
  importDutyStatus: importDutyStatusSchema,
  /** Estimated customs duty. Almost always null — see importDutyStatusFor. */
  estimatedImportFees: moneyAmountSchema.nullable(),

  /** Null whenever any required component is unknown. */
  totalDeliveredPrice: moneyAmountSchema.nullable(),

  deliveryMinDays: z.number().int().nonnegative().max(365).nullable(),
  deliveryMaxDays: z.number().int().nonnegative().max(365).nullable(),

  availability: availabilitySchema,
  lastCheckedAt: isoDateTimeSchema,

  /**
   * True when this offer must not be crowned cheapest — a stale or missing
   * exchange rate, or an incomplete cost breakdown. Distinct from being hidden.
   */
  blocksCheapestClaim: z.boolean(),
});
export type DeliveryToDestination = z.infer<typeof deliveryToDestinationSchema>;

/**
 * A product summary that may also describe delivery to a chosen destination.
 *
 * Extended here rather than in `product.ts` to keep the import graph acyclic —
 * this module already depends on `product.ts` for `storeSummarySchema`.
 *
 * `destinationOffer` is **optional, not nullable**. An absent field is what a
 * pre-expansion response looks like, so the same schema validates both the old
 * and the new payload and the web client needs no branch to parse them. A
 * component receiving `undefined` renders precisely what it rendered before the
 * expansion, which is what keeps the existing component tests honest.
 */
export const destinationProductSummarySchema = productSummarySchema.extend({
  destinationOffer: deliveryToDestinationSchema.optional(),
  /** Fictional demo retailer. Absent on the legacy path. */
  isDemoStore: z.boolean().optional(),
});
export type DestinationProductSummary = z.infer<typeof destinationProductSummarySchema>;

/** One row of the destination-aware comparison table. */
export const destinationOfferSchema = z.object({
  id: idSchema,
  productId: idSchema,
  store: storeSummarySchema,
  /** Fictional demo retailer, so the UI can say so. */
  isDemoStore: z.boolean(),
  delivery: deliveryToDestinationSchema,
});
export type DestinationOffer = z.infer<typeof destinationOfferSchema>;

/**
 * Summary of a destination-aware offer set.
 *
 * Deliberately parallel to `OfferComparison` in matching/offer-sort.ts, and for
 * the same reason: the number that is highlighted must be one a shopper can act
 * on, and anything passed over must be stated rather than quietly dropped.
 */
export const deliveredComparisonSchema = z.object({
  destinationCountry: countryCodeSchema,
  destinationCountryName: z.string().min(1),
  displayCurrency: currencySchema,

  /** Lowest and highest *delivered* totals among comparable offers. */
  lowestDeliveredPrice: moneyAmountSchema.nullable(),
  highestDeliveredPrice: moneyAmountSchema.nullable(),
  /** Lowest listed product price, which may belong to a different store. */
  lowestListedPrice: moneyAmountSchema.nullable(),

  cheapestDeliveredOfferId: idSchema.nullable(),
  /** Why a cheaper-looking offer was not crowned. Null when there is nothing to explain. */
  cheapestDeliveredCaveat: z.string().nullable(),

  /** Counted from offers, not from store metadata. */
  storesShippingToDestination: z.number().int().nonnegative(),
  offersWithUnknownShipping: z.number().int().nonnegative(),
  offersNotShippingToDestination: z.number().int().nonnegative(),
  offersBlockedByExchangeRate: z.number().int().nonnegative(),
});
export type DeliveredComparison = z.infer<typeof deliveredComparisonSchema>;

// ── Query parameters ────────────────────────────────────────────────────────

export const DELIVERY_TIME_PREFERENCES = ['any', 'under-3-days', 'under-7-days', 'under-14-days'] as const;
export const deliveryTimePreferenceSchema = z.enum(DELIVERY_TIME_PREFERENCES);
export type DeliveryTimePreference = z.infer<typeof deliveryTimePreferenceSchema>;

/** Maximum delivery days implied by each preference. Null means no limit. */
export const DELIVERY_TIME_MAX_DAYS: Record<DeliveryTimePreference, number | null> = {
  any: null,
  'under-3-days': 3,
  'under-7-days': 7,
  'under-14-days': 14,
};

/**
 * The destination-aware half of `GET /api/deals`.
 *
 * Every field is optional, and `country` is the switch: absent means the legacy
 * code path runs and returns the byte-identical pre-expansion payload. That is
 * what lets this ship without re-baselining the existing API and E2E suites.
 */
export const destinationQuerySchema = z.object({
  country: countryCodeSchema.optional(),
  currency: currencySchema.optional(),
  region: storeRegionSchema.optional(),
  /** Exclude offers with no proof of delivery to the destination. Default true. */
  shipsToCountryOnly: z.stringbool().optional(),
  maximumDeliveredPrice: z.coerce.number().positive().max(10_000_000).optional(),
  maximumShippingPrice: z.coerce.number().nonnegative().max(100_000).optional(),
  maxDeliveryDays: z.coerce.number().int().positive().max(365).optional(),
  /** Show offers whose delivery cost is unpublished. They can never win. */
  includeUnknownShipping: z.stringbool().optional(),
  includeNonEuStores: z.stringbool().optional(),
});
export type DestinationQuery = z.infer<typeof destinationQuerySchema>;

/** Echo of the destination filters actually applied. */
export const appliedDestinationSchema = z.object({
  country: countryCodeSchema,
  countryName: z.string().min(1),
  currency: currencySchema,
  region: storeRegionSchema,
  storeCountries: z.array(countryCodeSchema),
  maximumDeliveredPrice: z.number().nullable(),
  maximumShippingPrice: z.number().nullable(),
  maxDeliveryDays: z.number().nullable(),
  /**
   * How many offers a delivered-price, shipping or delivery-time bound removed
   * because a required cost was unpublished.
   *
   * Reported rather than silently applied: an offer vanishing without
   * explanation reads as "no such offer exists", which is a different and false
   * claim.
   */
  excludedUnknownShipping: z.number().int().nonnegative(),
  excludedNotShipping: z.number().int().nonnegative(),
});
export type AppliedDestination = z.infer<typeof appliedDestinationSchema>;

// ── Countries and stores endpoints ──────────────────────────────────────────

export const countryOptionSchema = z.object({
  code: countryCodeSchema,
  name: z.string().min(1),
  currency: currencySchema,
  isEuMember: z.boolean(),
  isEeaMember: z.boolean(),
  isSupported: z.boolean(),
  standardVatPercent: z.number().positive(),
});
export type CountryOption = z.infer<typeof countryOptionSchema>;

export const countriesResponseSchema = z.object({
  items: z.array(countryOptionSchema),
  defaultCountry: countryCodeSchema,
});
export type CountriesResponse = z.infer<typeof countriesResponseSchema>;

/** `GET /api/stores?country=FI` */
export const storesQuerySchema = z.object({
  country: countryCodeSchema.optional(),
  region: storeRegionSchema.optional(),
});
export type StoresQuery = z.infer<typeof storesQuerySchema>;

export const storeWithDeliverySchema = storeSummarySchema.extend({
  countryCode: countryCodeSchema.nullable(),
  countryName: z.string().nullable(),
  region: storeRegionSchema,
  /**
   * What the store *declares* about its reach. Coarse capability metadata, and
   * explicitly not proof that any given product can be delivered — that requires
   * an offer. Named verbosely so it cannot be mistaken for the authority.
   */
  declaredDeliveryCountries: z.array(countryCodeSchema),
  supportedCurrencies: z.array(currencySchema),
  vatRegistrationCountry: countryCodeSchema.nullable(),
  isDemoStore: z.boolean(),
  /**
   * Offers this store actually has for the requested destination. Present only
   * when `?country=` was supplied. This is the authoritative signal.
   */
  offersToCountry: z.number().int().nonnegative().nullable(),
});
export type StoreWithDelivery = z.infer<typeof storeWithDeliverySchema>;

export const storesResponseSchema = z.object({
  items: z.array(storeWithDeliverySchema),
  /** Null when no country filter was applied. */
  country: countryCodeSchema.nullable(),
});
export type StoresResponse = z.infer<typeof storesResponseSchema>;

// ── Product offers endpoint ─────────────────────────────────────────────────

/** `GET /api/products/:id/offers?country=FI&currency=EUR` */
export const productOffersQuerySchema = z.object({
  country: countryCodeSchema.default('FI'),
  currency: currencySchema.default('EUR'),
  includeNonShipping: z.stringbool().optional(),
});
export type ProductOffersQuery = z.infer<typeof productOffersQuerySchema>;

export const productOffersResponseSchema = z.object({
  productId: idSchema,
  canonicalProductId: idSchema.nullable(),
  offers: z.array(destinationOfferSchema),
  /**
   * Offers for the same product that cannot reach this destination. Returned
   * separately so the UI can mark them clearly rather than imply they are
   * options, and so "does not ship here" is visible instead of inferred from
   * absence.
   */
  unavailableHere: z.array(destinationOfferSchema),
  comparison: deliveredComparisonSchema,
});
export type ProductOffersResponse = z.infer<typeof productOffersResponseSchema>;
