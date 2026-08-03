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
  expect: { timeout: 10_000 },
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
      timeout: 60_000,
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
      },
    },
    {
      command: 'npm run dev:web',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
