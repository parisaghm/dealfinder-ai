import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // These tests talk to a real PostgreSQL instance, so they must not run in
    // parallel against the same rows.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      // The suite deliberately exercises failure paths; their log output would
      // otherwise bury the actual test results.
      LOG_LEVEL: 'silent',
      // Never risk real delivery from a test run.
      EMAIL_TRANSPORT: 'json',
      PROVIDER_MODE: 'mock',
      PROVIDER_MOCK_MIN_LATENCY_MS: '0',
      PROVIDER_MOCK_MAX_LATENCY_MS: '0',
    },
  },
});
