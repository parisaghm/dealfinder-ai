import type { MockStoreDataset } from '../types';
import { DEMO_EAN } from './demo-catalogue';

/**
 * TechHalle GmbH â€” FICTIONAL DEMO STORE (Germany).
 *
 * Not a real retailer. Every product, price, delivery cost and delivery estimate
 * here is invented. See `demo-catalogue.ts` for why the European catalogue is
 * synthetic and how it must not be presented.
 *
 * This is the store the brief's worked example describes: free domestic delivery,
 * â‚¬12.90 to Finland, 3â€“6 business days. It is also the store that wins the
 * headline comparison â€” â‚¬299 plus â‚¬12.90 delivered to Finland beats a â‚¬329
 * listing with free delivery, which is the entire thesis of the product.
 *
 * It carries the `productDestinationExclusions` fixture too: the store declares it
 * delivers to Finland, and one bulky listing still cannot get there. That case is
 * what proves store-level metadata is not sufficient to claim a product is
 * deliverable â€” only a StoreOffer row is.
 */
export const techhalleDataset: MockStoreDataset = {
  slug: 'techhalle',
  name: 'TechHalle GmbH (demo)',
  websiteUrl: 'https://techhalle.example',
  logoUrl: null,
  productUrlTemplate: 'https://techhalle.example/produkt/{id}',

  countryCode: 'DE',
  currency: 'EUR',
  supportedCurrencies: ['EUR'],
  region: 'european',
  vatRegistrationCountry: 'DE',
  isDemoStore: true,

  deliveryRules: {
    // Free at home above a threshold most of the catalogue clears.
    DE: { shippingPrice: 4.95, freeOver: 50, minDays: 1, maxDays: 3 },
    // The briefed rule.
    FI: { shippingPrice: 12.9, minDays: 3, maxDays: 6 },
    SE: { shippingPrice: 18.9, minDays: 3, maxDays: 7 },
    NL: { shippingPrice: 6.9, minDays: 2, maxDays: 4 },
    DK: { shippingPrice: 9.9, minDays: 2, maxDays: 5 },
    FR: { shippingPrice: 8.9, minDays: 2, maxDays: 5 },
    // ES and IT are absent: this store does not deliver there. Absence is the
    // only way that is expressed â€” there is no flag to forget.
  },

  productDestinationExclusions: {
    // The store ships to Finland; this monitor still cannot. Oversized freight is
    // the ordinary reason, and the honest consequence is no Finnish offer at all.
    FI: ['thl-lumenta-32-4k'],
  },

  products: [
    {
      externalId: 'thl-auralis-nc700',
      name: 'Auralis NC 700 Wireless Headphones',
      brand: 'Auralis',
      category: 'headphones',
      description:
        'Demo listing. Over-ear wireless headphones with active noise cancelling and a 30-hour battery.',
      currentPrice: 299,
      originalPrice: 379,
      ean: DEMO_EAN.auralisNc700,
      modelNumber: 'NC700',
      history: { pattern: 'declining', days: 90 },
    },
    {
      externalId: 'thl-lumenta-27-qhd',
      name: 'Lumenta 27" QHD 165 Hz Monitor',
      brand: 'Lumenta',
      category: 'monitors',
      description: 'Demo listing. 27-inch 1440p IPS gaming monitor at 165 Hz.',
      currentPrice: 279,
      originalPrice: 349,
      ean: DEMO_EAN.lumenta27Qhd,
      modelNumber: 'L27Q165',
      history: { pattern: 'volatile', days: 90 },
    },
    {
      externalId: 'thl-lumenta-32-4k',
      name: 'Lumenta 32" 4K Studio Monitor',
      brand: 'Lumenta',
      category: 'monitors',
      description:
        'Demo listing. 32-inch 4K monitor. Oversized freight â€” not delivered to every destination this store otherwise serves.',
      currentPrice: 649,
      originalPrice: 799,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'thl-nordkraft-ultra-14',
      name: 'Nordkraft Ultra 14 Laptop',
      brand: 'Nordkraft',
      category: 'laptops',
      description: 'Demo listing. 14-inch ultraportable, 16 GB RAM, 512 GB SSD.',
      currentPrice: 949,
      originalPrice: 1149,
      ean: DEMO_EAN.nordkraftUltra14,
      modelNumber: 'ULTRA14-512',
      history: { pattern: 'declining', days: 90 },
    },
    {
      externalId: 'thl-sonaris-flow-2',
      name: 'Sonaris Flow 2 Portable Speaker',
      brand: 'Sonaris',
      category: 'speakers',
      description: 'Demo listing. Waterproof portable speaker, 18-hour battery.',
      currentPrice: 129,
      originalPrice: 169,
      ean: DEMO_EAN.sonarisFlow2,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'thl-voltaro-140',
      name: 'Voltaro 140 W GaN Charger',
      brand: 'Voltaro',
      category: 'accessories',
      description: 'Demo listing. Three-port 140 W GaN charger.',
      currentPrice: 69,
      originalPrice: 89,
      ean: DEMO_EAN.voltaro140Charger,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'thl-kestrel-action-8',
      name: 'Kestrel Action 8 Camera',
      brand: 'Kestrel',
      category: 'cameras',
      description: 'Demo listing. Waterproof action camera, 5.3K video.',
      currentPrice: 349,
      originalPrice: 449,
      ean: DEMO_EAN.kestrelAction8,
      history: { pattern: 'dropped-to-low', days: 90 },
    },
    {
      externalId: 'thl-pixmo-tab-11',
      name: 'Pixmo Tab 11 Tablet',
      brand: 'Pixmo',
      category: 'tablets',
      description: 'Demo listing. 11-inch tablet, 128 GB.',
      currentPrice: 329,
      ean: DEMO_EAN.pixmoTab11,
      history: { pattern: 'steady', days: 90 },
    },
    {
      externalId: 'thl-auralis-buds-air',
      name: 'Auralis Buds Air Earphones',
      brand: 'Auralis',
      category: 'headphones',
      description: 'Demo listing. In-ear wireless earphones with noise cancelling.',
      currentPrice: 119,
      originalPrice: 149,
      ean: DEMO_EAN.auralisBudsAir,
      availability: 'LOW_STOCK',
      history: { pattern: 'rising', days: 90 },
    },
  ],
};
