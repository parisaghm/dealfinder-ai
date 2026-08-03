import type { MockStoreDataset } from '../types';
import { DEMO_EAN } from './demo-catalogue';

/**
 * Maison NumÃ©rique SAS â€” FICTIONAL DEMO STORE (France).
 *
 * Not a real retailer. Every product, price, delivery cost and delivery estimate
 * here is invented. See `demo-catalogue.ts`.
 *
 * **This store does not deliver to Finland**, and that is its entire purpose.
 *
 * It stocks the headline headphones at â‚¬289 â€” cheaper than the German store's â‚¬299
 * and the Dutch store's â‚¬329. On a destination-blind comparison it looks like the
 * best euro-priced offer available. Choose Finland as your destination and it must
 * disappear, or be marked as undeliverable; choose Germany and it must reappear.
 * That single behaviour is what "store availability depends on the selected
 * destination" means in practice, and it is what a Finland-only product could not
 * express at all.
 *
 * Note there is no `FI: { shipsTo: false }` here. Finland is simply absent from
 * `deliveryRules`, because absence *is* how "does not deliver" is represented.
 * A flag would be a thing to forget; a missing key cannot be forgotten into the
 * wrong state.
 */
export const maisonNumeriqueDataset: MockStoreDataset = {
  slug: 'maison-numerique',
  name: 'Maison NumÃ©rique SAS (demo)',
  websiteUrl: 'https://maison-numerique.example',
  logoUrl: null,
  productUrlTemplate: 'https://maison-numerique.example/produit/{id}',

  countryCode: 'FR',
  currency: 'EUR',
  supportedCurrencies: ['EUR'],
  region: 'european',
  vatRegistrationCountry: 'FR',
  isDemoStore: true,

  deliveryRules: {
    FR: { shippingPrice: 0, minDays: 1, maxDays: 3 },
    // Modelled but not selectable as destinations.
    BE: { shippingPrice: 5.9, minDays: 2, maxDays: 4 },
    NL: { shippingPrice: 7.9, minDays: 2, maxDays: 5 },
    DE: { shippingPrice: 7.9, minDays: 2, maxDays: 5 },
    ES: { shippingPrice: 9.9, minDays: 3, maxDays: 6 },
    // FI, SE, IT and DK are absent. This store does not deliver to any of them.
  },

  products: [
    {
      externalId: 'mnq-auralis-nc700',
      name: 'Auralis NC 700 Wireless Headphones',
      brand: 'Auralis',
      category: 'headphones',
      description:
        'Demo listing. Over-ear wireless headphones with active noise cancelling. Not delivered to every destination.',
      // Cheaper than every rival, and irrelevant to a Finnish shopper.
      currentPrice: 289,
      originalPrice: 359,
      ean: DEMO_EAN.auralisNc700,
      modelNumber: 'NC700',
      history: { pattern: 'declining', days: 90 },
    },
    {
      externalId: 'mnq-lumenta-27-qhd',
      name: 'Lumenta 27" QHD 165 Hz Monitor',
      brand: 'Lumenta',
      category: 'monitors',
      description: 'Demo listing. 27-inch 1440p IPS gaming monitor at 165 Hz.',
      currentPrice: 265,
      originalPrice: 339,
      ean: DEMO_EAN.lumenta27Qhd,
      modelNumber: 'L27Q165',
      history: { pattern: 'dropped-to-low', days: 90 },
    },
    {
      externalId: 'mnq-sonaris-flow-2',
      name: 'Sonaris Flow 2 Portable Speaker',
      brand: 'Sonaris',
      category: 'speakers',
      description: 'Demo listing. Waterproof portable speaker, 18-hour battery.',
      currentPrice: 124,
      originalPrice: 169,
      ean: DEMO_EAN.sonarisFlow2,
      history: { pattern: 'declining', days: 90 },
    },
    {
      externalId: 'mnq-kestrel-action-8',
      name: 'Kestrel Action 8 Camera',
      brand: 'Kestrel',
      category: 'cameras',
      description: 'Demo listing. Waterproof action camera, 5.3K video.',
      currentPrice: 335,
      originalPrice: 429,
      ean: DEMO_EAN.kestrelAction8,
      history: { pattern: 'declining', days: 90 },
    },
    {
      externalId: 'mnq-pixmo-tab-11',
      name: 'Pixmo Tab 11 Tablet',
      brand: 'Pixmo',
      category: 'tablets',
      description: 'Demo listing. 11-inch tablet, 128 GB.',
      currentPrice: 309,
      ean: DEMO_EAN.pixmoTab11,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'mnq-auralis-studio-40',
      name: 'Auralis Studio 40 Monitor Headphones',
      brand: 'Auralis',
      category: 'headphones',
      description: 'Demo listing. Open-back studio reference headphones, 250 ohm.',
      currentPrice: 159,
      originalPrice: 199,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'mnq-voltaro-65',
      name: 'Voltaro 65 W Travel Charger',
      brand: 'Voltaro',
      category: 'accessories',
      description: 'Demo listing. Compact two-port 65 W charger.',
      currentPrice: 39,
      originalPrice: 54,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'mnq-nordkraft-air-13',
      name: 'Nordkraft Air 13 Laptop',
      brand: 'Nordkraft',
      category: 'laptops',
      description: 'Demo listing. 13-inch fanless laptop, 8 GB RAM.',
      currentPrice: 699,
      originalPrice: 849,
      history: { pattern: 'declining', days: 90 },
    },
  ],
};
