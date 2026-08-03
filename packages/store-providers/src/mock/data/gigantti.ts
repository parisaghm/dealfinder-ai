import type { MockStoreDataset } from '../types';

/**
 * Sample catalogue for Gigantti (gigantti.fi).
 *
 * Representative Finnish electronics pricing, not a copy of any live listing.
 * Product names refer to real hardware because the search experience is
 * meaningless with invented model numbers, but every price, discount and
 * history here is synthetic.
 *
 * Gigantti's real-world delivery policy is approximated: free over €50,
 * a flat fee below it.
 */
export const gigantiDataset: MockStoreDataset = {
  slug: 'gigantti',
  name: 'Gigantti',
  websiteUrl: 'https://www.gigantti.fi',
  logoUrl: '/images/stores/gigantti.svg',
  productUrlTemplate: 'https://www.gigantti.fi/product/{id}',
  products: [
    {
      externalId: 'gig-sony-wh1000xm5',
      name: 'Sony WH-1000XM5 vastamelukuulokkeet',
      brand: 'Sony',
      category: 'headphones',
      description:
        'Over-ear noise cancelling headphones with 30-hour battery life, multipoint Bluetooth and adaptive sound control.',
      currentPrice: 329,
      originalPrice: 419,
      shippingPrice: 0,
      // Published EAN. Two other stores publish the same code, which is what
      // lets stage 1 group all three without relying on the title at all —
      // useful, because the three titles are written in two languages.
      ean: '4548736132443',
      modelNumber: 'WH-1000XM5',
      attributes: { colour: 'Black', batteryHours: 30, connectivity: ['Bluetooth 5.2', 'USB-C'] },
      history: { pattern: 'declining', days: 90, startPrice: 415 },
    },
    {
      externalId: 'gig-macbook-air-m4-13',
      name: 'Apple MacBook Air 13" M4 256 GB',
      brand: 'Apple',
      category: 'laptops',
      description:
        'Fanless 13-inch laptop with the M4 chip, 16 GB unified memory and up to 18 hours of battery life.',
      currentPrice: 1199,
      originalPrice: 1299,
      shippingPrice: 0,
      attributes: { storageGb: 256, memoryGb: 16, screenInches: 13.6, warrantyMonths: 24 },
      history: { pattern: 'steady', days: 90, startPrice: 1249 },
    },
    {
      externalId: 'gig-galaxy-s25-128',
      name: 'Samsung Galaxy S25 128 GB',
      brand: 'Samsung',
      category: 'phones',
      description: 'Compact flagship phone with a 6.2-inch AMOLED display and triple camera system.',
      currentPrice: 799,
      shippingPrice: 0,
      attributes: { storageGb: 128, screenInches: 6.2, colour: 'Navy' },
      history: { pattern: 'steady', days: 75, startPrice: 829 },
    },
    {
      externalId: 'gig-lg-oled-c5-55',
      name: 'LG OLED evo C5 55" 4K -televisio',
      brand: 'LG',
      category: 'televisions',
      description: '55-inch OLED evo panel with 144 Hz refresh rate, four HDMI 2.1 ports and webOS.',
      currentPrice: 1299,
      originalPrice: 1799,
      shippingPrice: 0,
      // No EAN published, but the regional SKU is — which is what lets this
      // group with Power's listing on brand plus model number alone.
      modelNumber: 'OLED55C54LA',
      attributes: { screenInches: 55, energyClass: 'F', connectivity: ['HDMI 2.1', 'Wi-Fi 6'] },
      history: { pattern: 'declining', days: 120, startPrice: 1780 },
    },
    {
      externalId: 'gig-philips-fidelio-l4',
      name: 'Philips Fidelio L4 vastamelukuulokkeet',
      brand: 'Philips',
      category: 'headphones',
      description:
        'Premium over-ear headphones with hybrid adaptive noise cancellation, LDAC support and leather earcups.',
      currentPrice: 229,
      originalPrice: 349,
      shippingPrice: 0,
      attributes: { colour: 'Black', batteryHours: 40, connectivity: ['Bluetooth 5.3', 'LDAC'] },
      history: { pattern: 'dropped-to-low', days: 90, startPrice: 340 },
    },
    {
      externalId: 'gig-ipad-air-11',
      name: 'Apple iPad Air 11" 128 GB',
      brand: 'Apple',
      category: 'tablets',
      description: '11-inch Liquid Retina tablet with the M3 chip and Apple Pencil Pro support.',
      currentPrice: 699,
      shippingPrice: 0,
      attributes: { storageGb: 128, screenInches: 11 },
      history: { pattern: 'steady', days: 60, startPrice: 715 },
    },
    {
      externalId: 'gig-garmin-fr265',
      name: 'Garmin Forerunner 265 -juoksukello',
      brand: 'Garmin',
      category: 'smartwatches',
      description: 'AMOLED running watch with multi-band GPS, training readiness and 13-day battery.',
      currentPrice: 379,
      originalPrice: 499,
      shippingPrice: 0,
      attributes: { batteryHours: 312, connectivity: ['GPS', 'Bluetooth', 'ANT+'] },
      history: { pattern: 'declining', days: 100, startPrice: 489 },
    },
    {
      externalId: 'gig-ps5-slim-1tb',
      name: 'Sony PlayStation 5 Slim 1 TB',
      brand: 'Sony',
      category: 'gaming',
      description: 'Disc-drive PlayStation 5 console with a 1 TB SSD and DualSense controller.',
      currentPrice: 549,
      shippingPrice: 0,
      attributes: { storageGb: 1024 },
      history: { pattern: 'steady', days: 90, startPrice: 559 },
    },
    {
      externalId: 'gig-odyssey-g5-27',
      name: 'Samsung Odyssey G5 27" pelinäyttö',
      brand: 'Samsung',
      category: 'monitors',
      description: '27-inch 1440p VA gaming monitor with a 165 Hz refresh rate and 1 ms response.',
      currentPrice: 249,
      originalPrice: 349,
      shippingPrice: 0,
      attributes: { screenInches: 27, connectivity: ['DisplayPort 1.2', 'HDMI 2.0'] },
      history: { pattern: 'volatile', days: 110, startPrice: 320 },
    },
    {
      externalId: 'gig-sonos-era-100',
      name: 'Sonos Era 100 -kaiutin',
      brand: 'Sonos',
      category: 'speakers',
      description: 'Compact wireless speaker with stereo drivers, Wi-Fi, Bluetooth and Trueplay tuning.',
      currentPrice: 229,
      originalPrice: 259,
      shippingPrice: 0,
      attributes: { colour: 'White', connectivity: ['Wi-Fi', 'Bluetooth', 'AirPlay 2'] },
      history: { pattern: 'steady', days: 80, startPrice: 249 },
    },
    {
      externalId: 'gig-canon-eos-r50',
      name: 'Canon EOS R50 -järjestelmäkamera + 18-45 mm',
      brand: 'Canon',
      category: 'cameras',
      description: '24 MP APS-C mirrorless camera with 4K video, subject tracking and a vari-angle screen.',
      currentPrice: 749,
      originalPrice: 899,
      shippingPrice: 0,
      attributes: { warrantyMonths: 24 },
      history: { pattern: 'declining', days: 95, startPrice: 890 },
    },
    {
      externalId: 'gig-roborock-q7-max',
      name: 'Roborock Q7 Max robotti-imuri',
      brand: 'Roborock',
      category: 'home-appliances',
      description:
        'Robot vacuum with LiDAR navigation, 4200 Pa suction and a combined mopping module.',
      // Deliberate example of a permanent "sale": the crossed-out €499 is a
      // price this product has never actually been sold at in our records.
      currentPrice: 349,
      originalPrice: 499,
      shippingPrice: 0,
      attributes: { colour: 'Black', connectivity: ['Wi-Fi'] },
      history: { pattern: 'permanent-sale', days: 120 },
    },
    {
      externalId: 'gig-anker-737-powerbank',
      name: 'Anker 737 Power Bank 24 000 mAh',
      brand: 'Anker',
      category: 'accessories',
      description: '24 000 mAh power bank with 140 W bidirectional USB-C charging and a smart display.',
      currentPrice: 119,
      originalPrice: 159,
      shippingPrice: 0,
      attributes: { connectivity: ['USB-C', 'USB-A'] },
      history: { pattern: 'spiked', days: 85, startPrice: 139 },
    },
    {
      externalId: 'gig-jbl-tune-770nc',
      name: 'JBL Tune 770NC -kuulokkeet',
      brand: 'JBL',
      category: 'headphones',
      description: 'Wireless over-ear headphones with adaptive noise cancelling and 70-hour battery.',
      currentPrice: 89.9,
      originalPrice: 129,
      shippingPrice: 5.9,
      // Out of stock on purpose: exercises the availability factor and the
      // "price cannot be acted on" warning.
      availability: 'OUT_OF_STOCK',
      attributes: { colour: 'Blue', batteryHours: 70 },
      history: { pattern: 'declining', days: 70, startPrice: 125 },
    },

    // ── Cross-store matching fixtures ──────────────────────────────────────
    //
    // Each entry below exists to exercise one matching outcome. The scenario
    // table lives in docs/product-matching.md; the comments here say which case
    // the row is for, because a fixture whose purpose is not written down gets
    // "tidied up" by the next person.
    {
      // Same phone, same storage, as Verkkokauppa's: merges into one canonical.
      externalId: 'gig-iphone-16-128',
      name: 'Apple iPhone 16 128 GB Musta',
      brand: 'Apple',
      category: 'phones',
      description: 'iPhone 16 with the A18 chip, a 48 MP Fusion camera and the Action button.',
      currentPrice: 879,
      originalPrice: 969,
      shippingPrice: 0,
      attributes: { storageGb: 128, screenInches: 6.1, colour: 'Black' },
      history: { pattern: 'declining', days: 80, startPrice: 955 },
    },
    {
      // Different storage. Must NOT merge with the 128 GB listings, even though
      // brand, model, category and almost every title token agree.
      externalId: 'gig-iphone-16-256',
      name: 'Apple iPhone 16 256 GB Musta',
      brand: 'Apple',
      category: 'phones',
      description: 'iPhone 16 with the A18 chip and 256 GB of storage.',
      currentPrice: 999,
      originalPrice: 1099,
      shippingPrice: 0,
      attributes: { storageGb: 256, screenInches: 6.1, colour: 'Black' },
      history: { pattern: 'steady', days: 80, startPrice: 1049 },
    },
    {
      // Colour is not material for speakers, so this merges with the white one:
      // same product, same price, same purchase decision.
      externalId: 'gig-sonos-era-100-musta',
      name: 'Sonos Era 100 -kaiutin, Musta',
      brand: 'Sonos',
      category: 'speakers',
      description:
        'Compact wireless speaker with stereo drivers, Wi-Fi, Bluetooth and Trueplay tuning.',
      currentPrice: 239,
      originalPrice: 259,
      shippingPrice: 0,
      attributes: { colour: 'Black', connectivity: ['Wi-Fi', 'Bluetooth', 'AirPlay 2'] },
      history: { pattern: 'steady', days: 80, startPrice: 255 },
    },
    {
      // Colour IS material for accessories — a shopper wants the black one or
      // the blue one, not whichever is cheaper. Must not merge.
      externalId: 'gig-apple-silicone-case-16-black',
      name: 'Apple iPhone 16 silikonikuori, Musta',
      brand: 'Apple',
      category: 'accessories',
      description: 'Silicone case for iPhone 16 with MagSafe.',
      currentPrice: 55,
      shippingPrice: 4.9,
      modelNumber: 'MYYE3ZM',
      attributes: { colour: 'Black' },
      history: { pattern: 'steady', days: 60, startPrice: 59 },
    },
    {
      // Single unit, against Power's four-pack.
      externalId: 'gig-apple-airtag-1',
      name: 'Apple AirTag',
      brand: 'Apple',
      category: 'accessories',
      description: 'Bluetooth item tracker that works with the Find My network.',
      currentPrice: 35,
      originalPrice: 39,
      shippingPrice: 4.9,
      history: { pattern: 'steady', days: 70, startPrice: 39 },
    },
    {
      // One generation newer than Power's listing: reviewable, never merged.
      externalId: 'gig-bose-qc-ultra-2-sukupolvi',
      name: 'Bose QuietComfort Ultra -kuulokkeet (2. sukupolvi)',
      brand: 'Bose',
      category: 'headphones',
      description:
        'Second-generation over-ear headphones with immersive spatial audio and 30-hour battery.',
      currentPrice: 399,
      originalPrice: 449,
      shippingPrice: 0,
      attributes: { colour: 'Black', batteryHours: 30, connectivity: ['Bluetooth 5.3', 'USB-C'] },
      history: { pattern: 'steady', days: 60, startPrice: 429 },
    },
    {
      // The deliberately unsafe match. This milk jug carries the SAME EAN as
      // Power's espresso machine — a data error real retailers do make. Stage 1
      // fires on the identifier, but the category mismatch and the 14x price
      // ratio downgrade it to a candidate rather than a merge, and the seed
      // pre-rejects it so the rejection memo can be demonstrated.
      externalId: 'gig-philips-lattego-maitosailio',
      name: 'Philips LatteGo maitosäiliö -varaosa',
      brand: 'Philips',
      category: 'accessories',
      description: 'Replacement LatteGo milk container for Philips espresso machines.',
      currentPrice: 39,
      shippingPrice: 4.9,
      ean: '8879617123455',
      attributes: { colour: 'Black' },
      history: { pattern: 'steady', days: 60, startPrice: 42 },
    },
  ],
};
