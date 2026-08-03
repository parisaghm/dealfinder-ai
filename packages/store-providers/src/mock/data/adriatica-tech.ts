import type { MockStoreDataset } from '../types';
import { DEMO_EAN } from './demo-catalogue';

/**
 * Adriatica Tech S.r.l. â€” FICTIONAL DEMO STORE (Italy).
 *
 * Not a real retailer. Every product, price, delivery cost and delivery estimate
 * here is invented. See `demo-catalogue.ts`.
 *
 * Two things make this store worth having.
 *
 * First, it delivers to Finland **without publishing a delivery estimate** â€” the
 * rule has a price but no `minDays`/`maxDays`. So its delivered total is perfectly
 * knowable while its delivery time is not, and the UI has to say "Delivery time not
 * published" rather than inventing a range or implying speed. Unknown cost and
 * unknown timing are separate failures and must not be conflated.
 *
 * Second, it is the store whose cheapest listing is out of stock. A shopper cannot
 * act on it, so it must not be crowned cheapest â€” but it must still be shown, with
 * the reason stated, because concealing a real price is its own kind of dishonesty.
 */
export const adriaticaTechDataset: MockStoreDataset = {
  slug: 'adriatica-tech',
  name: 'Adriatica Tech S.r.l. (demo)',
  websiteUrl: 'https://adriatica-tech.example',
  logoUrl: null,
  productUrlTemplate: 'https://adriatica-tech.example/prodotto/{id}',

  countryCode: 'IT',
  currency: 'EUR',
  supportedCurrencies: ['EUR'],
  region: 'european',
  vatRegistrationCountry: 'IT',
  isDemoStore: true,

  deliveryRules: {
    IT: { shippingPrice: 4.9, freeOver: 60, minDays: 1, maxDays: 4 },
    FR: { shippingPrice: 11.9, minDays: 3, maxDays: 7 },
    DE: { shippingPrice: 11.9, minDays: 3, maxDays: 7 },
    ES: { shippingPrice: 12.9, minDays: 4, maxDays: 8 },
    // Modelled but not selectable.
    AT: { shippingPrice: 8.9, minDays: 2, maxDays: 5 },
    /**
     * Delivers to Finland, at a known price, with no published estimate.
     *
     * Deliberately omits minDays/maxDays. A known cost and an unknown timing is a
     * real and common combination, and the UI must not fill the gap.
     */
    FI: { shippingPrice: 16.9 },
  },

  products: [
    {
      externalId: 'adt-auralis-nc700',
      name: 'Auralis NC 700 Wireless Headphones',
      brand: 'Auralis',
      category: 'headphones',
      description:
        'Demo listing. Over-ear wireless headphones with active noise cancelling. Delivery time to some destinations is not published.',
      currentPrice: 305,
      originalPrice: 369,
      ean: DEMO_EAN.auralisNc700,
      modelNumber: 'NC700',
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'adt-lumenta-27-qhd',
      name: 'Lumenta 27" QHD 165 Hz Monitor',
      brand: 'Lumenta',
      category: 'monitors',
      description: 'Demo listing. 27-inch 1440p IPS gaming monitor at 165 Hz.',
      // The cheapest listing in its group, and out of stock â€” so it cannot win,
      // and the comparison has to say why rather than hiding it.
      currentPrice: 249,
      originalPrice: 329,
      ean: DEMO_EAN.lumenta27Qhd,
      modelNumber: 'L27Q165',
      availability: 'OUT_OF_STOCK',
      history: { pattern: 'dropped-to-low', days: 90 },
    },
    {
      externalId: 'adt-sonaris-flow-2',
      name: 'Sonaris Flow 2 Portable Speaker',
      brand: 'Sonaris',
      category: 'speakers',
      description: 'Demo listing. Waterproof portable speaker, 18-hour battery.',
      currentPrice: 132,
      ean: DEMO_EAN.sonarisFlow2,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'adt-nordkraft-ultra-14',
      name: 'Nordkraft Ultra 14 Laptop',
      brand: 'Nordkraft',
      category: 'laptops',
      description: 'Demo listing. 14-inch ultraportable, 16 GB RAM, 512 GB SSD.',
      currentPrice: 995,
      originalPrice: 1149,
      ean: DEMO_EAN.nordkraftUltra14,
      modelNumber: 'ULTRA14-512',
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'adt-auralis-buds-air',
      name: 'Auralis Buds Air Earphones',
      brand: 'Auralis',
      category: 'headphones',
      description: 'Demo listing. In-ear wireless earphones with noise cancelling.',
      currentPrice: 115,
      originalPrice: 145,
      ean: DEMO_EAN.auralisBudsAir,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'adt-kestrel-action-8',
      name: 'Kestrel Action 8 Camera',
      brand: 'Kestrel',
      category: 'cameras',
      description: 'Demo listing. Waterproof action camera, 5.3K video.',
      currentPrice: 359,
      originalPrice: 439,
      ean: DEMO_EAN.kestrelAction8,
      history: { pattern: 'volatile', days: 90 },
    },
    {
      externalId: 'adt-lumenta-tv-55',
      name: 'Lumenta 55" 4K Smart Television',
      brand: 'Lumenta',
      category: 'televisions',
      description: 'Demo listing. 55-inch 4K television with HDR.',
      currentPrice: 549,
      originalPrice: 749,
      history: { pattern: 'declining', days: 90 },
    },
    {
      externalId: 'adt-voltaro-desk-hub',
      name: 'Voltaro Desk Hub 11-in-1',
      brand: 'Voltaro',
      category: 'accessories',
      description: 'Demo listing. USB-C docking hub with dual display output.',
      currentPrice: 89,
      originalPrice: 119,
      history: { pattern: 'steady', days: 90 },
    },
  ],
};
