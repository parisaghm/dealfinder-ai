import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Component-test setup.
 *
 * `cleanup` after every test keeps one test's DOM from leaking into the next —
 * the usual cause of a suite that passes alone and fails together.
 */
afterEach(() => {
  cleanup();
  // Restore the default (wide) viewport for the next test, so a test that
  // narrows it cannot silently change what every later test renders.
  setViewportMatches(true);
});

/**
 * jsdom implements no `matchMedia`, and the offer comparison table switches
 * layout on it.
 *
 * Defaulting to "matches" means the wide `<table>` is what tests see unless
 * they ask otherwise — the semantically richer branch, and the one most
 * assertions are about. `setViewportMatches(false)` opts a single test into the
 * mobile card list, so *both* branches get real coverage rather than one being
 * permanently invisible.
 */
let viewportMatches = true;

export function setViewportMatches(matches: boolean): void {
  viewportMatches = matches;
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: vi.fn((query: string) => ({
    matches: viewportMatches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
