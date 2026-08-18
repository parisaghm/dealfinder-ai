import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  makeCanonicalOffer,
  makeCanonicalProduct,
  makeComparison,
  makeDestinationOffer,
  makeLiveProduct,
  makeProduct,
} from '../../test/factories';
import { DealCta, DemoOfferNotice } from './DealCta';
import { GroupedProductCard } from './GroupedProductCard';
import { OfferComparisonTable } from './OfferComparisonTable';
import { ProductCard } from './ProductCard';

/**
 * The trust boundary, asserted per surface.
 *
 * The defect these tests exist for: the development catalogue is entirely sample
 * data, but three of its stores are named after real Finnish retailers and their
 * product URLs are synthetic ids on those retailers' real domains. A shopper
 * clicking "View deal" was shown an invented price attributed to a real shop and
 * then sent to a 404.
 *
 * So the claim under test is narrow and absolute: **no external retailer link is
 * rendered for an offer we did not fetch**, on any surface, whatever the store is
 * called. The positive case is asserted just as hard, because a gate that never
 * opens is also broken.
 */

const withRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

/** Every anchor that would take the shopper off-site. */
const externalLinks = () =>
  Array.from(document.querySelectorAll('a[target="_blank"]')) as HTMLAnchorElement[];

/** `\s` already covers the non-breaking spaces `Intl` emits, so one class suffices. */
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

/**
 * The three real Finnish retailers whose sample catalogues carry real domains.
 *
 * `productUrl` is exactly the shape `prisma/seed.ts` generates — the template from
 * each dataset with a synthetic `externalId` substituted in — so these fixtures
 * reproduce the actual seeded rows rather than an approximation of them.
 */
const FINNISH_DEMO_OFFERS = [
  {
    store: 'Gigantti',
    slug: 'gigantti',
    productUrl: 'https://www.gigantti.fi/product/gig-sony-wh1000xm5',
  },
  {
    store: 'Power',
    slug: 'power',
    productUrl: 'https://www.power.fi/tuote/pow-sony-wh1000xm5',
  },
  {
    store: 'Verkkokauppa.com',
    slug: 'verkkokauppa',
    productUrl: 'https://www.verkkokauppa.com/fi/product/vk-sony-wh1000xm5',
  },
] as const;

describe('the gate itself', () => {
  it.each(FINNISH_DEMO_OFFERS)(
    'renders no external link for a mock $store offer, though $store is a real retailer',
    ({ store, slug, productUrl }) => {
      const product = makeProduct({
        productUrl,
        dataSourceType: 'mock',
        store: {
          id: `store-${slug}`,
          slug,
          name: store,
          websiteUrl: `https://www.${slug}.fi`,
          logoUrl: null,
          isActive: true,
        },
      });

      withRouter(<ProductCard product={product} />);

      expect(externalLinks()).toHaveLength(0);
      // Not merely absent as an anchor — the retailer's URL must not appear as a
      // destination anywhere on the card.
      expect(document.body.innerHTML).not.toContain(productUrl);
      expect(screen.queryByRole('link', { name: /view deal/i })).not.toBeInTheDocument();
    },
  );

  it('renders no external link for a synthetic European demo store', () => {
    const product = makeProduct({
      productUrl: 'https://techhalle.example/produkt/th-lumenta-27',
      dataSourceType: 'mock',
      store: {
        id: 'store-techhalle',
        slug: 'techhalle',
        name: 'TechHalle GmbH',
        websiteUrl: 'https://techhalle.example',
        logoUrl: null,
        isActive: true,
      },
    });

    withRouter(<ProductCard product={product} isDemoStore />);

    expect(externalLinks()).toHaveLength(0);
    expect(screen.queryByRole('link', { name: /view deal/i })).not.toBeInTheDocument();
  });

  it('does render the external link for a verified live offer', () => {
    withRouter(<ProductCard product={makeLiveProduct()} />);

    const link = screen.getByRole('link', { name: /view deal/i });
    expect(link).toHaveAttribute('href', 'https://www.gigantti.fi/product/sony-wh-1000xm5');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  // The most important negative case: an unrecognised value is not a licence to
  // link. A future provider kind that nobody wired into the allow-list must be
  // treated as untrusted rather than trusted by accident.
  it('fails closed on an unknown source type', () => {
    withRouter(
      <ProductCard
        product={makeProduct({
          dataSourceType: 'LIVE_API',
          productUrl: 'https://www.gigantti.fi/product/real-looking',
        })}
      />,
    );

    expect(externalLinks()).toHaveLength(0);
    expect(screen.queryByRole('link', { name: /view deal/i })).not.toBeInTheDocument();
  });

  it('fails closed when the source is missing entirely', () => {
    withRouter(
      <DealCta
        offer={{ productUrl: 'https://www.gigantti.fi/product/x' }}
        storeName="Gigantti"
      />,
    );

    expect(externalLinks()).toHaveLength(0);
  });

  it('renders a disabled control, not a link, when there is nowhere internal to go', () => {
    withRouter(<DealCta offer={makeProduct()} storeName="Gigantti" />);

    const cta = screen.getByRole('button', { name: /demo offer/i });
    expect(cta).toBeDisabled();
    expect(cta).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('links inward when an internal destination is available', () => {
    withRouter(
      <DealCta offer={makeProduct()} storeName="Gigantti" internalTo="/products/product-1" />,
    );

    const link = screen.getByRole('link', { name: /view demo details/i });
    expect(link).toHaveAttribute('href', '/products/product-1');
    expect(link).not.toHaveAttribute('target');
  });
});

describe('the disclosure', () => {
  it('states plainly, in visible text, that a real retailer’s offer is sample data', () => {
    withRouter(<ProductCard product={makeProduct()} />);

    // Visible text, not a title attribute: a disclosure that needs hovering is
    // unreachable by touch and is not a disclosure.
    expect(screen.getByText(/Demo offer from Gigantti/i)).toBeVisible();
    expect(
      screen.getByText(
        /Demo data — this offer is illustrative and may not exist on the retailer's website\./i,
      ),
    ).toBeVisible();
  });

  it('shows no external-link icon alongside a demo CTA', () => {
    const { container } = withRouter(<ProductCard product={makeProduct()} />);

    // lucide renders an inline svg; the demo branches deliberately render none,
    // because the icon is the promise that a click leaves for the retailer.
    const cta = screen.getByRole('link', { name: /view demo details/i });
    expect(cta.querySelector('svg')).toBeNull();
    expect(container.querySelector('a[target="_blank"] svg')).toBeNull();
  });

  it('defers to the store-level notice when the retailer itself is fictional', () => {
    withRouter(<ProductCard product={makeProduct()} isDemoStore />);

    // One disclosure, not two stacked ones — the store-level notice is the
    // stronger statement and is rendered by DeliveryDetails.
    expect(screen.queryByTestId('demo-offer-notice')).not.toBeInTheDocument();
  });

  it('says the source is unverified, rather than calling it demo data', () => {
    withRouter(
      <DemoOfferNotice
        offer={{ dataSourceType: 'partner-xml', productUrl: 'https://www.power.fi/tuote/1' }}
        storeName="Power"
      />,
    );

    expect(screen.getByText(/Unverified source/i)).toBeVisible();
    expect(text()).toContain('Source not verified');
    // We are not claiming it is a sample; we are declining to vouch for it.
    expect(text()).not.toContain('Demo offer from');
  });

  it('discloses nothing when the offer is genuinely linkable', () => {
    withRouter(<ProductCard product={makeLiveProduct()} />);

    expect(screen.queryByTestId('demo-offer-notice')).not.toBeInTheDocument();
    expect(text()).not.toContain('illustrative');
  });
});

describe('the comparison and grouped surfaces follow the same rules', () => {
  const compareDefaults = {
    currency: 'EUR' as const,
    productName: 'Sony WH-1000XM5',
    sort: 'lowest-total' as const,
    onSortChange: () => undefined,
    comparison: makeComparison(),
  };

  it('renders no external link in the cross-store comparison for mock offers', () => {
    const offers = FINNISH_DEMO_OFFERS.map((entry, index) =>
      makeCanonicalOffer({
        id: `offer-${entry.slug}`,
        productUrl: entry.productUrl,
        dataSourceType: 'mock',
        store: {
          id: `store-${entry.slug}`,
          slug: entry.slug,
          name: entry.store,
          websiteUrl: `https://www.${entry.slug}.fi`,
          logoUrl: null,
          isActive: true,
        },
        currentPrice: 300 + index,
      }),
    );

    withRouter(<OfferComparisonTable {...compareDefaults} offers={offers} />);

    expect(externalLinks()).toHaveLength(0);
    for (const entry of FINNISH_DEMO_OFFERS) {
      expect(document.body.innerHTML).not.toContain(entry.productUrl);
    }
    // And it says why, once for the table rather than once per row.
    expect(screen.getByTestId('demo-offer-notice')).toBeVisible();
  });

  it('renders the external link in the cross-store comparison for a verified offer', () => {
    const offers = [
      makeCanonicalOffer({
        dataSourceType: 'api',
        productUrl: 'https://www.gigantti.fi/product/verified-1',
      }),
    ];

    withRouter(<OfferComparisonTable {...compareDefaults} offers={offers} />);

    expect(screen.getByRole('link', { name: /view deal/i })).toHaveAttribute(
      'href',
      'https://www.gigantti.fi/product/verified-1',
    );
  });

  it('renders no external link on a grouped card, and discloses the sample data', () => {
    const group = makeCanonicalProduct({
      bestOffer: makeProduct({
        dataSourceType: 'mock',
        productUrl: 'https://www.gigantti.fi/product/gig-sony-wh1000xm5',
      }),
    });

    withRouter(<GroupedProductCard group={group} />);

    expect(externalLinks()).toHaveLength(0);
    expect(screen.getByTestId('demo-offer-notice')).toBeVisible();
  });

  it('renders no external link in the delivered comparison for a mock destination offer', () => {
    // Guards the specific regression that this table used to link to the
    // retailer's *front page*, because its DTO carried no product URL at all.
    const offer = makeDestinationOffer({ dataSourceType: 'mock' });

    withRouter(<DealCta offer={offer} storeName={offer.store.name} appearance="compact" />);

    expect(externalLinks()).toHaveLength(0);
    expect(document.body.innerHTML).not.toContain(offer.store.websiteUrl);
  });
});
