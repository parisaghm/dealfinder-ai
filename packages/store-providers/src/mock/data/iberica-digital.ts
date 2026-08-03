import type { MockStoreDataset } from '../types';
import { DEMO_EAN } from './demo-catalogue';

/**
 * IbÃ©rica Digital S.L. â€” FICTIONAL DEMO STORE (Spain).
 *
 * Not a real retailer. Every product, price, delivery cost and delivery estimate
 * here is invented. See `demo-catalogue.ts`.
 *
 * A second store that does not reach Finland, so the Finnish exclusion is not a
 * single special case that could pass by accident. Its network is southern and
 * western â€” Spain, France, Portugal, Italy â€” which is what a real regional
 * retailer's footprint tends to look like, and it means switching the destination
 * between Finland and Spain changes the visible catalogue in both directions
 * rather than only shrinking it.
 */
export const ibericaDigitalDataset: MockStoreDataset = {
  slug: 'iberica-digital',
  name: 'IbÃ©rica Digital S.L. (demo)',
  websiteUrl: 'https://iberica-digital.example',
  logoUrl: null,
  productUrlTemplate: 'https://iberica-digital.example/producto/{id}',

  countryCode: 'ES',
  currency: 'EUR',
  supportedCurrencies: ['EUR'],
  region: 'european',
  vatRegistrationCountry: 'ES',
  isDemoStore: true,

  deliveryRules: {
    ES: { shippingPrice: 3.95, freeOver: 40, minDays: 1, maxDays: 3 },
    FR: { shippingPrice: 8.95, minDays: 3, maxDays: 6 },
    // Modelled but not selectable.
    PT: { shippingPrice: 5.95, minDays: 2, maxDays: 4 },
    IT: { shippingPrice: 10.95, minDays: 4, maxDays: 7 },
    // FI, SE, DE, NL and DK are absent. Not delivered to.
  },

  products: [
    {
      externalId: 'ibd-lumenta-27-qhd',
      name: 'Lumenta 27" QHD 165 Hz Monitor',
      brand: 'Lumenta',
      category: 'monitors',
      description: 'Demo listing. 27-inch 1440p IPS gaming monitor at 165 Hz.',
      currentPrice: 289,
      originalPrice: 359,
      ean: DEMO_EAN.lumenta27Qhd,
      modelNumber: 'L27Q165',
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'ibd-auralis-nc700',
      name: 'Auralis NC 700 Wireless Headphones',
      brand: 'Auralis',
      category: 'headphones',
      description: 'Demo listing. Over-ear wireless headphones with active noise cancelling.',
      currentPrice: 315,
      originalPrice: 379,
      ean: DEMO_EAN.auralisNc700,
      modelNumber: 'NC700',
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'ibd-sonaris-flow-2',
      name: 'Sonaris Flow 2 Portable Speaker',
      brand: 'Sonaris',
      category: 'speakers',
      description: 'Demo listing. Waterproof portable speaker, 18-hour battery.',
      currentPrice: 119,
      originalPrice: 165,
      ean: DEMO_EAN.sonarisFlow2,
      history: { pattern: 'dropped-to-low', days: 90 },
    },
    {
      externalId: 'ibd-voltaro-140',
      name: 'Voltaro 140 W GaN Charger',
      brand: 'Voltaro',
      category: 'accessories',
      description: 'Demo listing. Three-port 140 W GaN charger.',
      currentPrice: 64.9,
      originalPrice: 84.9,
      ean: DEMO_EAN.voltaro140Charger,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'ibd-pixmo-tab-11',
      name: 'Pixmo Tab 11 Tablet',
      brand: 'Pixmo',
      category: 'tablets',
      description: 'Demo listing. 11-inch tablet, 128 GB.',
      currentPrice: 299,
      originalPrice: 349,
      ean: DEMO_EAN.pixmoTab11,
      history: { pattern: 'declining', days: 90 },
    },
    {
      externalId: 'ibd-kestrel-photo-r5',
      name: 'Kestrel Photo R5 Mirrorless Camera',
      brand: 'Kestrel',
      category: 'cameras',
      description: 'Demo listing. Mirrorless camera body, 24 MP.',
      currentPrice: 699,
      originalPrice: 899,
      history: { pattern: 'declining', days: 90 },
    },
    {
      externalId: 'ibd-sonaris-bar-5',
      name: 'Sonaris Bar 5 Soundbar',
      brand: 'Sonaris',
      category: 'speakers',
      description: 'Demo listing. Compact soundbar with wireless subwoofer.',
      currentPrice: 199,
      originalPrice: 279,
      history: { pattern: 'permanent-sale', days: 90 },
    },
    {
      externalId: 'ibd-voltaro-powerbank-20',
      name: 'Voltaro PowerBank 20k',
      brand: 'Voltaro',
      category: 'accessories',
      description: 'Demo listing. 20 000 mAh power bank with 65 W output.',
      currentPrice: 59,
      availability: 'OUT_OF_STOCK',
      history: { pattern: 'steady', days: 90 },
    },
  ],
};
