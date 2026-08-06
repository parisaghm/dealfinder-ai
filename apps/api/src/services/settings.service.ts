import type { PrismaClient } from '@deal-finder/db';
import type {
  ClearDataInput,
  ClearDataResponse,
  CountryCode,
  Currency,
  DeliveryTimePreference,
  StoreRegion,
  UpdateUserSettingsInput,
  UserSettings,
} from '@deal-finder/shared';
import { ApiError } from '../errors';

/**
 * User settings and the destructive data controls from the settings page.
 */

export async function getUserSettings(
  prisma: PrismaClient,
  userId: string,
): Promise<UserSettings> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, settings: true },
  });
  if (!user) throw ApiError.notFound('User');

  // Settings are created alongside the user, but a row can be missing for a
  // user created before this table existed — create it on read rather than
  // failing.
  const settings =
    user.settings ??
    (await prisma.userSettings.create({ data: { userId } }));

  return {
    email: user.email,
    name: user.name,
    notifyByEmail: settings.notifyByEmail,
    notifyOnTargetReached: settings.notifyOnTargetReached,
    notifyOnPriceDrop: settings.notifyOnPriceDrop,
    checkFrequency: settings.checkFrequency,
    preferredStores: settings.preferredStores,
    preferredCategories: settings.preferredCategories,
    currency: settings.currency as Currency,

    // Narrowed at this boundary: the columns are plain text so a new country or
    // region needs no migration, and the shared enums are the authority on what
    // those strings may be.
    defaultCountryCode: settings.defaultCountryCode as CountryCode,
    defaultStoreRegion: settings.defaultStoreRegion as StoreRegion,
    preferredStoreCountries: settings.preferredStoreCountries as CountryCode[],
    includeNonEuStores: settings.includeNonEuStores,
    showUnknownShipping: settings.showUnknownShipping,
    warnAboutImportCharges: settings.warnAboutImportCharges,
    deliveryTimePreference: settings.deliveryTimePreference as DeliveryTimePreference,

    updatedAt: settings.updatedAt.toISOString(),
  };
}

export async function updateUserSettings(
  prisma: PrismaClient,
  userId: string,
  input: UpdateUserSettingsInput,
): Promise<UserSettings> {
  // Email and name live on User; everything else on UserSettings. Written in a
  // transaction so a rejected email cannot leave preferences half-updated.
  await prisma.$transaction(async (tx) => {
    if (input.email !== undefined || input.name !== undefined) {
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
        },
      });
    }

    const preferences = {
      ...(input.notifyByEmail !== undefined ? { notifyByEmail: input.notifyByEmail } : {}),
      ...(input.notifyOnTargetReached !== undefined
        ? { notifyOnTargetReached: input.notifyOnTargetReached }
        : {}),
      ...(input.notifyOnPriceDrop !== undefined
        ? { notifyOnPriceDrop: input.notifyOnPriceDrop }
        : {}),
      ...(input.checkFrequency !== undefined ? { checkFrequency: input.checkFrequency } : {}),
      ...(input.preferredStores !== undefined ? { preferredStores: input.preferredStores } : {}),
      ...(input.preferredCategories !== undefined
        ? { preferredCategories: input.preferredCategories }
        : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),

      ...(input.defaultCountryCode !== undefined
        ? { defaultCountryCode: input.defaultCountryCode }
        : {}),
      ...(input.defaultStoreRegion !== undefined
        ? { defaultStoreRegion: input.defaultStoreRegion }
        : {}),
      ...(input.preferredStoreCountries !== undefined
        ? { preferredStoreCountries: input.preferredStoreCountries }
        : {}),
      ...(input.includeNonEuStores !== undefined
        ? { includeNonEuStores: input.includeNonEuStores }
        : {}),
      ...(input.showUnknownShipping !== undefined
        ? { showUnknownShipping: input.showUnknownShipping }
        : {}),
      ...(input.warnAboutImportCharges !== undefined
        ? { warnAboutImportCharges: input.warnAboutImportCharges }
        : {}),
      ...(input.deliveryTimePreference !== undefined
        ? { deliveryTimePreference: input.deliveryTimePreference }
        : {}),
    };

    if (Object.keys(preferences).length > 0) {
      await tx.userSettings.upsert({
        where: { userId },
        create: { userId, ...preferences },
        update: preferences,
      });
    }
  });

  return getUserSettings(prisma, userId);
}

/**
 * Delete the user's data.
 *
 * Scoped to the caller and requires an explicit confirmation string in the
 * request body (enforced by `clearDataSchema`), so a stray or replayed request
 * cannot wipe someone's watchlist. Products and price history are shared
 * reference data and are never touched.
 */
export async function clearUserData(
  prisma: PrismaClient,
  userId: string,
  input: ClearDataInput,
): Promise<ClearDataResponse> {
  const clearWatchlist = input.scope === 'watchlist' || input.scope === 'all';
  const clearSavedSearches = input.scope === 'saved-searches' || input.scope === 'all';
  const clearNotifications = input.scope === 'notifications' || input.scope === 'all';

  const deleted = await prisma.$transaction(async (tx) => {
    const watchlistItems = clearWatchlist
      ? (await tx.watchlistItem.deleteMany({ where: { userId } })).count
      : 0;
    const savedSearches = clearSavedSearches
      ? (await tx.savedSearch.deleteMany({ where: { userId } })).count
      : 0;
    const notifications = clearNotifications
      ? (await tx.notification.deleteMany({ where: { userId } })).count
      : 0;

    return { watchlistItems, savedSearches, notifications };
  });

  return { scope: input.scope, deleted };
}
