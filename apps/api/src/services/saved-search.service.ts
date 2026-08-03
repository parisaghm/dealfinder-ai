import { decimalToNumber, type Prisma, type PrismaClient } from '@deal-finder/db';
import {
  DEFAULT_VERTICAL_ID,
  type CreateSavedSearchInput,
  type SavedSearch,
  type SavedSearchesResponse,
  type UpdateSavedSearchInput,
} from '@deal-finder/shared';
import { ApiError } from '../errors';

/** Saved searches: stored filter sets the user can re-run from the dashboard. */

type SavedSearchRow = Prisma.SavedSearchGetPayload<object>;

export function toSavedSearch(row: SavedSearchRow): SavedSearch {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    maximumPrice: decimalToNumber(row.maximumPrice),
    minimumDiscount: row.minimumDiscount,
    category: row.category,
    stores: row.stores,
    vertical: row.vertical,
    alertsEnabled: row.alertsEnabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSavedSearches(
  prisma: PrismaClient,
  userId: string,
): Promise<SavedSearchesResponse> {
  const rows = await prisma.savedSearch.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  return { items: rows.map(toSavedSearch), total: rows.length };
}

export async function createSavedSearch(
  prisma: PrismaClient,
  userId: string,
  input: CreateSavedSearchInput,
): Promise<SavedSearch> {
  const row = await prisma.savedSearch.create({
    data: {
      userId,
      name: input.name ?? null,
      query: input.query ?? null,
      maximumPrice: input.maximumPrice ?? null,
      minimumDiscount: input.minimumDiscount ?? null,
      category: input.category ?? null,
      stores: input.stores ?? [],
      vertical: input.vertical ?? DEFAULT_VERTICAL_ID,
      alertsEnabled: input.alertsEnabled ?? false,
    },
  });
  return toSavedSearch(row);
}

export async function updateSavedSearch(
  prisma: PrismaClient,
  userId: string,
  searchId: string,
  input: UpdateSavedSearchInput,
): Promise<SavedSearch> {
  // Only assign fields the client actually sent, so a PATCH cannot blank out
  // criteria it never mentioned.
  const data: Prisma.SavedSearchUpdateManyMutationInput = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.query !== undefined ? { query: input.query } : {}),
    ...(input.maximumPrice !== undefined ? { maximumPrice: input.maximumPrice } : {}),
    ...(input.minimumDiscount !== undefined ? { minimumDiscount: input.minimumDiscount } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.stores !== undefined ? { stores: input.stores } : {}),
    ...(input.vertical !== undefined ? { vertical: input.vertical } : {}),
    ...(input.alertsEnabled !== undefined ? { alertsEnabled: input.alertsEnabled } : {}),
  };

  const result = await prisma.savedSearch.updateMany({ where: { id: searchId, userId }, data });
  if (result.count === 0) throw ApiError.notFound('Saved search');

  const row = await prisma.savedSearch.findUnique({ where: { id: searchId } });
  if (!row) throw ApiError.notFound('Saved search');
  return toSavedSearch(row);
}

export async function deleteSavedSearch(
  prisma: PrismaClient,
  userId: string,
  searchId: string,
): Promise<void> {
  const result = await prisma.savedSearch.deleteMany({ where: { id: searchId, userId } });
  if (result.count === 0) throw ApiError.notFound('Saved search');
}
