import { z } from 'zod';
import type { CategoryDescriptor, VerticalDescriptor } from './types';

/**
 * Electronics — the MVP vertical, scoped to products sold in Finland.
 *
 * The Finnish synonyms below are load-bearing twice over. They let the search
 * box interpret "robotti-imuri alle 300 €", and they let cross-store matching
 * recognise that "Sony WH-1000XM5 vastamelukuulokkeet" and "Sony WH-1000XM5
 * Wireless Headphones" name the same category — so the shared category noun is
 * lifted out of both titles instead of depressing their similarity score.
 * Finnish compounds where English would use two words, which is why the list
 * carries whole compounds ("vastamelukuulokkeet") rather than just stems.
 */

export const ELECTRONICS_CATEGORIES: readonly CategoryDescriptor[] = [
  {
    id: 'headphones',
    label: 'Headphones',
    description: 'Over-ear, on-ear and true wireless earbuds',
    synonyms: [
      'headphones',
      'headphone',
      'earbuds',
      'earbud',
      'earphones',
      'headset',
      'kuulokkeet',
      'vastamelukuulokkeet',
      'nappikuulokkeet',
      'langattomat kuulokkeet',
      'sankakuulokkeet',
    ],
  },
  {
    id: 'laptops',
    label: 'Laptops',
    description: 'Ultrabooks, work machines and gaming laptops',
    synonyms: [
      'laptop',
      'laptops',
      'notebook',
      'ultrabook',
      'macbook',
      'kannettava',
      'kannettava tietokone',
    ],
  },
  {
    id: 'phones',
    label: 'Phones',
    description: 'Smartphones and accessories',
    synonyms: ['phone', 'phones', 'smartphone', 'iphone', 'puhelin', 'älypuhelin', 'kannykka'],
  },
  {
    id: 'televisions',
    label: 'Televisions',
    description: '4K and OLED sets',
    synonyms: ['tv', 'tvs', 'television', 'televisions', 'oled', 'televisio', 'taulutelevisio'],
  },
  {
    id: 'tablets',
    label: 'Tablets',
    description: 'Tablets and e-readers',
    synonyms: ['tablet', 'tablets', 'ipad', 'tabletti', 'lukulaite'],
  },
  {
    id: 'smartwatches',
    label: 'Smartwatches',
    description: 'Watches and fitness trackers',
    synonyms: [
      'smartwatch',
      'smartwatches',
      'watch',
      'fitness tracker',
      'älykello',
      'juoksukello',
      'urheilukello',
    ],
  },
  {
    id: 'gaming',
    label: 'Gaming',
    description: 'Consoles, controllers and games',
    synonyms: [
      'console',
      'consoles',
      'playstation',
      'xbox',
      'nintendo',
      'gaming',
      'pelikonsoli',
    ],
  },
  {
    id: 'monitors',
    label: 'Monitors',
    description: 'Desktop and gaming displays',
    synonyms: ['monitor', 'monitors', 'display', 'näyttö', 'pelinäyttö', 'tietokonenäyttö'],
  },
  {
    id: 'speakers',
    label: 'Speakers',
    description: 'Portable and home audio',
    synonyms: ['speaker', 'speakers', 'soundbar', 'kaiutin', 'älykaiutin'],
  },
  {
    id: 'cameras',
    label: 'Cameras',
    description: 'Mirrorless, compact and action cameras',
    synonyms: [
      'camera',
      'cameras',
      'mirrorless',
      'gopro',
      'kamera',
      'järjestelmäkamera',
      'toimintakamera',
      'vlogauskamera',
    ],
  },
  {
    id: 'home-appliances',
    label: 'Home appliances',
    description: 'Coffee machines, vacuums and kitchen gear',
    synonyms: [
      'appliance',
      'appliances',
      'vacuum',
      'coffee machine',
      'robot vacuum',
      'kodinkone',
      'imuri',
      'robotti-imuri',
      'robotti imuri',
      'varsi-imuri',
      'kahviautomaatti',
      'espressokeitin',
    ],
  },
  {
    id: 'accessories',
    label: 'Accessories',
    description: 'Chargers, cables, keyboards and mice',
    synonyms: [
      'accessory',
      'accessories',
      'charger',
      'cable',
      'keyboard',
      'mouse',
      'powerbank',
      'hiiri',
      'näppäimistö',
      'mekaaninen näppäimistö',
      'varaosa',
      'suojakuori',
    ],
  },
];

/**
 * Extra, electronics-specific fields persisted on `Product.attributes`.
 * All optional: providers expose wildly different levels of detail, and a
 * missing spec must never prevent a product from being tracked.
 */
export const electronicsAttributesSchema = z
  .object({
    model: z.string().max(120).optional(),
    colour: z.string().max(60).optional(),
    storageGb: z.number().int().positive().max(1_000_000).optional(),
    memoryGb: z.number().int().positive().max(4096).optional(),
    screenInches: z.number().positive().max(200).optional(),
    batteryHours: z.number().positive().max(1000).optional(),
    connectivity: z.array(z.string().max(40)).max(20).optional(),
    warrantyMonths: z.number().int().nonnegative().max(600).optional(),
    energyClass: z.string().max(8).optional(),
  })
  .strict();

export type ElectronicsAttributes = z.infer<typeof electronicsAttributesSchema>;

export const electronicsVertical: VerticalDescriptor<ElectronicsAttributes> = {
  id: 'electronics',
  label: 'Electronics',
  tagline: 'Laptops, headphones, TVs and more from Finnish stores',
  currency: 'EUR',
  categories: ELECTRONICS_CATEGORIES,
  attributesSchema: electronicsAttributesSchema,
  exampleSearches: [
    'Wireless headphones',
    'Laptop under €1,000',
    'Philips headphones with at least 30% discount',
    '4K OLED television',
    'Robot vacuum under €300',
  ],
  enabled: true,
};
