import type { MockStoreDataset } from '../types';
import { DEMO_EAN } from './demo-catalogue';

/**
 * Kanaalshop B.V. â€” FICTIONAL DEMO STORE (Netherlands).
 *
 * Not a real retailer. Every product, price, delivery cost and delivery estimate
 * here is invented. See `demo-catalogue.ts`.
 *
 * Its role in the headline comparison is to be the *dearer listing with free
 * delivery* â€” â‚¬329 delivered to Finland at no extra cost, against TechHalle's â‚¬299
 * plus â‚¬12.90. The Dutch store loses by â‚¬17.10, which is only visible once
 * delivery is counted. Sorting on list price alone puts it third.
 *
 * It also declares Belgium, a country that is modelled but not selectable as a
 * destination. That is deliberate: a store's real delivery network does not stop
 * at the edge of what this application currently offers, and the data should not
 * pretend otherwise.
 */
export const kanaalshopDataset: MockStoreDataset = {
  slug: 'kanaalshop',
  name: 'Kanaalshop B.V. (demo)',
  websiteUrl: 'https://kanaalshop.example',
  logoUrl: null,
  productUrlTemplate: 'https://kanaalshop.example/product/{id}',

  countryCode: 'NL',
  currency: 'EUR',
  supportedCurrencies: ['EUR'],
  region: 'european',
  vatRegistrationCountry: 'NL',
  isDemoStore: true,

  deliveryRules: {
    NL: { shippingPrice: 0, minDays: 1, maxDays: 2 },
    DE: { shippingPrice: 5.95, minDays: 2, maxDays: 4 },
    // Modelled but not a selectable destination â€” no offers are generated for it.
    BE: { shippingPrice: 4.95, minDays: 1, maxDays: 3 },
    FR: { shippingPrice: 7.95, minDays: 2, maxDays: 5 },
    // Free to Finland, which is what makes the delivered comparison interesting.
    FI: { shippingPrice: 0, minDays: 4, maxDays: 8 },
    DK: { shippingPrice: 6.95, minDays: 3, maxDays: 6 },
  },

  products: [
    {
      externalId: 'kns-auralis-nc700',
      name: 'Auralis NC 700 Wireless Headphones',
      brand: 'Auralis',
      category: 'headphones',
      description:
        'Demo listing. Over-ear wireless headphones with active noise cancelling. Free delivery to Finland.',
      currentPrice: 329,
      originalPrice: 389,
      ean: DEMO_EAN.auralisNc700,
      modelNumber: 'NC700',
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'kns-nordkraft-ultra-14',
      name: 'Nordkraft Ultra 14 Laptop',
      brand: 'Nordkraft',
      category: 'laptops',
      description: 'Demo listing. 14-inch ultraportable, 16 GB RAM, 512 GB SSD.',
      currentPrice: 979,
      ean: DEMO_EAN.nordkraftUltra14,
      modelNumber: 'ULTRA14-512',
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'kns-sonaris-flow-2',
      name: 'Sonaris Flow 2 Portable Speaker',
      brand: 'Sonaris',
      category: 'speakers',
      description: 'Demo listing. Waterproof portable speaker, 18-hour battery.',
      currentPrice: 139,
      originalPrice: 179,
      ean: DEMO_EAN.sonarisFlow2,
      history: { pattern: 'declining', days: 90 },
    },
    {
      externalId: 'kns-pixmo-tab-11',
      name: 'Pixmo Tab 11 Tablet',
      brand: 'Pixmo',
      category: 'tablets',
      description: 'Demo listing. 11-inch tablet, 128 GB.',
      currentPrice: 315,
      originalPrice: 359,
      ean: DEMO_EAN.pixmoTab11,
      history: { pattern: 'dropped-to-low', days: 90 },
    },
    {
      externalId: 'kns-voltaro-140',
      name: 'Voltaro 140 W GaN Charger',
      brand: 'Voltaro',
      category: 'accessories',
      description: 'Demo listing. Three-port 140 W GaN charger.',
      currentPrice: 74.9,
      ean: DEMO_EAN.voltaro140Charger,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'kns-auralis-buds-air',
      name: 'Auralis Buds Air Earphones',
      brand: 'Auralis',
      category: 'headphones',
      description: 'Demo listing. In-ear wireless earphones with noise cancelling.',
      currentPrice: 109,
      originalPrice: 149,
      ean: DEMO_EAN.auralisBudsAir,
      history: { pattern: 'declining', days: 90 },
    },
    {
      externalId: 'kns-lumenta-24-fhd',
      name: 'Lumenta 24" FHD Office Monitor',
      brand: 'Lumenta',
      category: 'monitors',
      description: 'Demo listing. 24-inch 1080p monitor with a height-adjustable stand.',
      currentPrice: 129,
      originalPrice: 159,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'kns-sonaris-home-200',
      name: 'Sonaris Home 200 Shelf Speaker',
      brand: 'Sonaris',
      category: 'speakers',
      description: 'Demo listing. Mains-powered shelf speaker with room correction.',
      currentPrice: 249,
      availability: 'PREORDER',
      history: { pattern: 'steady', days: 90 },
    },
  ],
};
