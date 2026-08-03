import { describe, expect, it } from 'vitest';
import { mapSchemaAvailability, parseStructuredProduct } from './structured-data';

const page = (jsonLd: unknown, extra = '') => `
<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
${extra}
</head><body></body></html>`;

describe('parseStructuredProduct', () => {
  it('reads a straightforward Product + Offer', () => {
    const result = parseStructuredProduct(
      page({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Sony WH-1000XM5',
        sku: 'SONY-XM5',
        brand: { '@type': 'Brand', name: 'Sony' },
        description: 'Noise cancelling headphones',
        image: ['https://cdn.test/xm5.jpg'],
        offers: {
          '@type': 'Offer',
          price: '329.00',
          priceCurrency: 'EUR',
          availability: 'https://schema.org/InStock',
        },
      }),
    );

    expect(result).toMatchObject({
      name: 'Sony WH-1000XM5',
      sku: 'SONY-XM5',
      brand: 'Sony',
      image: 'https://cdn.test/xm5.jpg',
      price: 329,
      currency: 'EUR',
      availability: 'IN_STOCK',
    });
  });

  it('finds a Product nested inside an @graph', () => {
    const result = parseStructuredProduct(
      page({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebPage', name: 'Some page' },
          {
            '@type': 'Product',
            name: 'Nested product',
            offers: { '@type': 'Offer', price: 99.9, priceCurrency: 'EUR' },
          },
        ],
      }),
    );
    expect(result?.name).toBe('Nested product');
    expect(result?.price).toBe(99.9);
  });

  // Real pages ship several blocks; only one is the product.
  it('skips blocks that are not products', () => {
    const html = `
      <script type="application/ld+json">${JSON.stringify({ '@type': 'Organization', name: 'Store' })}</script>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        name: 'The product',
        offers: { '@type': 'Offer', price: '10', priceCurrency: 'EUR' },
      })}</script>`;
    expect(parseStructuredProduct(html)?.name).toBe('The product');
  });

  it('ignores a malformed block rather than failing the page', () => {
    const html = `
      <script type="application/ld+json">{ this is not json </script>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        name: 'Still found',
        offers: { '@type': 'Offer', price: '25', priceCurrency: 'EUR' },
      })}</script>`;
    expect(parseStructuredProduct(html)?.name).toBe('Still found');
  });

  it.each([
    { price: '1 099,00', expected: 1099 },
    { price: '1.099,00', expected: 1099 },
    { price: '1,099.00', expected: 1099 },
    { price: '329', expected: 329 },
    { price: '24,90 €', expected: 24.9 },
  ])('parses the price "$price" as $expected', ({ price, expected }) => {
    const result = parseStructuredProduct(
      page({ '@type': 'Product', name: 'x', offers: { '@type': 'Offer', price } }),
    );
    expect(result?.price).toBe(expected);
  });

  it('reads a published shipping rate', () => {
    const result = parseStructuredProduct(
      page({
        '@type': 'Product',
        name: 'x',
        offers: {
          '@type': 'Offer',
          price: '50',
          priceCurrency: 'EUR',
          shippingDetails: {
            '@type': 'OfferShippingDetails',
            shippingRate: { '@type': 'MonetaryAmount', value: '5.90', currency: 'EUR' },
          },
        },
      }),
    );
    expect(result?.shippingPrice).toBe(5.9);
  });

  // A product page with no price is useless for price tracking, and silently
  // returning a priceless record would poison the database.
  it('returns null when there is no price', () => {
    expect(
      parseStructuredProduct(page({ '@type': 'Product', name: 'No price here' })),
    ).toBeNull();
  });

  it('returns null when there is no JSON-LD at all', () => {
    expect(parseStructuredProduct('<html><body>nothing</body></html>')).toBeNull();
  });

  it('handles an array of types', () => {
    const result = parseStructuredProduct(
      page({
        '@type': ['Product', 'IndividualProduct'],
        name: 'Multi-typed',
        offers: { '@type': 'Offer', price: '10' },
      }),
    );
    expect(result?.name).toBe('Multi-typed');
  });
});

describe('mapSchemaAvailability', () => {
  it.each([
    ['https://schema.org/InStock', 'IN_STOCK'],
    ['http://schema.org/OutOfStock', 'OUT_OF_STOCK'],
    ['https://schema.org/LimitedAvailability', 'LOW_STOCK'],
    ['https://schema.org/PreOrder', 'PREORDER'],
    ['https://schema.org/SoldOut', 'OUT_OF_STOCK'],
    ['https://schema.org/Discontinued', 'DISCONTINUED'],
    ['https://schema.org/SomethingNew', 'UNKNOWN'],
  ])('maps %s to %s', (input, expected) => {
    expect(mapSchemaAvailability(input)).toBe(expected);
  });

  it('returns undefined for a missing value', () => {
    expect(mapSchemaAvailability(undefined)).toBeUndefined();
    expect(mapSchemaAvailability(null)).toBeUndefined();
  });
});
