import { defineConfig } from 'tsup';

/**
 * Production build for the API.
 *
 * The workspace packages ship TypeScript source rather than compiled output
 * (which is what lets `tsx` and Vite consume them directly in development), so
 * they must be **bundled** here — hence `noExternal`. Everything in
 * node_modules stays external and is resolved at runtime, as normal.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  // No .d.ts: this is an application entry point, not a published library.
  dts: false,
  splitting: false,
  // Bundle our own packages (they are TypeScript source, not dist output).
  noExternal: [/^@deal-finder\//],
  external: [
    // Loaded via dynamic import only when PROVIDER_MODE=live, and not a
    // dependency of this app — it must stay a runtime resolution.
    'playwright',
    // Development-only pino transport.
    'pino-pretty',
  ],
  /**
   * Provide `require` in the ESM bundle.
   *
   * Some bundled transitive code (the generated Prisma client's runtime among
   * it) still uses CommonJS `require`. Without this shim the output crashes at
   * startup with `Dynamic require of "events" is not supported` — it builds
   * cleanly and fails only when run, which is the worst kind of build bug.
   */
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
});
