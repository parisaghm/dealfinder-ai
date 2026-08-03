import 'dotenv/config';

import {
  disconnectPrisma,
  getPrismaClient,
  pruneOrphanedCanonicalProducts,
  resetMachineMatching,
  resolveCanonicalForProduct,
} from '@deal-finder/db';

/**
 * Backfill cross-store matching over every product already in the database.
 *
 * This exists so the feature can be turned on against an *existing* seeded
 * database without a reset. The migration that added the canonical tables is
 * purely additive and contains no data changes at all; this script is the data
 * pass, kept separate so it is re-runnable, resumable and inspectable.
 *
 *   npm run db:match             # attach what can be attached, queue the rest
 *   npm run db:match -- --force  # re-evaluate manual decisions and rejections
 *
 * Sequential by design. With `DATABASE_POOL_MAX=1` the database accepts one
 * connection at a time, so `Promise.all` over products would not go faster —
 * it would just queue on the single connection with less legible failure.
 */

const BATCH_SIZE = 50;

const prisma = getPrismaClient();

interface Tally {
  ALREADY_ATTACHED: number;
  ATTACHED: number;
  CANDIDATES_RECORDED: number;
  CANONICAL_CREATED: number;
  UNMATCHED: number;
  FAILED: number;
}

async function main() {
  const force = process.argv.includes('--force');

  console.log(`Matching products across stores${force ? ' (forced re-evaluation)' : ''}…\n`);

  if (force) {
    // Recompute means recompute: throw away every machine-made decision first,
    // so stale canonical records from an older engine version cannot go on
    // shaping the results. Human decisions are preserved.
    const reset = await resetMachineMatching(prisma);
    console.log(
      `  reset: ${String(reset.detached)} offers detached, ` +
        `${String(reset.candidatesRemoved)} machine candidates cleared, ` +
        `${String(reset.canonicalsPruned)} empty canonicals removed\n`,
    );
  }

  const tally: Tally = {
    ALREADY_ATTACHED: 0,
    ATTACHED: 0,
    CANDIDATES_RECORDED: 0,
    CANONICAL_CREATED: 0,
    UNMATCHED: 0,
    FAILED: 0,
  };

  // Cursor pagination rather than skip/take: the set is being written to as we
  // walk it, and an offset would silently skip rows once one is updated.
  let cursor: string | undefined;
  let processed = 0;

  for (;;) {
    const batch = await prisma.product.findMany({
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, name: true },
    });
    if (batch.length === 0) break;

    for (const product of batch) {
      try {
        const outcome = await resolveCanonicalForProduct(prisma, product.id, { force });
        tally[outcome.action] += 1;
      } catch (error) {
        // One unmatched product must never abort a catalogue-wide pass.
        tally.FAILED += 1;
        console.error(`  ! ${product.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
      processed += 1;
    }

    cursor = batch[batch.length - 1]?.id;
    if (batch.length < BATCH_SIZE) break;
  }

  const pruned = await pruneOrphanedCanonicalProducts(prisma);

  const canonicalCount = await prisma.canonicalProduct.count();
  const multiStore = await prisma.canonicalProduct.findMany({
    where: { offers: { some: {} } },
    select: { id: true, name: true, _count: { select: { offers: true } } },
  });
  const withSeveralOffers = multiStore.filter((entry) => entry._count.offers > 1);
  const pendingCandidates = await prisma.productMatchCandidate.count({ where: { status: 'PENDING' } });

  console.log(
    [
      '',
      `  products processed     ${processed}`,
      `  newly attached         ${tally.ATTACHED}`,
      `  canonicals created     ${tally.CANONICAL_CREATED}`,
      `  already attached       ${tally.ALREADY_ATTACHED}`,
      `  queued for review      ${tally.CANDIDATES_RECORDED}`,
      `  left unmatched         ${tally.UNMATCHED}`,
      ...(tally.FAILED > 0 ? [`  failed                 ${tally.FAILED}`] : []),
      ...(pruned > 0 ? [`  orphaned canonicals removed ${pruned}`] : []),
      '',
      `  canonical products     ${canonicalCount} (${withSeveralOffers.length} sold by more than one store)`,
      `  pending candidates     ${pendingCandidates}`,
      '',
      ...withSeveralOffers
        .slice(0, 10)
        .map((entry) => `    ${String(entry._count.offers)}× ${entry.name}`),
      '',
    ].join('\n'),
  );
}

main()
  .catch((error: unknown) => {
    console.error('\nMatching failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
