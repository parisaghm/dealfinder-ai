import type { Availability, Prisma } from '@deal-finder/db';
import {
  addMoney,
  convertWithProvenance,
  countryName,
  deliveredTotal,
  fromDecimalString,
  importDutyStatusFor,
  leastTrustedDataSource,
  toMoneyAmount,
  toMoneyAmountOrNull,
  type ConvertedMoneyDto,
  type CountryCode,
  type Currency,
  type DeliveredComparison,
  type DeliveredComparisonResult,
  type DeliveredHistoryPoint,
  type DeliveredSortableOffer,
  type DeliveryToDestination,
  type DestinationOffer,
  type ImportDutyStatus,
  type Money,
  type StoreWithDelivery,
} from '@deal-finder/shared';
import type { RateContext } from '../services/exchange-rate.service';
import { toStoreSummary, type StoreRow } from './product.mapper';

/**
 * `StoreOffer` rows → destination-aware DTOs.
 *
 * This is the only place a destination-specific `Decimal` becomes a number, and
 * it does so through `fromDecimalString` rather than `Number()`. The distinction
 * matters: a delivered total is a chain (convert, add shipping, add tax, add
 * duty), and a float introduced at the first link cannot be rounded back into
 * correctness at the last. So every amount enters as integer minor units, the
 * arithmetic happens there, and `toMoneyAmount` produces the float mirror once,
 * at the very end, for the formatters.
 *
 * Three rules are enforced here rather than left to callers:
 *
 *  1. **Deliverability comes from the offer, never from store metadata.** A
 *     caller states whether this row proves delivery to the destination;
 *     `Store.supportedDeliveryCountries` is not consulted anywhere in this file.
 *  2. **Unknown shipping yields an unknown total.** Never zero, never "free".
 *  3. **A conversion is always labelled**, with its rate, that rate's timestamp
 *     and its age, so no converted figure can be read as a quoted price.
 */

/** Store columns a destination-aware response needs beyond `StoreSummary`. */
export interface OfferStoreRow extends StoreRow {
  countryCode: string | null;
  region: string;
  supportedCurrencies: string[];
  supportedDeliveryCountries: string[];
  vatRegistrationCountry: string | null;
  isDemoStore: boolean;
}

export interface StoreOfferRow {
  id: string;
  productId: string;
  countryCode: string;
  currency: string;
  productPrice: Prisma.Decimal;
  originalPrice: Prisma.Decimal | null;
  shippingPrice: Prisma.Decimal | null;
  taxesIncluded: boolean | null;
  estimatedTax: Prisma.Decimal | null;
  importDutyStatus: ImportDutyStatus;
  estimatedImportFees: Prisma.Decimal | null;
  totalDeliveredPrice: Prisma.Decimal | null;
  availability: Availability;
  deliveryMinDays: number | null;
  deliveryMaxDays: number | null;
  /** How this quote was obtained. Gates the external link, via the shared helper. */
  dataSourceType: string;
  /**
   * The listing this quote is for.
   *
   * Joined in solely for provenance and the deep link: a row needs to link to the
   * product rather than the retailer's front page, and the listing's own source is
   * needed because a quote is never more trustworthy than the listing beneath it.
   */
  product: { productUrl: string; dataSourceType: string };
  lastCheckedAt: Date;
  store: OfferStoreRow;
}

export interface StoreOfferHistoryRow {
  productPrice: Prisma.Decimal;
  shippingPrice: Prisma.Decimal | null;
  estimatedTax: Prisma.Decimal | null;
  estimatedImportFees: Prisma.Decimal | null;
  totalDeliveredPrice: Prisma.Decimal | null;
  originalCurrency: string;
  exchangeRate: Prisma.Decimal | null;
  exchangeRateTimestamp: Date | null;
  availability: Availability;
  recordedAt: Date;
}

/**
 * `Decimal` → `Money`, via the exact decimal string.
 *
 * The single ingress for destination money. Returns null for an absent *or*
 * unparseable value, because a column that does not hold a number is a data
 * condition to report, not a programmer error to crash on.
 */
export function moneyFromDecimal(
  value: Prisma.Decimal | null | undefined,
  currency: Currency,
): Money | null {
  if (value == null) return null;
  return fromDecimalString(String(value), currency);
}

/** A currency string from the database, narrowed at this boundary. */
function asCurrency(value: string): Currency {
  return value as Currency;
}

function asCountryCode(value: string | null): CountryCode | null {
  return value == null ? null : (value as CountryCode);
}

/**
 * Convert one amount and describe the conversion completely.
 *
 * Every field the UI needs to be honest travels with the number: the original as
 * the store charges it, the rate, when that rate was observed, how old it is now,
 * how it was derived, and whether it is too old to decide a winner.
 */
export function toConvertedMoney(
  amount: Money,
  displayCurrency: Currency,
  rates: RateContext,
): ConvertedMoneyDto {
  const outcome = convertWithProvenance(amount, displayCurrency, rates.table, {
    maxAgeHours: rates.maxAgeHours,
    now: rates.now,
  });

  return {
    original: toMoneyAmount(amount),
    converted: toMoneyAmountOrNull(outcome.converted),
    status: outcome.status,
    // The rate becomes a float only here, for display. It was parsed as an exact
    // decimal for the arithmetic that produced `converted`.
    exchangeRate: outcome.snapshot == null ? null : Number(outcome.snapshot.rate),
    exchangeRateTimestamp: outcome.snapshot?.fetchedAt ?? null,
    rateAgeHours: outcome.ageHours == null ? null : Math.round(outcome.ageHours * 100) / 100,
    derivation: outcome.derivation,
    isEstimate: outcome.isEstimate,
    blocksCheapestClaim: outcome.blocksCheapestClaim,
  };
}

export interface DeliveryMappingContext {
  destinationCountry: CountryCode;
  displayCurrency: Currency;
  rates: RateContext;
  /**
   * Whether this row proves the product can be delivered to the destination.
   *
   * Passed in rather than inferred so the authority rule is explicit at every
   * call site: it is true only when the offer's own `countryCode` *is* the
   * destination. A row included to show "this store sells it but cannot ship
   * here" arrives with `false`.
   */
  shipsToDestination: boolean;
}

/**
 * One offer, as it bears on one destination.
 *
 * The delivered total is recomputed from the *converted* components rather than
 * converted from the stored total. Both are defensible to within a cent; this way
 * the breakdown the user reads adds up to the total the user reads, and a
 * comparison table whose columns do not sum to its own bottom line undermines the
 * only thing it exists to do.
 */
export function toDeliveryToDestination(
  offer: StoreOfferRow,
  context: DeliveryMappingContext,
): DeliveryToDestination {
  const { destinationCountry, displayCurrency, rates, shipsToDestination } = context;
  const offerCurrency = asCurrency(offer.currency);
  const sourceCountry = asCountryCode(offer.store.countryCode);

  const productPrice = moneyFromDecimal(offer.productPrice, offerCurrency);
  const productPriceConverted =
    productPrice == null
      ? null
      : toConvertedMoney(productPrice, displayCurrency, rates);

  /**
   * A row that cannot reach the destination carries no delivery figures at all.
   *
   * Its shipping cost, tax treatment and delivery estimate describe a different
   * destination — its own — and reusing them here would state that this store
   * delivers to the shopper for that price. The listed product price is real and
   * is kept, because "sold elsewhere for less, but not shipped here" is exactly
   * the fact worth showing.
   */
  const shipping = shipsToDestination
    ? convertComponent(offer.shippingPrice, offerCurrency, displayCurrency, rates)
    : { known: false as const, money: null };
  const tax = shipsToDestination
    ? convertComponent(offer.estimatedTax, offerCurrency, displayCurrency, rates)
    : { known: false as const, money: null };
  const duty = shipsToDestination
    ? convertComponent(offer.estimatedImportFees, offerCurrency, displayCurrency, rates)
    : { known: false as const, money: null };

  const convertedProduct = productPriceConverted?.converted;
  const total =
    !shipsToDestination || convertedProduct == null
      ? null
      : deliveredTotal({
          productPrice: { minorUnits: convertedProduct.minorUnits, currency: displayCurrency },
          // Null propagates: unknown shipping means an unknown total, and an
          // unconvertible shipping cost is no more known than an absent one.
          shippingPrice: shipping.known ? shipping.money : null,
          estimatedTax: tax.money,
          importFees: duty.money,
        });

  const importDutyStatus: ImportDutyStatus = shipsToDestination
    ? offer.importDutyStatus
    : sourceCountry == null
      ? 'UNKNOWN'
      : importDutyStatusFor(sourceCountry, destinationCountry);

  return {
    destinationCountry,
    destinationCountryName: countryName(destinationCountry),
    sourceCountry,
    sourceCountryName: sourceCountry == null ? null : countryName(sourceCountry),
    shipsToDestination,

    productPrice: productPriceConverted ?? unparseableAmount(displayCurrency),
    shippingPrice: toMoneyAmountOrNull(shipping.money),

    taxesIncluded: shipsToDestination ? offer.taxesIncluded : null,
    estimatedTax: toMoneyAmountOrNull(tax.money),
    importDutyStatus,
    estimatedImportFees: toMoneyAmountOrNull(duty.money),

    totalDeliveredPrice: toMoneyAmountOrNull(total),

    deliveryMinDays: shipsToDestination ? offer.deliveryMinDays : null,
    deliveryMaxDays: shipsToDestination ? offer.deliveryMaxDays : null,

    availability: offer.availability,
    lastCheckedAt: offer.lastCheckedAt.toISOString(),

    /**
     * Rate trouble only.
     *
     * An unknown total and a non-shipping store are *also* reasons an offer
     * cannot win, but `compareDeliveredOffers` counts those separately and
     * explains them in their own words. Folding them in here would make
     * `offersBlockedByExchangeRate` count offers with nothing wrong with their
     * exchange rate.
     */
    blocksCheapestClaim: productPriceConverted?.blocksCheapestClaim ?? true,
  };
}

/**
 * Convert one optional cost component.
 *
 * `known` distinguishes "the store published nothing" from "the store published
 * a figure we could not convert". Both give a null amount, and both must null the
 * delivered total, but only the first is honestly described as unpublished.
 */
function convertComponent(
  value: Prisma.Decimal | null,
  from: Currency,
  to: Currency,
  rates: RateContext,
): { known: boolean; money: Money | null } {
  if (value == null) return { known: false, money: null };

  const amount = moneyFromDecimal(value, from);
  if (amount == null) return { known: false, money: null };

  const outcome = convertWithProvenance(amount, to, rates.table, {
    maxAgeHours: rates.maxAgeHours,
    now: rates.now,
  });
  return { known: outcome.converted != null, money: outcome.converted };
}

/**
 * The stand-in for a product price that could not be read at all.
 *
 * Structurally valid and unmistakably not a price: zero, unconverted, and barred
 * from winning. Reachable only if a `Decimal(10,2)` column holds something that
 * is not a decimal, which the schema does not permit — it exists so that a
 * corrupt row degrades to a visibly incomparable offer instead of a 500.
 */
function unparseableAmount(currency: Currency): ConvertedMoneyDto {
  const zero = toMoneyAmount({ minorUnits: 0, currency });
  return {
    original: zero,
    converted: null,
    status: 'rate-unusable',
    exchangeRate: null,
    exchangeRateTimestamp: null,
    rateAgeHours: null,
    derivation: null,
    isEstimate: false,
    blocksCheapestClaim: true,
  };
}

export function toDestinationOffer(
  offer: StoreOfferRow,
  context: DeliveryMappingContext,
): DestinationOffer {
  return {
    id: offer.id,
    productId: offer.productId,
    store: toStoreSummary(offer.store),
    // The listing's own URL, so a row can link to the product rather than the
    // retailer's front page — which is what it fell back to before this existed.
    productUrl: offer.product.productUrl,
    // Resolved to the weaker of the two: a quote is never more trustworthy than
    // the listing it quotes, so a verified quote cannot lift a fixture-seeded URL
    // into something safe to open.
    dataSourceType: leastTrustedDataSource(offer.dataSourceType, offer.product.dataSourceType),
    // Never conditional. A fictional retailer is disclosed on every surface that
    // shows one, so the UI can label the catalogue and the prices as synthetic.
    isDemoStore: offer.store.isDemoStore,
    delivery: toDeliveryToDestination(offer, context),
  };
}

/**
 * The projection `compareDeliveredOffers` and `sortDeliveredOffers` rank.
 *
 * Kept as a separate step so the ranking rules stay in the shared package, where
 * both the API and the browser can apply them and reach the same answer.
 */
export function toDeliveredSortable(
  offer: DestinationOffer,
  extra: { discountPercent: number; dealQualityScore: number },
): DeliveredSortableOffer {
  const { delivery } = offer;
  return {
    id: offer.id,
    storeName: offer.store.name,
    shipsToDestination: delivery.shipsToDestination,
    deliveredMinorUnits: delivery.totalDeliveredPrice?.minorUnits ?? null,
    listedMinorUnits: delivery.productPrice.converted?.minorUnits ?? null,
    availability: delivery.availability,
    blocksCheapestClaim: delivery.blocksCheapestClaim,
    deliveryMaxDays: delivery.deliveryMaxDays,
    discountPercent: extra.discountPercent,
    lastCheckedAt: delivery.lastCheckedAt,
    dealQuality: { score: extra.dealQualityScore },
  };
}

/** Wrap a shared comparison result in its destination and currency. */
export function toDeliveredComparison(
  result: DeliveredComparisonResult,
  destinationCountry: CountryCode,
  displayCurrency: Currency,
): DeliveredComparison {
  const amount = (minorUnits: number | null) =>
    minorUnits == null ? null : toMoneyAmount({ minorUnits, currency: displayCurrency });

  return {
    destinationCountry,
    destinationCountryName: countryName(destinationCountry),
    displayCurrency,
    lowestDeliveredPrice: amount(result.lowestDeliveredMinorUnits),
    highestDeliveredPrice: amount(result.highestDeliveredMinorUnits),
    lowestListedPrice: amount(result.lowestListedMinorUnits),
    cheapestDeliveredOfferId: result.cheapestDeliveredOfferId,
    cheapestDeliveredCaveats: result.cheapestDeliveredCaveats,
    storesShippingToDestination: result.storesShippingToDestination,
    offersWithUnknownShipping: result.offersWithUnknownShipping,
    offersNotShippingToDestination: result.offersNotShippingToDestination,
    offersBlockedByExchangeRate: result.offersBlockedByExchangeRate,
  };
}

/**
 * A store, with what it *declares* and what it can actually be shown to do.
 *
 * `declaredDeliveryCountries` and `offersToCountry` are both present on purpose,
 * named so they cannot be confused: the first is the store's own claim, the
 * second is counted from offers and is the only one that supports saying a
 * product can be delivered.
 */
export function toStoreWithDelivery(
  store: OfferStoreRow,
  offersToCountry: number | null,
): StoreWithDelivery {
  const countryCode = asCountryCode(store.countryCode);
  return {
    ...toStoreSummary(store),
    countryCode,
    countryName: countryCode == null ? null : countryName(countryCode),
    region: store.region as StoreWithDelivery['region'],
    declaredDeliveryCountries: store.supportedDeliveryCountries as CountryCode[],
    supportedCurrencies: store.supportedCurrencies as Currency[],
    vatRegistrationCountry: asCountryCode(store.vatRegistrationCountry),
    isDemoStore: store.isDemoStore,
    offersToCountry,
  };
}

/**
 * One recorded observation of a destination offer.
 *
 * Amounts stay in the currency they were recorded in and are never re-converted
 * at read time. The rate that was in force is returned alongside them, so a point
 * can be re-explained; recomputing it with today's rate would turn a currency
 * movement into an apparent price change, which is the specific confusion this
 * series stores both currencies to avoid.
 */
export function toDeliveredHistoryPoint(row: StoreOfferHistoryRow): DeliveredHistoryPoint {
  const currency = asCurrency(row.originalCurrency);
  const productPrice = moneyFromDecimal(row.productPrice, currency);
  const shipping = moneyFromDecimal(row.shippingPrice, currency);
  const tax = moneyFromDecimal(row.estimatedTax, currency);
  const duty = moneyFromDecimal(row.estimatedImportFees, currency);

  return {
    recordedAt: row.recordedAt.toISOString(),
    productPrice: toMoneyAmount(productPrice ?? { minorUnits: 0, currency }),
    shippingPrice: toMoneyAmountOrNull(shipping),
    // Recomputed from the recorded components rather than read from the stored
    // column, so a point's total and its breakdown cannot disagree — the same
    // reason the live mapper above recomputes rather than converts.
    totalDeliveredPrice: toMoneyAmountOrNull(
      productPrice == null || shipping == null
        ? null
        : addMoney(...[productPrice, shipping, tax, duty].filter((part): part is Money => part != null)),
    ),
    availability: row.availability,
    exchangeRate: row.exchangeRate == null ? null : Number(row.exchangeRate),
    exchangeRateTimestamp: row.exchangeRateTimestamp?.toISOString() ?? null,
  };
}
