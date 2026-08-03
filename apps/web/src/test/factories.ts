import type {
  CanonicalOffer,
  CanonicalProductSummary,
  DealQuality,
  MatchCandidate,
  OfferComparisonDto,
  ProductSummary,
} from '@deal-finder/shared';

/**
 * Test data builders.
 *
 * Deep-partial overrides so a test states only the field it cares about — a
 * card test about the fake-discount warning should not have to restate a whole
 * product.
 */

export function makeDealQuality(overrides: Partial<DealQuality> = {}): DealQuality {
  return {
    score: 70,
    label: 'GOOD',
    headline: '€20 cheaper than its recorded average.',
    factors: [
      {
        key: 'discount',
        label: 'Advertised discount',
        weight: 30,
        score: 75,
        detail: 'Advertised as 30% off 200 €.',
      },
      {
        key: 'vs-average',
        label: 'Compared to its usual price',
        weight: 24,
        score: 60,
        detail: '20 € below its 160 € recorded average.',
      },
      {
        key: 'vs-lowest',
        label: 'Compared to its best price',
        weight: 24,
        score: 50,
        detail: '10 € above its recorded low of 130 €.',
      },
      { key: 'trend', label: 'Recent price direction', weight: 10, score: 55, detail: 'Unchanged.' },
      { key: 'shipping', label: 'Delivery cost', weight: 6, score: 100, detail: 'Free delivery.' },
      { key: 'availability', label: 'Availability', weight: 6, score: 100, detail: 'In stock now.' },
    ],
    confidence: 'HIGH',
    claimedDiscountTrustworthy: true,
    warnings: [],
    disclaimer: 'Deal quality is an automated heuristic, not financial advice.',
    ...overrides,
  };
}

export function makeProduct(overrides: Partial<ProductSummary> = {}): ProductSummary {
  const now = new Date().toISOString();

  return {
    id: 'product-1',
    externalId: 'ext-1',
    name: 'Sony WH-1000XM5 Headphones',
    brand: 'Sony',
    category: 'headphones',
    vertical: 'electronics',
    imageUrl: '/images/products/headphones.svg',
    productUrl: 'https://store.test/p/ext-1',
    store: {
      id: 'store-1',
      slug: 'gigantti',
      name: 'Gigantti',
      websiteUrl: 'https://www.gigantti.fi',
      logoUrl: null,
      isActive: true,
    },
    currency: 'EUR',
    currentPrice: 140,
    originalPrice: 200,
    shippingPrice: 0,
    discountPercent: 30,
    effectivePrice: 140,
    availability: 'IN_STOCK',
    lastCheckedAt: now,
    createdAt: now,
    updatedAt: now,
    priceStatistics: {
      lowest: 130,
      highest: 200,
      average: 160,
      latestPrice: 140,
      previousPrice: 150,
      sampleSize: 30,
      firstRecordedAt: now,
      lastRecordedAt: now,
    },
    dealQuality: makeDealQuality(),
    isTracked: false,
    ...overrides,
  };
}

// ── Cross-store matching ────────────────────────────────────────────────────

/**
 * The seeded Sony trio, and the reason the feature exists: the store with the
 * lowest listed price is not the store that costs least to buy from.
 *
 *   Gigantti       329 + 0     = 329     ← cheapest total
 *   Verkkokauppa   319 + 12,90 = 331,90  ← cheapest listed
 *   Power          339 + 0     = 339
 */
export function makeCanonicalOffer(overrides: Partial<CanonicalOffer> = {}): CanonicalOffer {
  const base = makeProduct();
  return {
    ...base,
    totalPrice: base.currentPrice,
    match: {
      method: 'IDENTIFIER',
      score: 100,
      matchedAt: base.lastCheckedAt,
      explanation: 'Grouped because this listing publishes the same product identifier.',
    },
    isLowestPrice: false,
    isLowestTotalPrice: false,
    isBestDealQuality: false,
    priceDifferenceVsLowest: 0,
    priceDifferenceVsLowestPercent: 0,
    ...overrides,
  };
}

export function makeOfferTrio(): CanonicalOffer[] {
  return [
    makeCanonicalOffer({
      id: 'offer-gigantti',
      currentPrice: 329,
      shippingPrice: 0,
      effectivePrice: 329,
      totalPrice: 329,
      isLowestTotalPrice: true,
      store: { ...makeProduct().store, id: 'store-g', slug: 'gigantti', name: 'Gigantti' },
    }),
    makeCanonicalOffer({
      id: 'offer-verkkokauppa',
      currentPrice: 319,
      shippingPrice: 12.9,
      effectivePrice: 331.9,
      totalPrice: 331.9,
      isLowestPrice: true,
      store: {
        ...makeProduct().store,
        id: 'store-v',
        slug: 'verkkokauppa',
        name: 'Verkkokauppa.com',
      },
    }),
    makeCanonicalOffer({
      id: 'offer-power',
      currentPrice: 339,
      shippingPrice: 0,
      effectivePrice: 339,
      totalPrice: 339,
      store: { ...makeProduct().store, id: 'store-p', slug: 'power', name: 'Power' },
    }),
  ];
}

export function makeComparison(overrides: Partial<OfferComparisonDto> = {}): OfferComparisonDto {
  return {
    lowestPrice: 319,
    highestPrice: 339,
    lowestTotalPrice: 329,
    highestTotalPrice: 339,
    cheapestTotalOfferId: 'offer-gigantti',
    cheapestTotalCaveat: null,
    priceSpread: 10,
    priceSpreadPercent: 3,
    savingsAgainstHighest: 20,
    savingsPercentAgainstHighest: 5.9,
    ...overrides,
  };
}

export function makeCanonicalProduct(
  overrides: Partial<CanonicalProductSummary> = {},
): CanonicalProductSummary {
  const now = new Date().toISOString();
  return {
    id: 'canonical-1',
    name: 'Sony WH-1000XM5',
    brand: 'Sony',
    category: 'headphones',
    vertical: 'electronics',
    imageUrl: '/images/products/headphones.svg',
    identifiers: { gtin: '04548736132443', ean: '4548736132443', mpn: null, modelNumber: 'WH1000XM5' },
    offerCount: 3,
    storeCount: 3,
    storeSlugs: ['gigantti', 'power', 'verkkokauppa'],
    currency: 'EUR',
    lowestPrice: 319,
    highestPrice: 339,
    lowestEffectivePrice: 329,
    highestEffectivePrice: 339,
    priceSpread: 10,
    savingsAgainstHighest: 20,
    savingsPercentAgainstHighest: 5.9,
    bestOffer: makeProduct({ id: 'offer-gigantti', currentPrice: 329, effectivePrice: 329 }),
    matchConfidence: 'HIGH',
    variantNotes: [],
    pendingCandidateCount: 0,
    updatedAt: now,
    ...overrides,
  };
}

export function makeMatchCandidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  const now = new Date().toISOString();
  return {
    id: 'candidate-1',
    score: 68,
    confidence: 'MEDIUM',
    status: 'PENDING',
    explanation: {
      score: 68,
      confidence: 'MEDIUM',
      method: 'NAME',
      engineVersion: '1.0.0',
      reasons: [
        {
          key: 'brand',
          label: 'Brand',
          detail: 'Both listings are branded samsung.',
          weight: 20,
          score: 100,
        },
      ],
      conflicts: [
        {
          key: 'factor:model',
          label: 'Model number',
          detail: 'Model numbers disagree: Q70D versus QE65Q70DATXXC.',
          severity: 'REVIEWABLE',
        },
      ],
    },
    createdAt: now,
    reviewedAt: null,
    reviewedBy: null,
    note: null,
    sourceProduct: {
      id: 'product-source',
      name: 'Samsung QE65Q70DATXXC 65" QLED 4K Smart TV',
      brand: 'Samsung',
      category: 'televisions',
      imageUrl: '/images/products/televisions.svg',
      identifiers: { gtin: null, ean: null, mpn: null, modelNumber: 'QE65Q70DATXXC' },
      specifications: { 'Screen size': '65"', 'Energy class': 'E' },
      storeName: 'Verkkokauppa.com',
      storeSlug: 'verkkokauppa',
      productUrl: 'https://verkkokauppa.test/p/1',
      currentPrice: 949,
      currency: 'EUR',
    },
    candidateCanonicalProduct: {
      id: 'canonical-tv',
      name: 'Samsung 65" QLED Q70D -televisio',
      brand: 'Samsung',
      category: 'televisions',
      imageUrl: '/images/products/televisions.svg',
      identifiers: { gtin: null, ean: null, mpn: null, modelNumber: 'Q70D' },
      specifications: { 'Screen size': '65"', 'Energy class': 'F' },
      offerCount: 1,
    },
    ...overrides,
  };
}
