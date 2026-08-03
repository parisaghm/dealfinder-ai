import { COUNTRIES } from '@deal-finder/shared';
import type { PrismaClient } from './generated/prisma/client';

/**
 * Mirror the shared country table into the database.
 *
 * The static table in `@deal-finder/shared` is the source of truth; this copy
 * exists so `StoreOffer.countryCode` can be a real foreign key and so store and
 * offer queries can join on it. Keeping authority in code means no code path can
 * consult a country the type system does not know about.
 *
 * Idempotent by construction: an upsert per row, and the update branch writes the
 * same values the static table already defines. Safe to run before every backfill
 * and every seed, and safe to run twice.
 */
export async function syncCountries(prisma: PrismaClient): Promise<number> {
  for (const country of COUNTRIES) {
    const data = {
      name: country.name,
      currency: country.currency,
      isEuMember: country.isEuMember,
      isEeaMember: country.isEeaMember,
      isSupported: country.isSupported,
      standardVatPercent: country.standardVatPercent,
    };

    await prisma.country.upsert({
      where: { code: country.code },
      create: { code: country.code, ...data },
      update: data,
    });
  }

  return COUNTRIES.length;
}

/**
 * Check the database mirror still agrees with the shared table.
 *
 * Called at API startup. Drift is logged rather than thrown on, because a stale
 * mirror degrades a country name in the UI, whereas refusing to boot takes the
 * whole application down — the wrong trade for a cosmetic inconsistency. A
 * missing row is different and is reported as such, since a foreign key will
 * reject offers for it.
 */
export async function checkCountryMirror(
  prisma: PrismaClient,
): Promise<{ missing: string[]; mismatched: string[] }> {
  const rows = await prisma.country.findMany({
    select: { code: true, name: true, currency: true, isSupported: true },
  });
  const byCode = new Map(rows.map((row) => [row.code, row]));

  const missing: string[] = [];
  const mismatched: string[] = [];

  for (const country of COUNTRIES) {
    const row = byCode.get(country.code);
    if (row == null) {
      missing.push(country.code);
      continue;
    }
    if (
      row.name !== country.name ||
      row.currency !== country.currency ||
      row.isSupported !== country.isSupported
    ) {
      mismatched.push(country.code);
    }
  }

  return { missing, mismatched };
}
