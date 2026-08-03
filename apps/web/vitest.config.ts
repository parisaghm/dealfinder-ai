import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    // Tailwind is not processed for component tests: these assert behaviour and
    // accessibility, not appearance. Visual checks are the Playwright suite's job.
    css: false,
  },
});
