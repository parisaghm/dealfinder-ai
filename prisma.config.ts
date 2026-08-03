import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * In Prisma 7 the datasource URL, the migrations directory and the seed
 * command all live here rather than in schema.prisma or package.json.
 * Note that `prisma migrate dev` no longer runs `generate` or the seed script
 * implicitly — the npm scripts chain them explicitly.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
