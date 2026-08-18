import { formatMoney } from '@deal-finder/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SM_BREAKPOINT_QUERY } from '../../lib/use-media-query';
import {
  makeDelivery,
  makeDeliveredComparison,
  makeDestinationOffer,
  makeMoneyAmount,
  makeRateMissingDelivery,
  makeStaleRateDelivery,
  makeUnknownShippingDelivery,
  makeUnshippableDelivery,
} from '../../test/factories';
import { setViewportBreakpoints, setViewportMatches } from '../../test/setup';
import { DeliveredComparisonTable } from './DeliveredComparisonTable';

/**
 * The delivered comparison.
 *
 * The claim this component exists to make is "this row is cheapest once delivery
 * is counted", and the tests are ordered around the ways that claim can be wrong:
 * the cheapest *listed* offer winning by default, an unknown total winning by
 * being treated as zero, or a stale exchange rate winning by being treated as
 * current.
 *
 * The layout tests matter for a different reason. Three widths render from one
 * `COLUMNS` array through a JS media query, never as hidden duplicates — because
 * Playwright locators match hidden elements, so a second copy of every row would
 * trip strict mode across the whole page.
 */

const techhalle = makeDestinationOffer({
  id: 'offer-techhalle',
  store: {
    id: 'store-techhalle',
    slug: 'techhalle',
    name: 'TechHalle GmbH',
    websiteUrl: 'https://techhalle.test',
    logoUrl: null,
    isActive: true,
  },
  delivery: makeDelivery(),
});

const gigantti = makeDestinationOffer({
  id: 'offer-gigantti',
  store: {
    id: 'store-gigantti',
    slug: 'gigantti',
    name: 'Gigantti',
    websiteUrl: 'https://gigantti.test',
    logoUrl: null,
    isActive: true,
  },
  delivery: makeDelivery({
    sourceCountry: 'FI',
    sourceCountryName: 'Finland',
    productPrice: {
      original: makeMoneyAmount(329),
      converted: makeMoneyAmount(329),
      status: 'same-currency',
      exchangeRate: null,
      exchangeRateTimestamp: null,
      rateAgeHours: null,
      derivation: null,
      isEstimate: false,
      blocksCheapestClaim: false,
    },
    shippingPrice: makeMoneyAmount(0),
    totalDeliveredPrice: makeMoneyAmount(329),
    deliveryMinDays: 1,
    deliveryMaxDays: 2,
  }),
});

/** Cheapest sticker price of the three, and no delivered total at all. */
const nordbyte = makeDestinationOffer({
  id: 'offer-nordbyte',
  store: {
    id: 'store-nordbyte',
    slug: 'nordbyte',
    name: 'Nordbyte AB',
    websiteUrl: 'https://nordbyte.test',
    logoUrl: null,
    isActive: true,
  },
  isDemoStore: true,
  delivery: makeUnknownShippingDelivery(),
});

const OFFERS = [techhalle, gigantti, nordbyte];

const COMPARISON = makeDeliveredComparison({
  cheapestDeliveredOfferId: 'offer-techhalle',
  lowestDeliveredPrice: makeMoneyAmount(311.9),
  highestDeliveredPrice: makeMoneyAmount(329),
  lowestListedPrice: makeMoneyAmount(299),
  storesShippingToDestination: 3,
  offersWithUnknownShipping: 1,
});

// A router is required now: a sample offer's CTA is an internal link to the
// product page rather than an external anchor to a listing that does not exist.
function renderTable(props: Partial<Parameters<typeof DeliveredComparisonTable>[0]> = {}) {
  return render(
    <MemoryRouter>
      <DeliveredComparisonTable
        offers={OFFERS}
        comparison={COMPARISON}
        country="FI"
        currency="EUR"
        {...props}
      />
    </MemoryRouter>,
  );
}

/** Both breakpoints matched: the widest layout, all thirteen columns. */
function atDesktop() {
  setViewportBreakpoints(() => true);
}

/** `sm` matched but not `lg`: the same table with the reduced column set. */
function atMedium() {
  setViewportBreakpoints((query) => query === SM_BREAKPOINT_QUERY);
}

/** Below `sm`: the per-store card list. */
function atNarrow() {
  setViewportMatches(false);
}

describe('what the table says it is comparing', () => {
  it('names the destination and the currency before any number', () => {
    atDesktop();
    renderTable();

    expect(screen.getByTestId('comparison-destination')).toHaveTextContent(
      /Comparing delivered totals to Finland, in EUR\. 3 stores ship here\./,
    );
  });

  it('gives the table a caption stating the sort order', () => {
    atDesktop();
    renderTable();

    expect(screen.getByRole('table')).toHaveAccessibleName(
      /Offers for this product delivered to Finland, cheapest delivered total first/i,
    );
  });
});

describe('the winner is chosen by the delivered total', () => {
  it('badges the cheapest delivered row, not the cheapest listed one', () => {
    atDesktop();
    renderTable();

    const rows = screen.getAllByRole('row');
    const winner = rows.find((row) => within(row).queryByText('Cheapest delivered total'));

    expect(winner).toBeDefined();
    // TechHalle is €299 + €12.90 = €311.90; Nordbyte's sticker is lower but it
    // publishes no delivery cost, and Gigantti's total is €329.
    expect(within(winner!).getByText('TechHalle GmbH')).toBeInTheDocument();
    expect(within(winner!).getByTestId('delivered-price')).toHaveAttribute(
      'data-delivered',
      '311.9',
    );
  });

  it('badges exactly one row', () => {
    atDesktop();
    renderTable();
    expect(screen.getAllByText('Cheapest delivered total')).toHaveLength(1);
  });

  it('spells out that the cheapest listed price is not the cheapest delivered', () => {
    atDesktop();
    renderTable();

    expect(
      screen.getByText(/The lowest listed price is 299 € before delivery; the lowest delivered total is 311,90 €\./),
    ).toBeInTheDocument();
  });

  it('keeps the wording family of the pre-expansion table', () => {
    atDesktop();
    renderTable();
    // `cross-store.spec.ts` and `OfferComparisonTable.test.tsx` both match
    // /cheapest total/i, of which this badge's label is a superstring.
    expect(screen.getByText('Cheapest delivered total').textContent).toMatch(
      /cheapest delivered total/i,
    );
  });
});

describe('an unknown total cannot win', () => {
  it('renders it as Unknown, with no numeric hook', () => {
    atDesktop();
    renderTable();

    const rows = screen.getAllByRole('row');
    const row = rows.find((candidate) => within(candidate).queryByText('Nordbyte AB'));

    expect(within(row!).getByText('Unknown')).toBeInTheDocument();
    expect(within(row!).queryByTestId('delivered-price')).toBeNull();
    expect(within(row!).queryByText('Cheapest delivered total')).toBeNull();
  });

  it('never renders an unpublished delivery cost as free', () => {
    atDesktop();
    renderTable();

    const rows = screen.getAllByRole('row');
    const row = rows.find((candidate) => within(candidate).queryByText('Nordbyte AB'));

    expect(within(row!).getByText('Not published')).toBeInTheDocument();
    expect(within(row!).queryByText('Free')).toBeNull();
  });

  it('counts the excluded offers rather than dropping them silently', () => {
    atDesktop();
    renderTable();

    expect(
      screen.getByText(
        /1 offer does not publish a delivery cost, so it has no delivered total and cannot be the cheapest/i,
      ),
    ).toBeInTheDocument();
  });

  it('reports offers that do not ship there at all', () => {
    atDesktop();
    renderTable({
      comparison: makeDeliveredComparison({ offersNotShippingToDestination: 2 }),
    });

    expect(
      screen.getByText(/2 offers do not ship to Finland and are listed separately/i),
    ).toBeInTheDocument();
  });

  it('crowns nobody when no total can be computed at all', () => {
    atDesktop();
    renderTable({
      offers: [nordbyte],
      comparison: makeDeliveredComparison({
        cheapestDeliveredOfferId: null,
        lowestDeliveredPrice: null,
        highestDeliveredPrice: null,
        offersWithUnknownShipping: 1,
      }),
    });

    expect(screen.queryByText('Cheapest delivered total')).toBeNull();
    expect(
      screen.getByText(/No delivered total can be calculated for Finland yet, so no offer is shown as cheapest/i),
    ).toBeInTheDocument();
  });

  it('reports offers held back by a stale exchange rate', () => {
    atDesktop();
    renderTable({
      offers: [techhalle, makeDestinationOffer({ id: 'offer-dk', delivery: makeStaleRateDelivery() })],
      comparison: makeDeliveredComparison({ offersBlockedByExchangeRate: 1 }),
    });

    expect(
      screen.getByText(/1 offer is priced in a currency whose exchange rate is too old/i),
    ).toBeInTheDocument();
  });
});

describe('currency columns', () => {
  it('shows the store’s own amount alongside the converted one', () => {
    atDesktop();
    renderTable({
      offers: [makeDestinationOffer({ id: 'offer-se', delivery: makeStaleRateDelivery() })],
      comparison: makeDeliveredComparison({ cheapestDeliveredOfferId: null }),
    });

    // 1 990 as quoted in kroner, and the conversion flagged as an estimate.
    // Whitespace normalised because Intl groups with a non-breaking space.
    expect(screen.getByRole('table').textContent?.replace(/[\s\u00a0]+/g, ' ')).toContain('1 990');
    expect(screen.getByText(/Estimate · rate 10 days ago/)).toBeInTheDocument();
  });

  it('says "No rate" rather than showing a blank cell', () => {
    atDesktop();
    renderTable({
      offers: [makeDestinationOffer({ id: 'offer-se', delivery: makeRateMissingDelivery() })],
      comparison: makeDeliveredComparison({ cheapestDeliveredOfferId: null }),
    });

    expect(screen.getByText('No rate')).toBeInTheDocument();
  });
});

describe('offers that cannot reach the destination', () => {
  it('lists them, so "does not ship here" is visible rather than inferred from absence', () => {
    atDesktop();
    renderTable({
      unavailableHere: [
        makeDestinationOffer({
          id: 'offer-maison',
          store: {
            id: 'store-maison',
            slug: 'maison-numerique',
            name: 'Maison Numérique SAS',
            websiteUrl: 'https://maison.test',
            logoUrl: null,
            isActive: true,
          },
          delivery: makeUnshippableDelivery(),
        }),
      ],
    });

    const rows = screen.getAllByRole('row');
    const row = rows.find((candidate) => within(candidate).queryByText('Maison Numérique SAS'));
    expect(row).toBeDefined();
    expect(within(row!).queryByText('Cheapest delivered total')).toBeNull();
  });
});

/**
 * The caveat and the cell it refers to are the same number, so they must be the
 * same string. They were not: the sentence arrived from the API pre-formatted as
 * `265.90` and sat beside a table cell reading `265,90 €`, which looks like two
 * different prices to anyone not reading closely.
 */
describe('caveat formatting matches the table', () => {
  const skipped = makeDestinationOffer({
    id: 'offer-adriatica',
    store: {
      id: 'store-adriatica',
      slug: 'adriatica-tech',
      name: 'Adriatica Tech S.r.l.',
      websiteUrl: 'https://adriatica.test',
      logoUrl: null,
      isActive: true,
    },
    isDemoStore: true,
    delivery: makeDelivery({
      sourceCountry: 'IT',
      sourceCountryName: 'Italy',
      shippingPrice: makeMoneyAmount(0),
      totalDeliveredPrice: makeMoneyAmount(265.9),
      availability: 'OUT_OF_STOCK',
    }),
  });

  const comparison = makeDeliveredComparison({
    cheapestDeliveredOfferId: 'offer-techhalle',
    lowestDeliveredPrice: makeMoneyAmount(265.9),
    highestDeliveredPrice: makeMoneyAmount(311.9),
    storesShippingToDestination: 2,
    cheapestDeliveredCaveats: [
      {
        kind: 'cheaper-offer-skipped',
        amountMinorUnits: 26590,
        storeName: 'Adriatica Tech S.r.l.',
        reason: 'not-purchasable',
      },
    ],
  });

  it('writes a Finland / EUR caveat in the same localized currency format as the cell', () => {
    atDesktop();
    renderTable({ offers: [techhalle, skipped], comparison });

    const rows = screen.getAllByRole('row');
    const row = rows.find((candidate) => within(candidate).queryByText('Adriatica Tech S.r.l.'));
    const cell = within(row!).getByTestId('delivered-price').textContent ?? '';

    // Finnish decimal comma, and the separator before the symbol is whatever
    // `Intl` produced — a literal here would be a second money formatter.
    expect(cell.trim()).toBe(formatMoney(265.9, 'EUR', 'fi-FI'));
    expect(cell).toMatch(/265,90/);

    const caveat = screen.getByTestId('delivered-caveat').textContent ?? '';
    expect(caveat).toContain(cell.trim());
    expect(caveat).not.toContain('265.90');
    expect(caveat).toContain('Adriatica Tech S.r.l.');
    expect(caveat).toContain('not currently available to buy');
  });

  it('says nothing when the comparison needs no qualifying', () => {
    atDesktop();
    renderTable({
      offers: [techhalle, gigantti],
      comparison: makeDeliveredComparison({ cheapestDeliveredOfferId: 'offer-techhalle' }),
    });

    expect(screen.queryByTestId('delivered-caveat')).toBeNull();
  });
});

describe('one active DOM representation per breakpoint', () => {
  it('renders all thirteen columns at desktop width', () => {
    atDesktop();
    renderTable();

    const headers = within(screen.getByRole('table'))
      .getAllByRole('columnheader')
      .map((header) => header.textContent);

    expect(headers).toEqual([
      'Store',
      'Ships from',
      'Product price',
      'Store currency',
      'Converted',
      'Delivery',
      'Taxes',
      'Import charges',
      'Delivered total',
      'Delivery time',
      'Availability',
      'Last checked',
      'View deal',
    ]);
  });

  it('reduces to the load-bearing columns between sm and lg — the same table, not a second one', () => {
    atMedium();
    renderTable();

    // Exactly one table, so no hidden duplicate rows exist for a locator to find.
    expect(screen.getAllByRole('table')).toHaveLength(1);

    const headers = within(screen.getByRole('table'))
      .getAllByRole('columnheader')
      .map((header) => header.textContent);

    // Which store, what the product costs, what delivery costs, what the total is.
    expect(headers).toEqual([
      'Store',
      'Product price',
      'Delivery',
      'Delivered total',
      'Availability',
      'View deal',
    ]);
    // Every row is still one row.
    expect(screen.getAllByRole('row')).toHaveLength(1 + OFFERS.length);
  });

  it('becomes a card list below sm, with no table in the DOM at all', () => {
    atNarrow();
    renderTable();

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(OFFERS.length);
    // The winner is still named, and still exactly once.
    expect(screen.getAllByText('Cheapest delivered total')).toHaveLength(1);
  });

  it('carries the delivered totals into the narrow layout', () => {
    atNarrow();
    renderTable();

    const delivered = screen
      .getAllByTestId('delivered-price')
      .map((node) => node.getAttribute('data-delivered'));

    // Two offers have a total; Nordbyte's is unknown and so carries no value.
    expect(delivered).toEqual(['311.9', '329', null]);
  });

  it('keeps the demo-store disclosure at every width', () => {
    atDesktop();
    const desktop = renderTable();
    expect(screen.getByText('Demo store')).toBeInTheDocument();
    desktop.unmount();

    atNarrow();
    renderTable();
    expect(screen.getByTestId('demo-store-notice')).toBeInTheDocument();
  });

  // The badge names a category without defining it. Someone meeting "Demo store"
  // for the first time could reasonably read it as a retailer's brand, and every
  // price in those rows is invented — so the term is spelled out in text.
  it('defines what a demo store is, once, beneath the table', () => {
    atDesktop();
    renderTable();

    expect(screen.getByTestId('demo-store-footnote')).toHaveTextContent(
      'Nordbyte AB is a fictional retailer with synthetic prices, shown for demonstration only.',
    );
  });

  it('names every demo store in the footnote, including ones that cannot deliver here', () => {
    atDesktop();
    renderTable({
      unavailableHere: [
        makeDestinationOffer({
          id: 'offer-maison',
          isDemoStore: true,
          store: {
            id: 'store-maison',
            slug: 'maison-numerique',
            name: 'Maison Numérique SAS',
            websiteUrl: 'https://maison.test',
            logoUrl: null,
            isActive: true,
          },
          delivery: makeUnshippableDelivery(),
        }),
      ],
    });

    const footnote = screen.getByTestId('demo-store-footnote');
    expect(footnote).toHaveTextContent('Nordbyte AB, Maison Numérique SAS');
    expect(footnote).toHaveTextContent('are fictional retailers with synthetic prices');
  });

  it('says nothing about demo stores when every retailer is real', () => {
    atDesktop();
    renderTable({ offers: [techhalle, gigantti] });
    expect(screen.queryByTestId('demo-store-footnote')).toBeNull();
  });
});
