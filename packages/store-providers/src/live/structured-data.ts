import { parseAmount, type Availability } from '@deal-finder/shared';

/**
 * schema.org structured-data extraction.
 *
 * **This is the preferred way to read a product page**, and live adapters try it
 * before touching the DOM. Reasons, in order of importance:
 *
 *  1. It is data the site publishes *deliberately*, for exactly this kind of
 *     consumption — the same markup Google Shopping reads.
 *  2. It is stable. CSS classes change on every redesign; `schema.org/Product`
 *     does not.
 *  3. It needs no browser. A plain HTTP GET and a JSON parse is far lighter on
 *     the store's infrastructure than rendering their site in Chromium.
 *
 * A headless browser is the fallback for pages that render prices client-side,
 * not the default.
 */

export interface StructuredProduct {
  name?: string;
  brand?: string;
  description?: string;
  image?: string;
  sku?: string;
  price?: number;
  currency?: string;
  availability?: Availability;
  shippingPrice?: number;
}

/** Extract every JSON-LD block from an HTML document. */
export function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern =
    /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    try {
      // Some sites wrap JSON-LD in CDATA or leave trailing commas; only the
      // well-formed blocks are usable, and a broken one must not abort the rest.
      blocks.push(JSON.parse(raw.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '')));
    } catch {
      continue;
    }
  }

  return blocks;
}

/** Walk a JSON-LD graph and return the first node matching `@type`. */
function findNodeByType(value: unknown, type: string, depth = 0): Record<string, unknown> | null {
  if (depth > 8 || value == null || typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findNodeByType(entry, type, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const node = value as Record<string, unknown>;
  const nodeType = node['@type'];
  const matches = Array.isArray(nodeType)
    ? nodeType.some((entry) => String(entry).toLowerCase() === type.toLowerCase())
    : String(nodeType ?? '').toLowerCase() === type.toLowerCase();

  if (matches) return node;

  // Follow @graph and nested offer/product structures.
  for (const key of ['@graph', 'mainEntity', 'itemListElement', 'offers', 'hasVariant']) {
    const found = findNodeByType(node[key], type, depth + 1);
    if (found) return found;
  }

  return null;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    // Prices appear as "1 099,00", "1.099,00", "1,099.00" and "1099.00" in the
    // wild. Reuse the shared parser rather than reimplementing separator
    // disambiguation here — getting it subtly wrong turns €1,099 into €1.10.
    return parseAmount(value) ?? undefined;
  }
  return undefined;
}

function toText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (value && typeof value === 'object') {
    const named = (value as Record<string, unknown>)['name'];
    if (typeof named === 'string' && named.trim() !== '') return named.trim();
  }
  return undefined;
}

/** Map schema.org ItemAvailability onto our normalised enum. */
export function mapSchemaAvailability(value: unknown): Availability | undefined {
  const text = typeof value === 'string' ? value.toLowerCase() : '';
  if (!text) return undefined;

  if (text.includes('instock')) return 'IN_STOCK';
  if (text.includes('limitedavailability')) return 'LOW_STOCK';
  if (text.includes('outofstock') || text.includes('soldout')) return 'OUT_OF_STOCK';
  if (text.includes('preorder') || text.includes('presale')) return 'PREORDER';
  if (text.includes('discontinued')) return 'DISCONTINUED';
  return 'UNKNOWN';
}

/**
 * Read a `schema.org/Product` (and its `Offer`) out of a page's JSON-LD.
 * Returns null when the page publishes none.
 */
export function parseStructuredProduct(html: string): StructuredProduct | null {
  for (const block of extractJsonLdBlocks(html)) {
    const product = findNodeByType(block, 'Product');
    if (!product) continue;

    const offer = findNodeByType(product['offers'], 'Offer') ?? findNodeByType(block, 'Offer');
    const firstImage = Array.isArray(product['image']) ? product['image'][0] : product['image'];

    const shipping = offer
      ? findNodeByType(offer['shippingDetails'], 'OfferShippingDetails')
      : null;
    const shippingRate = shipping
      ? findNodeByType(shipping['shippingRate'], 'MonetaryAmount')
      : null;

    const result: StructuredProduct = {
      name: toText(product['name']),
      brand: toText(product['brand']),
      description: toText(product['description']),
      image: typeof firstImage === 'string' ? firstImage : toText(firstImage),
      sku: toText(product['sku']) ?? toText(product['mpn']),
      price: offer ? toNumber(offer['price'] ?? offer['lowPrice']) : undefined,
      currency: offer ? toText(offer['priceCurrency']) : undefined,
      availability: offer ? mapSchemaAvailability(offer['availability']) : undefined,
      shippingPrice: shippingRate ? toNumber(shippingRate['value']) : undefined,
    };

    // A product node without a price is not usable for price tracking.
    if (result.price != null) return result;
  }

  return null;
}
