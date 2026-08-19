import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The compare page's summary card.
 *
 * The regression: with a destination selected, the card headlined
 * `OfferComparison` — the destination-agnostic summary derived from
 * `Product.shippingPrice` — above a table built from `DeliveredComparison`. For
 * the seeded Auralis Buds Air group delivered to Germany the legacy summary is
 * all nulls, because none of the three demo listings publishes a legacy shipping
 * cost, so the page said
 *
 *   "No offer currently publishes both a price and a delivery cost, so no total
 *    can be compared."
 *
 * directly above three delivered totals and a row badged "Cheapest delivered
 * total", with "Current cheapest" and "Current spread" both showing an em dash.
 *
 * Mocked at the transport rather than at the hooks, so the real query hooks and
 * the real `summariseDeliveredOffers` wiring are exercised — the claim under test
 * is that the summary and the table read from one payload, which is a property of
 * the whole path rather than of the JSX.
 */

const canonicalProduct = vi.fn();
const canonicalOffers = vi.fn();
const canonicalHistory = vi.fn();
const productOffers = vi.fn();
const destinationHistory = vi.fn();

vi.mock('../lib/api-client', () => ({
  api: {
    canonicalProduct: (...args: unknown[]) => canonicalProduct(...args),
    canonicalOffers: (...args: unknown[]) => canonicalOffers(...args),
    canonicalHistory: (...args: unknown[]) => canonicalHistory(...args),
    productOffers: (...args: unknown[]) => productOffers(...args),
    destinationHistory: (...args: unknown[]) => destinationHistory(...args),
  },
  ApiRequestError: class ApiRequestError extends Error {
    readonly status: number;
    constructor(status: number, _code: string, message: string) {
      super(message);
      this.name = 'ApiRequestError';
      this.status = status;
    }
    get isRetryable(): boolean {
      return this.status === 0 || this.status >= 500;
    }
  },
}));

const {
  makeCanonicalProduct,
  makeComparison,
  makeDelivery,
  makeDestinationOffer,
  makeDeliveredComparison,
  makeMoneyAmount,
  makeOfferTrio,
  makeUnknownShippingDelivery,
} = await import('../test/factories');
const { DestinationProvider } = await import('../lib/destination');
const { CompareProductPage } = await import('./CompareProductPage');

const CANONICAL_ID = 'canon-auralis';

/** Kanaalshop 114,95 € · TechHalle 119 € · Adriatica 126,90 €, delivered to DE. */
function germanOffer(id: string, storeName: string, delivered: number) {
  return makeDestinationOffer({
    id,
    productId: `product-${id}`,
    isDemoStore: true,
    store: {
      id: `store-${id}`,
      slug: id,
      name: storeName,
      websiteUrl: `https://${id}.test`,
      logoUrl: null,
      isActive: true,
    },
    delivery: makeDelivery({
      destinationCountry: 'DE',
      destinationCountryName: 'Germany',
      totalDeliveredPrice: makeMoneyAmount(delivered),
      productPrice: {
        original: makeMoneyAmount(delivered),
        converted: makeMoneyAmount(delivered),
        status: 'same-currency',
        exchangeRate: null,
        exchangeRateTimestamp: null,
        rateAgeHours: null,
        derivation: null,
        isEstimate: false,
        blocksCheapestClaim: false,
      },
    }),
  });
}

const KANAALSHOP = germanOffer('kanaalshop', 'Kanaalshop B.V.', 114.95);
const TECHHALLE = germanOffer('techhalle', 'TechHalle GmbH', 119);
const ADRIATICA = germanOffer('adriatica', 'Adriatica Tech S.r.l.', 126.9);

const GERMAN_COMPARISON = makeDeliveredComparison({
  destinationCountry: 'DE',
  destinationCountryName: 'Germany',
  displayCurrency: 'EUR',
  lowestDeliveredPrice: makeMoneyAmount(114.95),
  highestDeliveredPrice: makeMoneyAmount(126.9),
  lowestListedPrice: makeMoneyAmount(109),
  cheapestDeliveredOfferId: 'kanaalshop',
  storesShippingToDestination: 3,
  offersWithUnknownShipping: 0,
});

/**
 * The legacy summary as the API really returns it for this group.
 *
 * Every total-derived field is null, because the three listings publish no
 * `Product.shippingPrice`. This is the payload that used to write the page's
 * headline, and it is left in place deliberately: the fix is that the page stops
 * reading it in destination mode, not that the payload changed.
 */
const LEGACY_COMPARISON = makeComparison({
  lowestPrice: 109,
  highestPrice: 119,
  lowestTotalPrice: null,
  highestTotalPrice: null,
  cheapestTotalOfferId: null,
  cheapestTotalCaveat: '3 offers do not publish a delivery cost, so their total cannot be compared.',
  priceSpread: null,
  priceSpreadPercent: null,
});

function renderPage({ destination = true }: { destination?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const url = destination
    ? `/compare/${CANONICAL_ID}?country=DE&currency=EUR&region=european`
    : `/compare/${CANONICAL_ID}`;

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <DestinationProvider>
          <Routes>
            <Route path="/compare/:id" element={<CompareProductPage />} />
          </Routes>
        </DestinationProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The summary card's own figures, by test id, so the table cannot be read instead. */
const summaryCheapest = () => within(screen.getByTestId('summary-cheapest')).getByText(/€|—/);
const summarySpread = () => within(screen.getByTestId('summary-spread')).getByText(/€|—/);

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();

  // `makeCanonicalProduct` builds the summary; the detail endpoint extends it with
  // specifications, offers and the legacy comparison.
  canonicalProduct.mockResolvedValue({
    ...makeCanonicalProduct({
      id: CANONICAL_ID,
      name: 'Auralis Buds Air Earphones',
      currency: 'EUR',
    }),
    specifications: {},
    offers: makeOfferTrio(),
    comparison: LEGACY_COMPARISON,
  });
  canonicalOffers.mockResolvedValue({
    offers: makeOfferTrio(),
    comparison: LEGACY_COMPARISON,
  });
  canonicalHistory.mockResolvedValue({ series: [], crossStoreLow: null });
  productOffers.mockResolvedValue({
    productId: 'product-kanaalshop',
    canonicalProductId: CANONICAL_ID,
    offers: [KANAALSHOP, TECHHALLE, ADRIATICA],
    unavailableHere: [],
    comparison: GERMAN_COMPARISON,
  });
  destinationHistory.mockResolvedValue({
    productId: 'product-kanaalshop',
    country: 'DE',
    currency: 'EUR',
    hasDestinationOffer: true,
    points: [],
  });
});

describe('the summary agrees with the delivered table', () => {
  it('does not deny a total that the table is showing', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId('summary-headline')).toBeInTheDocument());

    // The exact sentence the bug report quoted, in either of its two forms.
    expect(screen.queryByText(/no total can be compared/i)).toBeNull();
    expect(screen.queryByText(/no delivered total can be compared/i)).toBeNull();
  });

  it('headlines the winner the table badges, with its delivered total', async () => {
    renderPage();

    const headline = await screen.findByTestId('summary-headline');
    expect(headline).toHaveTextContent('Kanaalshop B.V.');
    expect(headline).toHaveTextContent('114,95');
    expect(headline).toHaveTextContent(/3 comparable offers deliver to Germany/i);
  });

  it('shows the same cheapest figure in the summary tile as the badged row', async () => {
    renderPage();

    await waitFor(() => expect(summaryCheapest()).toHaveTextContent('114,95'));

    const badgedRow = screen.getByRole('row', { name: /cheapest delivered total/i });
    expect(badgedRow).toHaveTextContent('Kanaalshop B.V.');
    expect(badgedRow).toHaveTextContent('114,95');
  });

  it('spreads across the comparable delivered totals only', async () => {
    renderPage();

    // 126,90 − 114,95 = 11,95, and 11,95 / 114,95 rounds to 10%.
    await waitFor(() => expect(summarySpread()).toHaveTextContent('11,95'));
    expect(screen.getByTestId('summary-spread')).toHaveTextContent('10% between stores');
  });

  it('leaves exactly one "Cheapest delivered total" on the page', async () => {
    renderPage();

    await screen.findByTestId('summary-headline');

    // The badge identifies the crowned row and the end-to-end suite counts it.
    // The summary must not add a second copy of that exact string.
    expect(screen.getAllByText('Cheapest delivered total')).toHaveLength(1);
  });
});

describe('unknown shipping does not enter the summary', () => {
  it('excludes it from the comparable count and from the spread', async () => {
    const unpublished = makeDestinationOffer({
      id: 'iberica',
      productId: 'product-iberica',
      store: {
        id: 'store-iberica',
        slug: 'iberica',
        name: 'Ibérica Digital S.L.',
        websiteUrl: 'https://iberica.test',
        logoUrl: null,
        isActive: true,
      },
      delivery: { ...makeUnknownShippingDelivery(), destinationCountry: 'DE' },
    });

    productOffers.mockResolvedValue({
      productId: 'product-kanaalshop',
      canonicalProductId: CANONICAL_ID,
      offers: [KANAALSHOP, TECHHALLE, ADRIATICA, unpublished],
      unavailableHere: [],
      comparison: makeDeliveredComparison({
        ...GERMAN_COMPARISON,
        storesShippingToDestination: 4,
        offersWithUnknownShipping: 1,
      }),
    });

    renderPage();

    const headline = await screen.findByTestId('summary-headline');
    expect(headline).toHaveTextContent(/3 comparable offers deliver to Germany/i);
    // Still the winner's total and still the three-offer spread.
    expect(headline).toHaveTextContent('114,95');
    await waitFor(() => expect(summarySpread()).toHaveTextContent('11,95'));
  });
});

describe('a stale exchange rate is not a guaranteed winner', () => {
  it('headlines the crowned offer rather than the cheaper stale-rate one', async () => {
    // The API passed over Kanaalshop's 114,95 € and crowned TechHalle at 119 €.
    productOffers.mockResolvedValue({
      productId: 'product-kanaalshop',
      canonicalProductId: CANONICAL_ID,
      offers: [KANAALSHOP, TECHHALLE, ADRIATICA],
      unavailableHere: [],
      comparison: makeDeliveredComparison({
        ...GERMAN_COMPARISON,
        cheapestDeliveredOfferId: 'techhalle',
        offersBlockedByExchangeRate: 1,
        cheapestDeliveredCaveats: [
          {
            kind: 'cheaper-offer-skipped',
            amountMinorUnits: 11495,
            storeName: 'Kanaalshop B.V.',
            reason: 'stale-rate',
          },
        ],
      }),
    });

    renderPage();

    const headline = await screen.findByTestId('summary-headline');
    expect(headline).toHaveTextContent('TechHalle GmbH');
    expect(headline).toHaveTextContent('119');
    expect(headline).not.toHaveTextContent('114,95');

    // And the tile agrees with the badge rather than with the lowest figure.
    await waitFor(() => expect(summaryCheapest()).toHaveTextContent('119'));
    expect(screen.getByRole('row', { name: /cheapest delivered total/i })).toHaveTextContent(
      'TechHalle GmbH',
    );
  });
});

describe('no comparable delivered total', () => {
  it('says so, and shows no figures it cannot stand behind', async () => {
    productOffers.mockResolvedValue({
      productId: 'product-kanaalshop',
      canonicalProductId: CANONICAL_ID,
      offers: [],
      unavailableHere: [],
      comparison: makeDeliveredComparison({
        destinationCountry: 'DE',
        destinationCountryName: 'Germany',
        lowestDeliveredPrice: null,
        highestDeliveredPrice: null,
        lowestListedPrice: null,
        cheapestDeliveredOfferId: null,
        storesShippingToDestination: 0,
        offersNotShippingToDestination: 2,
      }),
    });

    renderPage();

    const headline = await screen.findByTestId('summary-headline');
    expect(headline).toHaveTextContent(/no delivered total can be compared/i);
    expect(headline).toHaveTextContent(/Germany/);

    await waitFor(() => expect(summaryCheapest()).toHaveTextContent('—'));
    expect(summarySpread()).toHaveTextContent('—');
  });
});

describe('without a destination the legacy summary is untouched', () => {
  it('still reads "Cheapest total … at <store>" from the legacy comparison', async () => {
    const trio = makeOfferTrio();
    canonicalOffers.mockResolvedValue({
      offers: trio,
      comparison: makeComparison({
        lowestTotalPrice: 329,
        priceSpread: 12.9,
        priceSpreadPercent: 3.92,
        cheapestTotalOfferId: trio[0]!.id,
      }),
    });

    renderPage({ destination: false });

    // Scoped to the paragraph, because the legacy table badges its winning row
    // "Cheapest total" too — which is why the end-to-end suite matches this with
    // `page.locator('p').filter({ hasText: /^Cheapest total/ })`.
    await waitFor(() =>
      expect(screen.getByText(/^Cheapest total/, { selector: 'p' })).toHaveTextContent(
        trio[0]!.store.name,
      ),
    );
    expect(screen.queryByTestId('summary-headline')).toBeNull();
    expect(productOffers).not.toHaveBeenCalled();
  });
});
