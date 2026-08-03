import type { MockStoreDataset } from '../types';

/**
 * Sample catalogue for Verkkokauppa.com.
 *
 * Synthetic prices and history. Delivery approximation: a modest flat fee,
 * with some items marked as not publishing a cost at all (`shippingPrice`
 * omitted) so the UI and the scoring both handle "unknown" as distinct from
 * "free".
 */
export const verkkokauppaDataset: MockStoreDataset = {
  slug: 'verkkokauppa',
  name: 'Verkkokauppa.com',
  websiteUrl: 'https://www.verkkokauppa.com',
  logoUrl: '/images/stores/verkkokauppa.svg',
  productUrlTemplate: 'https://www.verkkokauppa.com/fi/product/{id}',

  // Finland only. See gigantti.ts for why `useProductShipping` is set — this
  // dataset in particular holds the €12,90 Sony delivery cost and the Marshall
  // listing that publishes none, and both must survive unchanged.
  countryCode: 'FI',
  currency: 'EUR',
  supportedCurrencies: ['EUR'],
  region: 'local',
  vatRegistrationCountry: 'FI',
  isDemoStore: false,
  deliveryRules: {
    FI: { shippingPrice: null, useProductShipping: true, minDays: 1, maxDays: 3 },
  },
  products: [
    {
      externalId: 'vkk-airpods-pro-3',
      name: 'Apple AirPods Pro 3 -vastamelunappikuulokkeet',
      brand: 'Apple',
      category: 'headphones',
      description:
        'True wireless earbuds with adaptive audio, active noise cancellation and a USB-C charging case.',
      currentPrice: 239,
      originalPrice: 279,
      shippingPrice: 5.9,
      attributes: { colour: 'White', batteryHours: 30, connectivity: ['Bluetooth 5.3'] },
      history: { pattern: 'steady', days: 85, startPrice: 265 },
    },
    {
      externalId: 'vkk-rog-zephyrus-g14',
      name: 'ASUS ROG Zephyrus G14 14" RTX 4070',
      brand: 'ASUS',
      category: 'laptops',
      description:
        '14-inch gaming laptop with an OLED display, Ryzen 9 processor, RTX 4070 graphics and 1 TB SSD.',
      currentPrice: 1699,
      originalPrice: 1999,
      shippingPrice: 0,
      attributes: { storageGb: 1024, memoryGb: 32, screenInches: 14, warrantyMonths: 24 },
      history: { pattern: 'declining', days: 115, startPrice: 1975 },
    },
    {
      externalId: 'vkk-iphone-16-128',
      name: 'Apple iPhone 16 128 GB',
      brand: 'Apple',
      category: 'phones',
      description: 'iPhone 16 with the A18 chip, a 48 MP Fusion camera and the Action button.',
      currentPrice: 899,
      originalPrice: 969,
      shippingPrice: 0,
      attributes: { storageGb: 128, screenInches: 6.1, colour: 'Teal' },
      history: { pattern: 'steady', days: 80, startPrice: 949 },
    },
    {
      externalId: 'vkk-philips-oled809-55',
      name: 'Philips 55" OLED809 Ambilight -televisio',
      brand: 'Philips',
      category: 'televisions',
      description:
        '55-inch OLED television with four-sided Ambilight, a 120 Hz panel and Google TV.',
      currentPrice: 1049,
      originalPrice: 1499,
      shippingPrice: 0,
      attributes: { screenInches: 55, energyClass: 'F', connectivity: ['HDMI 2.1', 'Wi-Fi 6'] },
      history: { pattern: 'dropped-to-low', days: 130, startPrice: 1470 },
    },
    {
      externalId: 'vkk-philips-shp9600',
      name: 'Philips SHP9600 -kuulokkeet',
      brand: 'Philips',
      category: 'headphones',
      description: 'Open-back wired over-ear headphones with 50 mm drivers and a detachable cable.',
      // A deep, genuine discount on an inexpensive item — matches the briefed
      // "Philips headphones with at least 30% discount" search.
      currentPrice: 74.9,
      originalPrice: 129,
      shippingPrice: 5.9,
      attributes: { colour: 'Black', connectivity: ['3.5 mm'] },
      history: { pattern: 'declining', days: 90, startPrice: 125 },
    },
    {
      externalId: 'vkk-lenovo-tab-p12',
      name: 'Lenovo Tab P12 12.7" 128 GB',
      brand: 'Lenovo',
      category: 'tablets',
      description: '12.7-inch 3K Android tablet with quad JBL speakers and an included stylus.',
      currentPrice: 329,
      originalPrice: 399,
      shippingPrice: 0,
      attributes: { storageGb: 128, screenInches: 12.7 },
      history: { pattern: 'volatile', days: 100, startPrice: 385 },
    },
    {
      externalId: 'vkk-apple-watch-s11',
      name: 'Apple Watch Series 11 45 mm GPS',
      brand: 'Apple',
      category: 'smartwatches',
      description: 'Smartwatch with an always-on Retina display, ECG and sleep-stage tracking.',
      currentPrice: 449,
      shippingPrice: 0,
      attributes: { batteryHours: 18, connectivity: ['GPS', 'Bluetooth', 'Wi-Fi'] },
      history: { pattern: 'steady', days: 65, startPrice: 459 },
    },
    {
      externalId: 'vkk-switch-2',
      name: 'Nintendo Switch 2 -pelikonsoli',
      brand: 'Nintendo',
      category: 'gaming',
      description: 'Hybrid console with a 7.9-inch 1080p HDR screen and 256 GB of internal storage.',
      currentPrice: 469,
      shippingPrice: 0,
      availability: 'PREORDER',
      attributes: { storageGb: 256, screenInches: 7.9 },
      history: { pattern: 'steady', days: 45, startPrice: 469 },
    },
    {
      externalId: 'vkk-dell-u2724d',
      name: 'Dell UltraSharp U2724D 27" -näyttö',
      brand: 'Dell',
      category: 'monitors',
      description: '27-inch 1440p IPS Black monitor at 120 Hz with USB-C hub and a height-adjustable stand.',
      currentPrice: 399,
      originalPrice: 469,
      shippingPrice: 0,
      attributes: { screenInches: 27, connectivity: ['USB-C', 'DisplayPort', 'HDMI'] },
      history: { pattern: 'steady', days: 90, startPrice: 449 },
    },
    {
      externalId: 'vkk-marshall-emberton-iii',
      name: 'Marshall Emberton III -kaiutin',
      brand: 'Marshall',
      category: 'speakers',
      description: 'Portable speaker with 32-hour playtime, IP67 rating and True Stereophonic sound.',
      currentPrice: 149,
      originalPrice: 189,
      // Delivery cost not published for this item.
      attributes: { colour: 'Black', batteryHours: 32, connectivity: ['Bluetooth 5.3'] },
      history: { pattern: 'steady', days: 70, startPrice: 179 },
    },
    {
      externalId: 'vkk-gopro-hero13',
      name: 'GoPro HERO13 Black -toimintakamera',
      brand: 'GoPro',
      category: 'cameras',
      description: 'Action camera with 5.3K60 video, HyperSmooth 6.0 stabilisation and magnetic mounting.',
      currentPrice: 379,
      originalPrice: 499,
      shippingPrice: 0,
      attributes: { batteryHours: 2.5, connectivity: ['Wi-Fi', 'Bluetooth'] },
      history: { pattern: 'declining', days: 95, startPrice: 489 },
    },
    {
      externalId: 'vkk-dyson-v15-detect',
      name: 'Dyson V15 Detect Absolute -varsi-imuri',
      brand: 'Dyson',
      category: 'home-appliances',
      description:
        'Cordless vacuum with a laser dust-detection head, piezo sensor and 60 minutes of runtime.',
      currentPrice: 599,
      originalPrice: 799,
      shippingPrice: 0,
      attributes: { batteryHours: 1, warrantyMonths: 24 },
      history: { pattern: 'spiked', days: 120, startPrice: 699 },
    },
    {
      externalId: 'vkk-keychron-k8-pro',
      name: 'Keychron K8 Pro -mekaaninen näppäimistö',
      brand: 'Keychron',
      category: 'accessories',
      description: 'Hot-swappable 75% wireless mechanical keyboard with QMK/VIA support.',
      currentPrice: 119,
      shippingPrice: 5.9,
      attributes: { colour: 'Grey', connectivity: ['Bluetooth 5.1', 'USB-C'] },
      history: { pattern: 'steady', days: 60, startPrice: 122 },
    },
    {
      externalId: 'vkk-beyerdynamic-dt770',
      name: 'Beyerdynamic DT 770 PRO 80 ohm -kuulokkeet',
      brand: 'Beyerdynamic',
      category: 'headphones',
      description: 'Closed-back studio monitoring headphones, hand-made in Germany.',
      currentPrice: 139,
      originalPrice: 179,
      shippingPrice: 5.9,
      attributes: { colour: 'Grey', connectivity: ['3.5 mm', '6.3 mm adapter'] },
      history: { pattern: 'volatile', days: 110, startPrice: 172 },
    },

    // ── Cross-store matching fixtures ──────────────────────────────────────
    {
      // The cheapest LISTED price for the Sony headphones and — once its 12,90
      // delivery charge is counted — not the cheapest to actually buy. That
      // divergence is the entire point of the comparison table, so these three
      // numbers are load-bearing: changing them breaks an E2E assertion.
      externalId: 'vkk-sony-wh-1000xm5-musta',
      name: 'Sony WH-1000XM5 Musta langattomat vastamelukuulokkeet',
      brand: 'Sony',
      category: 'headphones',
      description:
        'Langattomat vastamelukuulokkeet, 30 tunnin akkukesto ja mukautuva äänenhallinta.',
      currentPrice: 319,
      originalPrice: 419,
      shippingPrice: 12.9,
      ean: '4548736132443',
      attributes: { colour: 'Black', batteryHours: 30, connectivity: ['Bluetooth 5.2', 'USB-C'] },
      history: { pattern: 'declining', days: 90, startPrice: 410 },
    },
    {
      // Ambiguous naming: this full SKU contains Power's short model code, so
      // it scores as containment rather than an exact match and lands in the
      // review queue. This is the row the admin page demonstrates.
      externalId: 'vkk-samsung-qe65q70datxxc',
      name: 'Samsung QE65Q70DATXXC 65" QLED 4K Smart TV',
      brand: 'Samsung',
      category: 'televisions',
      description: '65-inch 4K QLED television with a 120 Hz panel and Tizen smart platform.',
      currentPrice: 949,
      originalPrice: 1099,
      shippingPrice: 0,
      modelNumber: 'QE65Q70DATXXC',
      attributes: { screenInches: 65, energyClass: 'E' },
      history: { pattern: 'volatile', days: 120, startPrice: 1080 },
    },
    {
      externalId: 'vkk-hp-envy-x360-14',
      name: 'HP Envy x360 14 Core i7 512 GB',
      brand: 'HP',
      category: 'laptops',
      description:
        '14-inch convertible laptop with a Core i7 processor and a touch OLED display.',
      currentPrice: 1099,
      originalPrice: 1299,
      shippingPrice: 0,
      modelNumber: 'ENVY-X360-14',
      attributes: { storageGb: 512, memoryGb: 16, screenInches: 14 },
      history: { pattern: 'declining', days: 90, startPrice: 1279 },
    },
  ],
};
