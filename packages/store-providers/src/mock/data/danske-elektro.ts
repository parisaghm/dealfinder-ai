import type { MockStoreDataset } from '../types';
import { DEMO_EAN } from './demo-catalogue';

/**
 * Danske Elektro A/S â€” FICTIONAL DEMO STORE (Denmark).
 *
 * Not a real retailer. Every product, price, delivery cost and delivery estimate
 * here is invented. See `demo-catalogue.ts`.
 *
 * The second currency store: it quotes in DKK. Having two non-euro stores matters
 * more than it looks, because it is what exercises rate *triangulation* â€” comparing
 * a Swedish offer against a Danish one in euros needs SEKâ†’EUR and EURâ†’DKK, and the
 * combined rate can only be as fresh as its stalest leg. One non-euro store would
 * never surface that.
 *
 * It is also the fastest route to Finland in the catalogue, which gives the
 * delivery-time filter something to actually select on: 1â€“3 days from Denmark
 * against 3â€“6 from Germany and unpublished from Sweden.
 */
export const danskeElektroDataset: MockStoreDataset = {
  slug: 'danske-elektro',
  name: 'Danske Elektro A/S (demo)',
  websiteUrl: 'https://danske-elektro.example',
  logoUrl: null,
  productUrlTemplate: 'https://danske-elektro.example/vare/{id}',

  countryCode: 'DK',
  currency: 'DKK',
  supportedCurrencies: ['DKK'],
  region: 'nordic',
  vatRegistrationCountry: 'DK',
  isDemoStore: true,

  deliveryRules: {
    DK: { shippingPrice: 39, freeOver: 500, minDays: 1, maxDays: 2 },
    SE: { shippingPrice: 59, minDays: 2, maxDays: 4 },
    DE: { shippingPrice: 79, minDays: 2, maxDays: 5 },
    NL: { shippingPrice: 89, minDays: 3, maxDays: 6 },
    // The quickest option to Finland in the whole catalogue.
    FI: { shippingPrice: 99, minDays: 1, maxDays: 3 },
  },

  products: [
    {
      externalId: 'dke-auralis-nc700',
      name: 'Auralis NC 700 Wireless Headphones',
      brand: 'Auralis',
      category: 'headphones',
      description:
        'Demo listing, priced in Danish kroner. Over-ear wireless headphones with active noise cancelling.',
      // â‰ˆ â‚¬308 at the seeded rate, plus 99 kr â‰ˆ â‚¬13.27 delivery to Finland.
      currentPrice: 2299,
      originalPrice: 2799,
      ean: DEMO_EAN.auralisNc700,
      modelNumber: 'NC700',
      history: { pattern: 'declining', days: 90 },
    },
    {
      externalId: 'dke-nordkraft-ultra-14',
      name: 'Nordkraft Ultra 14 Laptop',
      brand: 'Nordkraft',
      category: 'laptops',
      description: 'Demo listing, priced in Danish kroner. 14-inch ultraportable.',
      currentPrice: 7199,
      originalPrice: 8499,
      ean: DEMO_EAN.nordkraftUltra14,
      modelNumber: 'ULTRA14-512',
      history: { pattern: 'declining', days: 90 },
    },
    {
      externalId: 'dke-lumenta-27-qhd',
      name: 'Lumenta 27" QHD 165 Hz Monitor',
      brand: 'Lumenta',
      category: 'monitors',
      description: 'Demo listing, priced in Danish kroner. 27-inch 1440p at 165 Hz.',
      currentPrice: 2099,
      originalPrice: 2599,
      ean: DEMO_EAN.lumenta27Qhd,
      modelNumber: 'L27Q165',
      history: { pattern: 'volatile', days: 90 },
    },
    {
      externalId: 'dke-sonaris-flow-2',
      name: 'Sonaris Flow 2 Portable Speaker',
      brand: 'Sonaris',
      category: 'speakers',
      description: 'Demo listing, priced in Danish kroner. Waterproof portable speaker.',
      currentPrice: 999,
      originalPrice: 1299,
      ean: DEMO_EAN.sonarisFlow2,
      history: { pattern: 'declining', days: 90 },
    },
    {
      externalId: 'dke-voltaro-140',
      name: 'Voltaro 140 W GaN Charger',
      brand: 'Voltaro',
      category: 'accessories',
      description: 'Demo listing, priced in Danish kroner. Three-port 140 W GaN charger.',
      currentPrice: 519,
      ean: DEMO_EAN.voltaro140Charger,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'dke-pixmo-tab-11',
      name: 'Pixmo Tab 11 Tablet',
      brand: 'Pixmo',
      category: 'tablets',
      description: 'Demo listing, priced in Danish kroner. 11-inch tablet, 128 GB.',
      currentPrice: 2399,
      originalPrice: 2699,
      ean: DEMO_EAN.pixmoTab11,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'dke-auralis-buds-air',
      name: 'Auralis Buds Air Earphones',
      brand: 'Auralis',
      category: 'headphones',
      description: 'Demo listing, priced in Danish kroner. In-ear wireless earphones.',
      currentPrice: 849,
      originalPrice: 1099,
      ean: DEMO_EAN.auralisBudsAir,
      history: { pattern: 'dropped-to-low', days: 90 },
    },
    {
      externalId: 'dke-kestrel-action-8',
      name: 'Kestrel Action 8 Camera',
      brand: 'Kestrel',
      category: 'cameras',
      description: 'Demo listing, priced in Danish kroner. Waterproof action camera.',
      currentPrice: 2699,
      originalPrice: 3299,
      ean: DEMO_EAN.kestrelAction8,
      availability: 'LOW_STOCK',
      history: { pattern: 'rising', days: 90 },
    },
  ],
};
