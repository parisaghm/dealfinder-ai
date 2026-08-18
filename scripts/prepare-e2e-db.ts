import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Create, start and prepare the dedicated end-to-end database.
 *
 *   npm run db:e2e:prepare
 *
 * Idempotent: run it on a fresh machine, or again over an existing instance, and
 * it converges on the same state. It never touches the `default` instance the
 * development server uses.
 *
 * ## Why this script exists rather than a line in the README
 *
 * The port cannot be written down. `prisma dev` **ignores** `--port`,
 * `--db-port` and `--shadow-db-port` in the installed version (v0.16.27) and
 * auto-allocates the next free block per instance, so the database port depends
 * on what else was already running when the instance was created. Asking
 * `prisma dev` to use 51314 and then committing a URL pointing at 51314 produces
 * a config that is wrong on every machine including the one it was written on.
 *
 * So the port is *discovered* from the instance's own metadata after it starts,
 * and `.env.e2e` is generated from that. Nothing here hard-codes a port.
 *
 * ## What it deliberately does not do
 *
 * No `db:reset`, no `prisma migrate reset`, no `--force-reset`. Schema arrives
 * through `migrate deploy`, which needs no shadow database and so steps around
 * the `template1` limitation described in docs/database-environment.md. To start
 * genuinely from scratch, remove the instance first — that is safe here in a way
 * it never is for the development database:
 *
 *   npx prisma dev rm dealfinder-e2e --force && npm run db:e2e:prepare
 */

const INSTANCE = 'dealfinder-e2e';
const ENV_FILE = '.env.e2e';

/** `prisma dev` needs `node:sqlite`, which is still behind a flag on Node 22. */
const PRISMA_DEV_ENV = { ...process.env, NODE_OPTIONS: '--experimental-sqlite' };

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/** Run a command, streaming its output. Exits on failure. */
function run(label: string, command: string, env: NodeJS.ProcessEnv = process.env): void {
  console.log(`\n▸ ${label}\n  $ ${command}`);
  const result = spawnSync(command, { shell: true, stdio: 'inherit', env });
  if (result.status !== 0) fail(`${label} failed (exit ${String(result.status)})`);
}

/** Run a command and capture stdout. */
function capture(command: string, env: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync(command, { shell: true, encoding: 'utf8', env });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

/**
 * Strip ANSI colours and OSC-8 hyperlinks.
 *
 * `prisma dev ls` renders the connection strings as terminal hyperlinks, which
 * embed the URL twice around an escape sequence. Left in place, a naive match on
 * the visible text returns the truncated `postgres://...@localhost:51214/...`
 * form instead of a usable URL.
 */
function plain(text: string): string {
  /* eslint-disable no-control-regex */
  return text.replace(/\x1b\]8;;[^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;]*m/g, '');
  /* eslint-enable no-control-regex */
}

/** `running`, `not_running`, or null when the instance does not exist yet. */
function instanceStatus(): string | null {
  const listing = plain(capture('prisma dev ls', PRISMA_DEV_ENV));
  const match = new RegExp(`^\\s*${INSTANCE}\\s+(\\S+)`, 'm').exec(listing);
  return match?.[1] ?? null;
}

/**
 * Where `prisma dev` keeps its per-instance state.
 *
 * Platform-dependent, so all three locations are tried and `PRISMA_DEV_STATE_DIR`
 * overrides the guess if a future version moves it.
 */
function stateDirCandidates(): string[] {
  const override = process.env['PRISMA_DEV_STATE_DIR'];
  if (override) return [override];

  const dirs: string[] = [];
  if (process.platform === 'win32' && process.env['LOCALAPPDATA']) {
    dirs.push(join(process.env['LOCALAPPDATA'], 'prisma-dev-nodejs'));
  }
  if (process.platform === 'darwin') {
    dirs.push(join(homedir(), 'Library', 'Application Support', 'prisma-dev-nodejs'));
  }
  dirs.push(join(process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'), 'prisma-dev-nodejs'));
  return dirs;
}

/**
 * The database port the instance actually got.
 *
 * Read from `server.json` rather than parsed out of `prisma dev ls`: with more
 * than one instance running, the listing interleaves several URLs across wrapped
 * table rows, and picking the wrong one would point the suite at the development
 * database. The metadata file names its own instance and cannot be confused.
 */
function discoverDatabasePort(): number {
  for (const dir of stateDirCandidates()) {
    const file = join(dir, 'Data', INSTANCE, 'server.json');
    if (!existsSync(file)) continue;

    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const port = (parsed as { databasePort?: unknown }).databasePort;
    if (typeof port !== 'number') fail(`${file} has no numeric databasePort`);

    console.log(`  discovered database port ${String(port)} from ${file}`);
    return port;
  }

  fail(
    `could not find server.json for "${INSTANCE}" in any of:\n` +
      stateDirCandidates()
        .map((dir) => `    ${join(dir, 'Data', INSTANCE, 'server.json')}`)
        .join('\n') +
      `\n  Set PRISMA_DEV_STATE_DIR, or read the port from \`npx prisma dev ls\` and write ${ENV_FILE} by hand` +
      `\n  (copy ${ENV_FILE}.example). Playwright also accepts E2E_DATABASE_URL directly.`,
  );
}

// ── 1. Make sure the instance is up ─────────────────────────────────────────

const status = instanceStatus();
if (status === null) {
  run(`create instance "${INSTANCE}"`, `prisma dev --name ${INSTANCE} --detach`, PRISMA_DEV_ENV);
} else if (status !== 'running') {
  run(`start instance "${INSTANCE}" (was ${status})`, `prisma dev start ${INSTANCE}`, PRISMA_DEV_ENV);
} else {
  console.log(`\n▸ instance "${INSTANCE}" is already running`);
}

if (instanceStatus() !== 'running') fail(`"${INSTANCE}" did not reach the running state`);

// ── 2. Discover the port it was actually given ──────────────────────────────

console.log('\n▸ discovering the allocated database port');
const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${String(
  discoverDatabasePort(),
)}/template1?sslmode=disable`;

// ── 3. Generate the local, gitignored env file ──────────────────────────────

console.log(`\n▸ writing ${ENV_FILE}`);
writeFileSync(
  ENV_FILE,
  [
    `# Generated by scripts/prepare-e2e-db.ts — do not commit (ignored by .env.*).`,
    `# The port is allocated by \`prisma dev\` and differs per machine; re-run`,
    `# \`npm run db:e2e:prepare\` after recreating the instance.`,
    `#`,
    `# Disposable test infrastructure. It must not share state with the`,
    `# long-lived development database. See docs/database-environment.md.`,
    ``,
    `DATABASE_URL="${databaseUrl}"`,
    ``,
    `# PGlite accepts one active connection at a time and queues the rest.`,
    `DATABASE_POOL_MAX=1`,
    ``,
  ].join('\n'),
  'utf8',
);
console.log(`  DATABASE_URL -> ${databaseUrl}`);

// ── 4-7. Schema, data, then prove both ──────────────────────────────────────

const dbEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  DATABASE_POOL_MAX: '1',
};

run('apply migrations (migrate deploy — no shadow database)', 'prisma migrate deploy', dbEnv);
run('seed (idempotent)', 'prisma db seed', dbEnv);
run('row counts and invariants', 'tsx prisma/counts.ts', dbEnv);
run('orphaned-fixture check', 'tsx prisma/check-test-fixtures.ts', dbEnv);

console.log(
  `\n✔ "${INSTANCE}" is ready. \`npm run test:e2e\` will use it via ${ENV_FILE}.\n` +
    `  The development database in .env was not touched.\n`,
);
