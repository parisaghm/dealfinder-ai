import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import cron from 'node-cron';
import { z } from 'zod';

/**
 * Environment validation.
 *
 * Parsed once, at import time, and the process refuses to start on invalid
 * configuration. Failing loudly at boot with a list of exactly what is wrong is
 * far cheaper than discovering a typo in `MONITOR_CRON` when the first alert
 * silently never fires, or a missing SMTP host at 3am.
 */

// Resolve paths relative to this file rather than to the working directory, so
// `npm run dev -w @deal-finder/api` (cwd = apps/api), a bare
// `node dist/index.js` and `vitest` all agree on where the repository root is.
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Repository root. Relative paths in configuration (e.g. `EMAIL_OUTPUT_DIR`)
 * are documented relative to the repo root, so they must be resolved against
 * this and never against `process.cwd()`.
 */
export const REPO_ROOT = path.resolve(here, '../../..');

loadDotenv({ path: path.join(REPO_ROOT, '.env'), quiet: true });

/** Resolve a configured path, honouring absolute values as given. */
export function resolveFromRepoRoot(target: string): string {
  return path.isAbsolute(target) ? target : path.resolve(REPO_ROOT, target);
}

/** Accepts the spellings people actually write in .env files. */
const booleanEnv = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value == null || value.trim() === '') return defaultValue;
      return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
    });

const intEnv = (defaultValue: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(defaultValue);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TZ: z.string().default('Europe/Helsinki'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required. Run `npm run db:dev` to start one.'),

    API_PORT: intEnv(4000, 1, 65535),
    API_HOST: z.string().default('0.0.0.0'),

    /** Comma-separated browser origins permitted by CORS. */
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),

    APP_URL: z.string().default('http://localhost:5173'),

    RATE_LIMIT_WINDOW_MS: intEnv(60_000, 1_000, 3_600_000),
    RATE_LIMIT_MAX: intEnv(120, 1, 100_000),

    DEV_USER_EMAIL: z.string().min(3).default('demo@dealfinder.test'),
    DEV_USER_NAME: z.string().default('Demo User'),

    PROVIDER_MODE: z.enum(['mock', 'live']).default('mock'),
    PROVIDER_TIMEOUT_MS: intEnv(10_000, 100, 120_000),
    PROVIDER_MAX_RETRIES: intEnv(2, 0, 10),
    PROVIDER_MAX_CONCURRENCY: intEnv(3, 1, 32),
    PROVIDER_MOCK_MIN_LATENCY_MS: intEnv(40, 0, 10_000),
    PROVIDER_MOCK_MAX_LATENCY_MS: intEnv(180, 0, 10_000),
    PROVIDER_MOCK_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),

    /**
     * Cross-store matching thresholds. See docs/product-matching.md.
     *
     * Raising `MATCH_AUTO_ATTACH_MIN_SCORE` makes the matcher more cautious:
     * more pairs land in the review queue instead of being grouped. Raising
     * `MATCH_REVIEW_MIN_SCORE` shrinks the queue by discarding weaker pairs
     * outright. Neither can cause a *silent* merge — the confidence rules and
     * the variant conflict caps are not configurable, by design.
     */
    MATCH_AUTO_ATTACH_MIN_SCORE: intEnv(88, 50, 100),
    MATCH_REVIEW_MIN_SCORE: intEnv(62, 1, 100),

    /**
     * AI-assisted review of ambiguous candidates. Off, and shipped with no
     * implementation: the deterministic engine is the thing that decides, and
     * the application must work with no API key at all.
     */
    MATCH_AI_REVIEW_ENABLED: booleanEnv(false),
    /** Let an AI endorsement stand in for a human approval. Off. */
    MATCH_AI_AUTO_APPROVE: booleanEnv(false),

    /**
     * How old a recorded exchange rate may be before a converted total stops
     * being trusted.
     *
     * A rate older than this is still *shown*, labelled with its age, because
     * hiding a genuinely relevant cross-border offer is its own kind of
     * dishonesty. What it may not do is win a cheapest-delivered comparison or
     * trigger a delivered-price alert — an email that says "this is now under
     * your target" must not rest on a rate from last week.
     *
     * 48 hours by default: long enough that the seeded demo rates work offline
     * for a couple of days, short enough that a stalled FX job becomes visible.
     */
    FX_RATE_MAX_AGE_HOURS: intEnv(48, 1, 24 * 365),

    MONITOR_ENABLED: booleanEnv(true),
    MONITOR_CRON: z.string().default('*/30 * * * *'),
    MONITOR_BATCH_SIZE: intEnv(25, 1, 1000),
    ALERT_COOLDOWN_HOURS: intEnv(12, 0, 24 * 30),

    EMAIL_TRANSPORT: z.enum(['stream', 'json', 'smtp']).default('stream'),
    EMAIL_FROM: z.string().default('DealFinder AI <alerts@dealfinder.test>'),
    EMAIL_OUTPUT_DIR: z.string().default('apps/api/.mail'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: intEnv(587, 1, 65535),
    SMTP_SECURE: booleanEnv(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    PRISMA_LOG_QUERIES: booleanEnv(false),
  })
  .superRefine((value, ctx) => {
    // Inverting the two thresholds would make every reviewable pair also
    // auto-attachable, quietly turning the review queue off.
    if (value.MATCH_REVIEW_MIN_SCORE >= value.MATCH_AUTO_ATTACH_MIN_SCORE) {
      ctx.addIssue({
        code: 'custom',
        path: ['MATCH_REVIEW_MIN_SCORE'],
        message: `MATCH_REVIEW_MIN_SCORE (${value.MATCH_REVIEW_MIN_SCORE}) must be below MATCH_AUTO_ATTACH_MIN_SCORE (${value.MATCH_AUTO_ATTACH_MIN_SCORE}), or nothing would ever reach the review queue.`,
      });
    }

    // An invalid cron expression would otherwise mean alerts simply never run.
    if (!cron.validate(value.MONITOR_CRON)) {
      ctx.addIssue({
        code: 'custom',
        path: ['MONITOR_CRON'],
        message: `"${value.MONITOR_CRON}" is not a valid cron expression (5 fields, e.g. "*/30 * * * *").`,
      });
    }

    if (value.EMAIL_TRANSPORT === 'smtp' && !value.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required when EMAIL_TRANSPORT=smtp.',
      });
    }

    if (value.PROVIDER_MOCK_MAX_LATENCY_MS < value.PROVIDER_MOCK_MIN_LATENCY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['PROVIDER_MOCK_MAX_LATENCY_MS'],
        message: 'PROVIDER_MOCK_MAX_LATENCY_MS must be greater than or equal to the minimum.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    console.error(
      `\nInvalid environment configuration:\n${details}\n\nCopy .env.example to .env and correct the values above.\n`,
    );
    process.exit(1);
  }

  return result.data;
}

export const env: Env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Exported for tests, which need to assert on validation without exiting. */
export function validateEnv(source: NodeJS.ProcessEnv) {
  return envSchema.safeParse(source);
}
