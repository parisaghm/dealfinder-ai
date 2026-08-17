import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * Playwright starts both servers itself, so `npm run test:e2e` is a single
 * command from a cold start. The database must already be running
 * (`npm run db:dev && npm run db:seed`), because the suite asserts against the
 * seeded catalogue.
 *
 * The tests run against the real API and the real database — no request
 * interception. A green run therefore means the whole stack works, which is the
 * only thing an E2E suite is actually good for.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 45_000,
  /**
   * 15 seconds rather than 10.
   *
   * Every assertion is unchanged; only the patience is. The failures this fixes
   * were the suite disbelieving correct behaviour: a watchlist edit that saved,
   * invalidated and refetched in a little over ten seconds on a loaded machine
   * reported as "expected 250, received 300" — a wrong-looking value that was
   * simply the previous render. Assertions still fail promptly when the app is
   * actually wrong, because a wrong value never becomes right no matter how long
   * you wait, and the per-test timeout still bounds a genuinely stuck run.
   */
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'npm run dev:api',
      url: 'http://127.0.0.1:4000/api/health',
      reuseExistingServer: true,
      /**
       * Longer than the 60-second default, because the readiness probe here is a
       * *dependency-checked* health endpoint: it queries the database, and the
       * first query against the local PGlite server after a heavy run — the API
       * integration suite, say — can take tens of seconds on its own. Twice now a
       * whole suite has reported "Timed out waiting from config.webServer" with a
       * database that was demonstrably healthy seconds later.
       *
       * This waits longer for a real signal rather than accepting a weaker one:
       * the probe still has to see the database up before a single test runs.
       */
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      /**
       * The suite is one browser on one IP, and the rate limiter cannot tell
       * that from an attack.
       *
       * 120 requests a minute is a sensible production default and an
       * unrealistically low ceiling for an automated run: every page load costs
       * several API calls, so a suite of this length crosses it partway through
       * and the remaining tests get 429s that surface as blank pages. Raising
       * it here removes an artificial throttle rather than weakening anything —
       * the limiter itself is still exercised by the API integration tests.
       *
       * The monitor is off for the same reason `apps/api/vitest.config.ts`
       * silences the provider latency: a background job rewriting the prices
       * the assertions are about is a source of flakiness, not of coverage.
       */
      env: {
        RATE_LIMIT_MAX: '10000',
        MONITOR_ENABLED: 'false',
        /**
         * Keep the single dev connection instead of reconnecting between
         * requests.
         *
         * The 2-second default exists so another tool can reach the database
         * while the API is running; during an end-to-end run nothing else does,
         * and the reconnect it forces on every request more than two seconds
         * apart occasionally exceeds the connection timeout, surfacing as an
         * intermittent 500 and a blank page. Raising it removes a source of
         * flakiness rather than hiding one — the queries themselves are
         * unchanged, and the API integration tests still run on the default.
         */
        DATABASE_IDLE_TIMEOUT_MS: '120000',
        /**
         * Wait for the database rather than 500 at it.
         *
         * Under a full suite the PGlite server slows down enough that acquiring a
         * connection exceeds node-postgres' 10-second default. The request then
         * fails with a 500, the page renders empty, and the test reports
         * "element(s) not found" — which reads as a broken selector and is
         * nothing of the kind. Waiting longer surfaces the real result; the
         * per-test timeout still bounds how long a genuinely stuck run can take.
         */
        DATABASE_CONNECT_TIMEOUT_MS: '30000',
      },
    },
    {
      command: 'npm run dev:web',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      // Matched to the API's, so a slow machine fails both or neither.
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
