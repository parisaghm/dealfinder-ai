import { describe, expect, it } from 'vitest';
import { isPathAllowed, parseRobots } from './robots';

/**
 * robots.txt enforcement is a compliance control, so its behaviour is pinned
 * down by tests rather than assumed. A bug here means fetching a page a site
 * asked us not to.
 */

describe('parseRobots', () => {
  it('reads the wildcard group', () => {
    const rules = parseRobots(`
      User-agent: *
      Disallow: /checkout
      Disallow: /admin
      Crawl-delay: 5
    `);

    expect(rules.disallowed).toEqual(['/checkout', '/admin']);
    expect(rules.crawlDelaySeconds).toBe(5);
  });

  it('prefers a group naming our agent over the wildcard group', () => {
    const rules = parseRobots(`
      User-agent: *
      Disallow: /

      User-agent: DealFinderAI
      Disallow: /checkout
      Crawl-delay: 2
    `);

    // The specific group wins, so "/" is not inherited from the wildcard.
    expect(rules.disallowed).toEqual(['/checkout']);
    expect(rules.crawlDelaySeconds).toBe(2);
  });

  it('applies a rule shared between the wildcard and our agent', () => {
    const rules = parseRobots(`
      User-agent: *
      User-agent: DealFinderAI
      Disallow: /private
    `);
    expect(rules.disallowed).toEqual(['/private']);
  });

  it('ignores groups for other crawlers', () => {
    const rules = parseRobots(`
      User-agent: SomeOtherBot
      Disallow: /

      User-agent: *
      Disallow: /cart
    `);
    expect(rules.disallowed).toEqual(['/cart']);
  });

  it('strips comments and tolerates junk lines', () => {
    const rules = parseRobots(`
      # a comment
      User-agent: *   # trailing comment
      Disallow: /tmp  # another
      this line has no colon
      Sitemap: https://example.test/sitemap.xml
    `);
    expect(rules.disallowed).toEqual(['/tmp']);
  });

  it('treats an empty Disallow as no restriction', () => {
    const rules = parseRobots(`
      User-agent: *
      Disallow:
    `);
    expect(rules.disallowed).toEqual([]);
  });

  it('records Allow rules', () => {
    const rules = parseRobots(`
      User-agent: *
      Disallow: /product
      Allow: /product/public
    `);
    expect(rules.disallowed).toEqual(['/product']);
    expect(rules.allowed).toEqual(['/product/public']);
  });

  it('handles an empty file', () => {
    expect(parseRobots('')).toEqual({
      disallowed: [],
      allowed: [],
      crawlDelaySeconds: null,
      unavailable: false,
    });
  });
});

describe('isPathAllowed', () => {
  const rules = (disallowed: string[], allowed: string[] = []) => ({
    disallowed,
    allowed,
    crawlDelaySeconds: null,
    unavailable: false,
  });

  it('allows a path no rule matches', () => {
    expect(isPathAllowed(rules(['/checkout']), '/product/123')).toBe(true);
  });

  it('blocks a disallowed prefix', () => {
    expect(isPathAllowed(rules(['/checkout']), '/checkout/step-1')).toBe(false);
  });

  it('blocks everything under a root disallow', () => {
    expect(isPathAllowed(rules(['/']), '/anything')).toBe(false);
  });

  it('lets a more specific Allow override a broader Disallow', () => {
    expect(isPathAllowed(rules(['/product'], ['/product/public']), '/product/public/1')).toBe(true);
    expect(isPathAllowed(rules(['/product'], ['/product/public']), '/product/private/1')).toBe(
      false,
    );
  });

  it('honours a trailing wildcard', () => {
    expect(isPathAllowed(rules(['/search*']), '/search?q=tv')).toBe(false);
  });

  it('allows everything when no rules are published', () => {
    expect(isPathAllowed(rules([]), '/product/123')).toBe(true);
  });
});
