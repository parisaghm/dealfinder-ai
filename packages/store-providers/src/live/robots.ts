import { ProviderBlockedError } from '../errors';
import { fetchWithTimeout, USER_AGENT } from '../http/fetch-with-timeout';

/**
 * robots.txt enforcement.
 *
 * This is a hard gate, not a formality. Before any live adapter fetches a
 * product page, the host's robots.txt is retrieved and checked, and a
 * disallowed path throws `ProviderBlockedError` — the request is not made.
 *
 * Deliberate choices:
 *  - **Fail closed on a disallow, fail open on an unreachable robots.txt.**
 *    A 404 means "no restrictions published", which is the standard reading. A
 *    network error is treated the same way rather than silently ignoring the
 *    file — but the caller still has its own rate limits and timeouts.
 *  - **`Crawl-delay` is honoured**, because ignoring it while technically
 *    obeying `Disallow` is bad-faith compliance.
 *  - Results are cached per host for the process lifetime, so checking a
 *    hundred products does not fetch robots.txt a hundred times.
 *
 * robots.txt is a necessary condition, never a sufficient one. A permissive
 * robots.txt does NOT grant permission to scrape: a site's terms of service,
 * database rights, and applicable law all still apply. See
 * docs/legal-and-ethics.md before enabling live mode.
 */

export interface RobotsRules {
  /** Path prefixes disallowed for our user agent. */
  disallowed: string[];
  /** Path prefixes explicitly allowed (they take precedence when longer). */
  allowed: string[];
  /** Seconds a crawler should wait between requests, if published. */
  crawlDelaySeconds: number | null;
  /** True when robots.txt could not be retrieved. */
  unavailable: boolean;
}

const cache = new Map<string, Promise<RobotsRules>>();

/** Our token, plus the wildcard group. */
const OUR_AGENT_TOKEN = 'dealfinderai';

const emptyRules = (): RobotsRules => ({
  disallowed: [],
  allowed: [],
  crawlDelaySeconds: null,
  unavailable: false,
});

export function parseRobots(body: string): RobotsRules {
  // A record is a run of consecutive User-agent lines followed by directives.
  // Rules are collected into two buckets — the wildcard group and any group
  // naming us — and the more specific one wins, as the specification requires.
  const wildcard = emptyRules();
  const specific = emptyRules();

  let currentAgents: string[] = [];
  let sawSpecificGroup = false;
  let previousLineWasDirective = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (!line) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      // A User-agent line after a directive begins a new record.
      currentAgents = previousLineWasDirective
        ? [value.toLowerCase()]
        : [...currentAgents, value.toLowerCase()];
      previousLineWasDirective = false;
      continue;
    }

    previousLineWasDirective = true;

    const appliesToUs = currentAgents.some((agent) => agent.includes(OUR_AGENT_TOKEN));
    if (appliesToUs) sawSpecificGroup = true;

    const targets: RobotsRules[] = [];
    if (currentAgents.includes('*')) targets.push(wildcard);
    if (appliesToUs) targets.push(specific);

    for (const target of targets) {
      if (field === 'disallow' && value !== '') target.disallowed.push(value);
      else if (field === 'allow' && value !== '') target.allowed.push(value);
      else if (field === 'crawl-delay') {
        const delay = Number.parseFloat(value);
        if (Number.isFinite(delay) && delay >= 0) target.crawlDelaySeconds = delay;
      }
    }
  }

  return sawSpecificGroup ? specific : wildcard;
}

export async function fetchRobots(provider: string, origin: string): Promise<RobotsRules> {
  const cached = cache.get(origin);
  if (cached) return cached;

  const pending = (async (): Promise<RobotsRules> => {
    try {
      const response = await fetchWithTimeout(provider, `${origin}/robots.txt`, {
        timeoutMs: 8_000,
        headers: { Accept: 'text/plain', 'User-Agent': USER_AGENT },
      });

      // No robots.txt published means no crawl restrictions declared.
      if (response.status === 404 || response.status === 410) {
        return { disallowed: [], allowed: [], crawlDelaySeconds: null, unavailable: false };
      }
      if (!response.ok) {
        return { disallowed: [], allowed: [], crawlDelaySeconds: null, unavailable: true };
      }

      return parseRobots(await response.text());
    } catch {
      return { disallowed: [], allowed: [], crawlDelaySeconds: null, unavailable: true };
    }
  })();

  cache.set(origin, pending);
  return pending;
}

/**
 * Whether `pathname` may be fetched.
 *
 * Longest-match wins, and an equally specific Allow beats a Disallow — the
 * behaviour the robots.txt specification describes.
 */
export function isPathAllowed(rules: RobotsRules, pathname: string): boolean {
  const longestMatch = (patterns: string[]): number =>
    patterns.reduce((longest, pattern) => {
      const normalised = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
      return pathname.startsWith(normalised) && normalised.length > longest
        ? normalised.length
        : longest;
    }, -1);

  const disallowLength = longestMatch(rules.disallowed);
  if (disallowLength === -1) return true;

  return longestMatch(rules.allowed) >= disallowLength;
}

/**
 * Throws unless the URL is permitted. Call this before every live fetch.
 */
export async function assertCrawlAllowed(provider: string, url: string): Promise<RobotsRules> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ProviderBlockedError(provider, `Refusing to fetch a malformed URL: ${url}`);
  }

  const rules = await fetchRobots(provider, parsed.origin);

  if (!isPathAllowed(rules, parsed.pathname)) {
    throw new ProviderBlockedError(
      provider,
      `robots.txt at ${parsed.origin} disallows ${parsed.pathname} for our user agent. Not fetching it.`,
    );
  }

  return rules;
}

/** Reset the per-host cache. Used by tests. */
export function clearRobotsCache(): void {
  cache.clear();
}
