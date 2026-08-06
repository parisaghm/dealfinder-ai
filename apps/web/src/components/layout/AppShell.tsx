import { cn } from '@deal-finder/ui';
import { BarChart3, Bookmark, Search, Settings, Tag } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { DestinationProvider } from '../../lib/destination';
import { useSettings } from '../../lib/queries';
import {
  LG_BREAKPOINT_QUERY,
  MD_BREAKPOINT_QUERY,
  useMediaQuery,
} from '../../lib/use-media-query';
import { DestinationControls } from './DestinationControls';

/**
 * Application shell: header navigation, main landmark, footer.
 *
 * Accessibility decisions worth noting:
 *  - a skip link is the first focusable element, so keyboard users can jump
 *    past the navigation on every page,
 *  - `<nav>`/`<main>`/`<footer>` landmarks let screen readers navigate by
 *    region,
 *  - the active link is marked with `aria-current="page"`, not just a colour.
 */

const NAV_ITEMS = [
  { to: '/search', label: 'Search deals', icon: Search },
  { to: '/watchlist', label: 'Watchlist', icon: Bookmark },
  { to: '/dashboard', label: 'Dashboard', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/**
 * Wraps the shell in the destination provider.
 *
 * Separate from `AppShell` only because the provider needs `useSearchParams`,
 * which requires a router above it, and because the settings query that seeds
 * the controls must sit outside the component that reads the context.
 *
 * The settings values are *defaults for the controls*, never an activator: every
 * user row carries `FI`/`EUR`/`local` whether or not anyone chose them, so
 * treating them as a choice would switch destination mode on for a first-time
 * visitor who has expressed no preference.
 */
export function AppShell() {
  const settings = useSettings();

  return (
    <DestinationProvider
      settingsDefaults={
        settings.data
          ? {
              country: settings.data.defaultCountryCode,
              currency: settings.data.currency,
              region: settings.data.defaultStoreRegion,
            }
          : null
      }
    >
      <AppShellLayout />
    </DestinationProvider>
  );
}

function AppShellLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

  /**
   * Which single copy of the destination controls is mounted.
   *
   * Decided in JavaScript rather than with `hidden lg:flex` / `md:block lg:hidden`,
   * because those leave every copy in the DOM at every width. Two `<select>`
   * elements both labelled "Deliver to" is not merely untidy: `getByLabel` matches
   * hidden elements, so it makes the control ambiguous to every test and to
   * anything else driving the page, and `SegmentedControl` is built on real radios
   * whose groups would then have to be kept from fighting by name alone.
   *
   * `useMediaQuery` returns true with no `matchMedia`, so a non-browser render
   * falls to the single header copy rather than to none.
   */
  const atLeastMd = useMediaQuery(MD_BREAKPOINT_QUERY);
  const atLeastLg = useMediaQuery(LG_BREAKPOINT_QUERY);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="skip-link text-sm font-semibold text-accent-700">
        Skip to main content
      </a>

      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur-[2px]">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
            onClick={() => setMobileNavOpen(false)}
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent-700 text-white">
              <Tag className="size-4" aria-hidden="true" />
            </span>
            <span className="text-[0.9375rem]">
              DealFinder <span className="text-accent-700">AI</span>
            </span>
          </Link>

          <nav aria-label="Main" className="hidden flex-1 items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-accent-50 text-accent-800'
                      : 'text-ink-700 hover:bg-surface-muted hover:text-ink-900',
                  )
                }
                aria-current={location.pathname.startsWith(item.to) ? 'page' : undefined}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 md:ml-0">
            {/*
              Replaces the old static "Electronics · Finland · EUR" caption. That
              string was a claim the product could not act on; these are the
              controls that make it true. Placed after the nav in DOM order so the
              skip link remains the first focusable element on every page.
            */}
            {atLeastLg && <DestinationControls idPrefix="header" layout="header" />}

            <button
              type="button"
              className="rounded-lg border border-line-strong p-2 text-ink-700 md:hidden"
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-nav"
              aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
                {mobileNavOpen ? (
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                ) : (
                  <path
                    d="M4 7h16M4 12h16M4 17h16"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                )}
              </svg>
            </button>
          </div>
        </div>

        {mobileNavOpen && (
          <nav
            id="mobile-nav"
            aria-label="Main"
            className="border-t border-line bg-surface px-4 py-2 md:hidden"
          >
            <ul className="flex flex-col">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={() => setMobileNavOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium',
                          isActive ? 'bg-accent-50 text-accent-800' : 'text-ink-700',
                        )
                      }
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {item.label}
                    </NavLink>
                  </li>
                );
              })}
            </ul>

            {/*
              The narrow copy. The panel only exists below `md` and only while
              open, and the other two copies are mounted on mutually exclusive
              breakpoints, so exactly one set of these inputs is ever in the DOM.
            */}
            <DestinationControls idPrefix="mobile" layout="panel" className="mt-2" />
          </nav>
        )}

        {/*
          Between `md` and `lg` the header has room for the nav but not for three
          controls, and the hamburger is hidden. Without this band the destination
          would be unreachable in that range.
        */}
        {atLeastMd && !atLeastLg && (
          <div className="border-t border-line bg-surface px-4 py-2">
            <DestinationControls idPrefix="tablet" layout="header" className="justify-end" />
          </div>
        )}
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            DealFinder AI — a development MVP. Prices come from sample data unless live providers
            are enabled.
          </p>
          <p>
            Deal quality is an automated heuristic based on recorded price history, not financial
            advice.{' '}
            {/*
              The only entry point to the internal review queue. Deliberately
              here and not in the main nav: it is a team tool whose decisions
              affect every visitor, and listing it beside "Watchlist" would
              misrepresent it. Last in the tab order, so it does not disturb the
              keyboard path to the real navigation.
            */}
            <Link to="/admin/match-review" className="text-ink-400 underline hover:text-accent-700">
              Match review (internal)
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
