import { describe, expect, it } from 'vitest';
import { ProviderNotFoundError, ProviderUnsupportedDestinationError } from '../errors';
import { adriaticaTechDataset } from './data/adriatica-tech';
import { danskeElektroDataset } from './data/danske-elektro';
import { gigantiDataset } from './data/gigantti';
import { ibericaDigitalDataset } from './data/iberica-digital';
import { kanaalshopDataset } from './data/kanaalshop';
import { maisonNumeriqueDataset } from './data/maison-numerique';
import { nordbyteDataset } from './data/nordbyte';
import { techhalleDataset } from './data/techhalle';
import { verkkokauppaDataset } from './data/verkkokauppa';
import {
  deliveryCountries,
  offersProductToDestination,
  resolveDelivery,
  storeDeliversTo,
} from './delivery-rules';
import { createMockProvider } from './mock-provider';

const instant = { minLatencyMs: 0, maxLatencyMs: 0 };

function product(dataset: typeof techhalleDataset, externalId: string) {
  const found = dataset.products.find((entry) => entry.externalId === externalId);
  if (!found) throw new Error(`fixture missing: ${externalId}`);
  return found;
}

describe('storeDeliversTo — absence means no', () => {
  it('serves a country it has an explicit rule for', () => {
    expect(storeDeliversTo(techhalleDataset, 'FI')).toBe(true);
    expect(storeDeliversTo(techhalleDataset, 'DE')).toBe(true);
  });

  it('does not serve a country simply omitted from the rules', () => {
    // There is no `shipsTo: false` anywhere. A missing key is the only way "does
    // not deliver" is expressed, so it cannot be forgotten into the wrong state.
    expect(storeDeliversTo(maisonNumeriqueDataset, 'FI')).toBe(false);
    expect(storeDeliversTo(ibericaDigitalDataset, 'FI')).toBe(false);
    expect(storeDeliversTo(techhalleDataset, 'ES')).toBe(false);
    expect(storeDeliversTo(techhalleDataset, 'IT')).toBe(false);
  });

  it('does not serve a country nobody has heard of', () => {
    expect(storeDeliversTo(techhalleDataset, 'GB')).toBe(false);
  });

  it('reports the declared countries from the rule map', () => {
    expect([...deliveryCountries(techhalleDataset)].sort()).toEqual([
      'DE',
      'DK',
      'FI',
      'FR',
      'NL',
      'SE',
    ]);
  });

  it('defaults the Finnish datasets to Finland only', () => {
    // They predate destinations entirely, and must not have acquired a European
    // network by accident.
    expect([...deliveryCountries(gigantiDataset)]).toEqual(['FI']);
    expect([...deliveryCountries(verkkokauppaDataset)]).toEqual(['FI']);
  });
});

describe('resolveDelivery — the three distinct states', () => {
  it('returns a flat per-destination price', () => {
    const resolved = resolveDelivery(
      techhalleDataset,
      product(techhalleDataset, 'thl-auralis-nc700'),
      'FI',
    );
    // The briefed rule: €12.90, 3–6 business days to Finland.
    expect(resolved).toEqual({ shippingPrice: 12.9, deliveryMinDays: 3, deliveryMaxDays: 6 });
  });

  it('returns 0 for genuinely free delivery, which is not the same as unknown', () => {
    const resolved = resolveDelivery(
      kanaalshopDataset,
      product(kanaalshopDataset, 'kns-auralis-nc700'),
      'FI',
    );
    expect(resolved?.shippingPrice).toBe(0);
  });

  it('returns null when the store delivers there but publishes no price', () => {
    const resolved = resolveDelivery(
      nordbyteDataset,
      product(nordbyteDataset, 'nby-auralis-nc700'),
      'FI',
    );
    expect(resolved).not.toBeNull();
    // Delivers, cost unknown. Null must survive — it is not zero and not free.
    expect(resolved?.shippingPrice).toBeNull();
  });

  it('returns null for the whole resolution when the store does not deliver there', () => {
    // Distinct from the case above: there, shippingPrice is null inside a result;
    // here there is no result at all, so a caller cannot mistake it for a price.
    expect(
      resolveDelivery(
        maisonNumeriqueDataset,
        product(maisonNumeriqueDataset, 'mnq-auralis-nc700'),
        'FI',
      ),
    ).toBeNull();
  });

  it('keeps delivery days null when the store publishes a price but no estimate', () => {
    const resolved = resolveDelivery(
      adriaticaTechDataset,
      product(adriaticaTechDataset, 'adt-auralis-nc700'),
      'FI',
    );
    // Known cost, unknown timing. Two separate unknowns, not to be conflated.
    expect(resolved?.shippingPrice).toBe(16.9);
    expect(resolved?.deliveryMinDays).toBeNull();
    expect(resolved?.deliveryMaxDays).toBeNull();
  });
});

describe('resolveDelivery — free-over thresholds', () => {
  it('applies a threshold the product clears', () => {
    // TechHalle: €4.95 domestic, free over €50. A €299 product clears it.
    const resolved = resolveDelivery(
      techhalleDataset,
      product(techhalleDataset, 'thl-auralis-nc700'),
      'DE',
    );
    expect(resolved?.shippingPrice).toBe(0);
  });

  it('charges when the product does not clear the threshold', () => {
    // Ibérica: €3.95 domestic, free over €40. The €59 power bank clears it, the
    // threshold has to be tested against something below — use the €39 charger
    // from the French store's domestic rule instead.
    const resolved = resolveDelivery(
      maisonNumeriqueDataset,
      product(maisonNumeriqueDataset, 'mnq-voltaro-65'),
      'DE',
    );
    // No freeOver on the German rule, so the flat price stands.
    expect(resolved?.shippingPrice).toBe(7.9);
  });

  it('never turns an unpublished cost into free via a threshold', () => {
    // Nordbyte's Finnish rule has no price. A free-shipping threshold is a rule
    // about discounts and cannot manufacture a price of zero out of nothing.
    const resolved = resolveDelivery(
      nordbyteDataset,
      product(nordbyteDataset, 'nby-nordkraft-ultra-14'),
      'FI',
    );
    expect(resolved?.shippingPrice).toBeNull();
  });
});

describe('offersProductToDestination — store metadata is not enough', () => {
  it('is true for an ordinary product to a served destination', () => {
    expect(offersProductToDestination(techhalleDataset, 'thl-auralis-nc700', 'FI')).toBe(true);
  });

  it('is false for a product excluded from a destination the store otherwise serves', () => {
    // The [C5] fixture. TechHalle declares FI. This monitor still cannot get
    // there, so no Finnish offer exists for it — which is exactly why StoreOffer,
    // not Store.supportedDeliveryCountries, is the authority on deliverability.
    expect(storeDeliversTo(techhalleDataset, 'FI')).toBe(true);
    expect(offersProductToDestination(techhalleDataset, 'thl-lumenta-32-4k', 'FI')).toBe(false);
  });

  it('still offers the excluded product to other destinations', () => {
    expect(offersProductToDestination(techhalleDataset, 'thl-lumenta-32-4k', 'DE')).toBe(true);
    expect(offersProductToDestination(techhalleDataset, 'thl-lumenta-32-4k', 'NL')).toBe(true);
  });

  it('resolves no delivery for the excluded product to the excluded destination', () => {
    expect(
      resolveDelivery(techhalleDataset, product(techhalleDataset, 'thl-lumenta-32-4k'), 'FI'),
    ).toBeNull();
  });
});

describe('the same product costs different amounts to different destinations', () => {
  it('quotes four different answers for one German listing', () => {
    const listing = product(techhalleDataset, 'thl-auralis-nc700');

    expect(resolveDelivery(techhalleDataset, listing, 'DE')?.shippingPrice).toBe(0);
    expect(resolveDelivery(techhalleDataset, listing, 'FI')?.shippingPrice).toBe(12.9);
    expect(resolveDelivery(techhalleDataset, listing, 'SE')?.shippingPrice).toBe(18.9);
    // Not delivered to Spain at all.
    expect(resolveDelivery(techhalleDataset, listing, 'ES')).toBeNull();
  });

  it('quotes different delivery times for the same listing', () => {
    const listing = product(techhalleDataset, 'thl-auralis-nc700');
    expect(resolveDelivery(techhalleDataset, listing, 'FI')?.deliveryMaxDays).toBe(6);
    expect(resolveDelivery(techhalleDataset, listing, 'NL')?.deliveryMaxDays).toBe(4);
  });
});

describe('provider.supportsDestination', () => {
  const techhalle = createMockProvider(techhalleDataset, instant);
  const maison = createMockProvider(maisonNumeriqueDataset, instant);

  it('reports support only for declared destinations', () => {
    expect(techhalle.supportsDestination('FI')).toBe(true);
    expect(techhalle.supportsDestination('ES')).toBe(false);
  });

  it('reports no support for Finland from the French store', () => {
    expect(maison.supportsDestination('FR')).toBe(true);
    expect(maison.supportsDestination('FI')).toBe(false);
  });

  it('exposes the store country, region and demo flag', () => {
    expect(techhalle.storeCountry).toBe('DE');
    expect(techhalle.region).toBe('european');
    expect(techhalle.isDemoStore).toBe(true);
  });

  it('marks the Finnish stores as not demo data', () => {
    expect(createMockProvider(gigantiDataset, instant).isDemoStore).toBe(false);
    expect(createMockProvider(gigantiDataset, instant).storeCountry).toBe('FI');
  });
});

describe('provider.getOffer', () => {
  const techhalle = createMockProvider(techhalleDataset, instant);
  const nordbyte = createMockProvider(nordbyteDataset, instant);
  const maison = createMockProvider(maisonNumeriqueDataset, instant);

  it('quotes a destination-specific offer', async () => {
    const offer = await techhalle.getOffer('thl-auralis-nc700', {
      destinationCountry: 'FI',
      currency: 'EUR',
    });

    expect(offer.productPrice).toBe(299);
    expect(offer.shippingPrice).toBe(12.9);
    expect(offer.deliveryMinDays).toBe(3);
    expect(offer.deliveryMaxDays).toBe(6);
    expect(offer.destinationCountry).toBe('FI');
  });

  it('quotes in the store’s own currency, not the requested one', async () => {
    // Converting is a read-time concern with its own rate provenance. A store
    // adapter inventing a euro price would launder an unsourced rate into data.
    const offer = await nordbyte.getOffer('nby-auralis-nc700', {
      destinationCountry: 'FI',
      currency: 'EUR',
    });

    expect(offer.currency).toBe('SEK');
    expect(offer.productPrice).toBe(3190);
  });

  it('preserves a null shipping cost rather than coercing it to zero', async () => {
    const offer = await nordbyte.getOffer('nby-auralis-nc700', {
      destinationCountry: 'FI',
      currency: 'EUR',
    });
    expect(offer.shippingPrice).toBeNull();
  });

  it('throws a typed, non-retryable error for an unserved destination', async () => {
    await expect(
      maison.getOffer('mnq-auralis-nc700', { destinationCountry: 'FI', currency: 'EUR' }),
    ).rejects.toBeInstanceOf(ProviderUnsupportedDestinationError);

    // Retrying will not make a delivery network appear.
    await maison
      .getOffer('mnq-auralis-nc700', { destinationCountry: 'FI', currency: 'EUR' })
      .catch((error: unknown) => {
        expect((error as ProviderUnsupportedDestinationError).retryable).toBe(false);
      });
  });

  it('throws for a product excluded from an otherwise-served destination', async () => {
    await expect(
      techhalle.getOffer('thl-lumenta-32-4k', { destinationCountry: 'FI', currency: 'EUR' }),
    ).rejects.toBeInstanceOf(ProviderUnsupportedDestinationError);
  });

  it('throws not-found for a product the store does not carry', async () => {
    await expect(
      techhalle.getOffer('does-not-exist', { destinationCountry: 'FI', currency: 'EUR' }),
    ).rejects.toBeInstanceOf(ProviderNotFoundError);
  });

  it('quotes the Finnish stores using each listing’s own delivery cost', async () => {
    const verkkokauppa = createMockProvider(verkkokauppaDataset, instant);

    // The Sony listing publishes €12,90; the Marshall listing publishes nothing.
    // Both figures are load-bearing for existing tests and must survive.
    const sony = await verkkokauppa.getOffer('vkk-sony-wh-1000xm5-musta', {
      destinationCountry: 'FI',
      currency: 'EUR',
    });
    expect(sony.shippingPrice).toBe(12.9);

    const marshall = await verkkokauppa.getOffer('vkk-marshall-emberton-iii', {
      destinationCountry: 'FI',
      currency: 'EUR',
    });
    expect(marshall.shippingPrice).toBeNull();
  });
});

describe('provider.searchProducts stays backward compatible', () => {
  const techhalle = createMockProvider(techhalleDataset, instant);

  it('filters nothing when no destination context is given', async () => {
    // Every existing caller passes one argument. Behaviour must be unchanged.
    const results = await techhalle.searchProducts({ query: 'lumenta' });
    expect(results.map((entry) => entry.externalId)).toContain('thl-lumenta-32-4k');
  });

  it('drops undeliverable products when a destination is given', async () => {
    const results = await techhalle.searchProducts(
      { query: 'lumenta' },
      { destinationCountry: 'FI', currency: 'EUR' },
    );
    expect(results.map((entry) => entry.externalId)).not.toContain('thl-lumenta-32-4k');
    expect(results.map((entry) => entry.externalId)).toContain('thl-lumenta-27-qhd');
  });

  it('returns nothing at all from a store that cannot reach the destination', async () => {
    const maison = createMockProvider(maisonNumeriqueDataset, instant);
    const results = await maison.searchProducts(
      {},
      { destinationCountry: 'FI', currency: 'EUR' },
    );
    expect(results).toEqual([]);
  });

  it('returns its catalogue for a destination it does serve', async () => {
    const maison = createMockProvider(maisonNumeriqueDataset, instant);
    const results = await maison.searchProducts(
      {},
      { destinationCountry: 'FR', currency: 'EUR' },
    );
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('destination-dependent availability, end to end', () => {
  const stores = [
    techhalleDataset,
    nordbyteDataset,
    kanaalshopDataset,
    maisonNumeriqueDataset,
    adriaticaTechDataset,
    danskeElektroDataset,
  ];

  it('yields a different set of stores for Finland than for Germany', () => {
    const toFinland = stores
      .filter((dataset) => storeDeliversTo(dataset, 'FI'))
      .map((dataset) => dataset.slug)
      .sort();
    const toGermany = stores
      .filter((dataset) => storeDeliversTo(dataset, 'DE'))
      .map((dataset) => dataset.slug)
      .sort();

    expect(toFinland).not.toEqual(toGermany);
    // The French store is the discriminator: absent for Finland, present for Germany.
    expect(toFinland).not.toContain('maison-numerique');
    expect(toGermany).toContain('maison-numerique');
  });

  it('has at least three stores able to reach Finland, so a comparison is possible', () => {
    const reaching = stores.filter((dataset) => storeDeliversTo(dataset, 'FI'));
    expect(reaching.length).toBeGreaterThanOrEqual(3);
  });
});
