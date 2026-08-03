import type { MockStoreDataset } from '../types';
import { DEMO_EAN } from './demo-catalogue';

/**
 * Nordbyte AB â€” FICTIONAL DEMO STORE (Sweden).
 *
 * Not a real retailer. Every product, price, delivery cost and delivery estimate
 * here is invented. See `demo-catalogue.ts`.
 *
 * This is the **currency-conversion** store: it quotes in SEK, so every offer has
 * to be converted before it can be compared, and the UI has to say so. It is also
 * where the "cheapest listed is not cheapest delivered" case gets its teeth â€”
 * 3 190 kr converts to roughly â‚¬277, undercutting every euro-priced rival, and yet
 * the store publishes no delivery cost to Finland at all. So its delivered total
 * is unknown, it cannot win, and the comparison must explain why rather than
 * quietly dropping it.
 */
export const nordbyteDataset: MockStoreDataset = {
  slug: 'nordbyte',
  name: 'Nordbyte AB (demo)',
  websiteUrl: 'https://nordbyte.example',
  logoUrl: null,
  productUrlTemplate: 'https://nordbyte.example/produkt/{id}',

  countryCode: 'SE',
  currency: 'SEK',
  supportedCurrencies: ['SEK'],
  region: 'nordic',
  vatRegistrationCountry: 'SE',
  isDemoStore: true,

  deliveryRules: {
    SE: { shippingPrice: 49, freeOver: 1000, minDays: 1, maxDays: 3 },
    /**
     * Delivers to Finland, and does not publish what it costs.
     *
     * `null` is the point. It is not free, and it is not zero â€” it is unknown,
     * which makes the delivered total unknown too. This single row is what the
     * "Shipping cost unknown" copy and the never-wins rule exist for.
     */
    FI: { shippingPrice: null, minDays: 3, maxDays: 8 },
    NO: { shippingPrice: 99, minDays: 2, maxDays: 5 },
    DK: { shippingPrice: 79, minDays: 2, maxDays: 4 },
    DE: { shippingPrice: 119, minDays: 4, maxDays: 8 },
  },

  products: [
    {
      externalId: 'nby-auralis-nc700',
      name: 'Auralis NC 700 Wireless Headphones',
      brand: 'Auralis',
      category: 'headphones',
      description:
        'Demo listing, priced in Swedish kronor. Over-ear wireless headphones with active noise cancelling.',
      // 3190 kr â‰ˆ â‚¬277.53 at the seeded rate â€” the cheapest *listed* price in the
      // headline group, and unable to win because delivery to FI is unpublished.
      currentPrice: 3190,
      originalPrice: 3990,
      ean: DEMO_EAN.auralisNc700,
      modelNumber: 'NC700',
      history: { pattern: 'declining', days: 90 },
    },
    {
      externalId: 'nby-nordkraft-ultra-14',
      name: 'Nordkraft Ultra 14 Laptop',
      brand: 'Nordkraft',
      category: 'laptops',
      description: 'Demo listing, priced in Swedish kronor. 14-inch ultraportable.',
      currentPrice: 10_990,
      originalPrice: 12_990,
      ean: DEMO_EAN.nordkraftUltra14,
      modelNumber: 'ULTRA14-512',
      history: { pattern: 'declining', days: 90 },
    },
    {
      externalId: 'nby-lumenta-27-qhd',
      name: 'Lumenta 27" QHD 165 Hz Monitor',
      brand: 'Lumenta',
      category: 'monitors',
      description: 'Demo listing, priced in Swedish kronor. 27-inch 1440p at 165 Hz.',
      currentPrice: 3390,
      originalPrice: 3990,
      ean: DEMO_EAN.lumenta27Qhd,
      modelNumber: 'L27Q165',
      history: { pattern: 'volatile', days: 90 },
    },
    {
      externalId: 'nby-sonaris-flow-2',
      name: 'Sonaris Flow 2 Portable Speaker',
      brand: 'Sonaris',
      category: 'speakers',
      description: 'Demo listing, priced in Swedish kronor. Waterproof portable speaker.',
      currentPrice: 1590,
      ean: DEMO_EAN.sonarisFlow2,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'nby-pixmo-tab-11',
      name: 'Pixmo Tab 11 Tablet',
      brand: 'Pixmo',
      category: 'tablets',
      description: 'Demo listing, priced in Swedish kronor. 11-inch tablet, 128 GB.',
      currentPrice: 3690,
      originalPrice: 4290,
      ean: DEMO_EAN.pixmoTab11,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'nby-voltaro-140',
      name: 'Voltaro 140 W GaN Charger',
      brand: 'Voltaro',
      category: 'accessories',
      description: 'Demo listing, priced in Swedish kronor. Three-port 140 W GaN charger.',
      currentPrice: 849,
      ean: DEMO_EAN.voltaro140Charger,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'nby-kestrel-action-8',
      name: 'Kestrel Action 8 Camera',
      brand: 'Kestrel',
      category: 'cameras',
      description: 'Demo listing, priced in Swedish kronor. Waterproof action camera.',
      currentPrice: 4290,
      originalPrice: 5290,
      ean: DEMO_EAN.kestrelAction8,
      history: { pattern: 'dropped-to-low', days: 90 },
    },
    {
      externalId: 'nby-nordkraft-desk-pro',
      name: 'Nordkraft Desk Pro 16 Laptop',
      brand: 'Nordkraft',
      category: 'laptops',
      description: 'Demo listing, priced in Swedish kronor. 16-inch workstation laptop.',
      currentPrice: 18_990,
      originalPrice: 21_990,
      history: { pattern: 'steady', days: 90 },
    },
  ],
};
