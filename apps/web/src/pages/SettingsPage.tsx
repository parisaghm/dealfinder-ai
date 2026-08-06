import {
  CHECK_FREQUENCIES,
  COUNTRIES,
  CURRENCIES,
  DELIVERY_TIME_PREFERENCES,
  STORE_REGIONS,
  countryName,
  type CheckFrequency,
  type CountryCode,
  type Currency,
  type DeliveryTimePreference,
  type StoreRegion,
} from '@deal-finder/shared';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ErrorState,
  Field,
  SegmentedControl,
  Input,
  SectionHeading,
  Select,
  Skeleton,
} from '@deal-finder/ui';
import { AlertTriangle, Mail, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  useClearData,
  useCountries,
  useMeta,
  useSendTestAlert,
  useSettings,
  useStores,
  useUpdateSettings,
} from '../lib/queries';

/**
 * Settings.
 *
 * Two things worth noting:
 *  - the "send a test alert" button exists because a notification feature you
 *    cannot verify is a notification feature you do not trust,
 *  - the destructive controls require typing DELETE, matching the server's own
 *    requirement rather than relying on a confirm() dialog the API would accept
 *    without.
 */

const FREQUENCY_LABEL: Record<CheckFrequency, string> = {
  HOURLY: 'Every hour',
  EVERY_6_HOURS: 'Every 6 hours',
  DAILY: 'Once a day',
  WEEKLY: 'Once a week',
};

const REGION_LABEL: Record<StoreRegion, string> = {
  local: 'Local',
  nordic: 'Nordic',
  european: 'European',
};

const DELIVERY_TIME_LABEL: Record<DeliveryTimePreference, string> = {
  any: 'Any delivery time',
  'under-3-days': 'Within 3 business days',
  'under-7-days': 'Within 7 business days',
  'under-14-days': 'Within 14 business days',
};

export function SettingsPage() {
  const settings = useSettings();
  const { data: meta } = useMeta();
  const countries = useCountries();
  const storeList = useStores(null, null);
  const updateSettings = useUpdateSettings();
  const sendTestAlert = useSendTestAlert();
  const clearData = useClearData();

  const [form, setForm] = useState({
    email: '',
    name: '',
    notifyByEmail: true,
    notifyOnTargetReached: true,
    notifyOnPriceDrop: false,
    checkFrequency: 'EVERY_6_HOURS' as CheckFrequency,
    preferredStores: [] as string[],
    preferredCategories: [] as string[],
    currency: 'EUR' as Currency,

    defaultCountryCode: 'FI' as CountryCode,
    defaultStoreRegion: 'local' as StoreRegion,
    preferredStoreCountries: [] as CountryCode[],
    includeNonEuStores: false,
    showUnknownShipping: false,
    warnAboutImportCharges: true,
    deliveryTimePreference: 'any' as DeliveryTimePreference,
  });
  const [saved, setSaved] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');

  // Populate the form once settings arrive.
  useEffect(() => {
    if (!settings.data) return;
    setForm({
      email: settings.data.email,
      name: settings.data.name ?? '',
      notifyByEmail: settings.data.notifyByEmail,
      notifyOnTargetReached: settings.data.notifyOnTargetReached,
      notifyOnPriceDrop: settings.data.notifyOnPriceDrop,
      checkFrequency: settings.data.checkFrequency,
      preferredStores: settings.data.preferredStores,
      preferredCategories: settings.data.preferredCategories,
      currency: settings.data.currency,

      defaultCountryCode: settings.data.defaultCountryCode,
      defaultStoreRegion: settings.data.defaultStoreRegion,
      preferredStoreCountries: [...settings.data.preferredStoreCountries],
      includeNonEuStores: settings.data.includeNonEuStores,
      showUnknownShipping: settings.data.showUnknownShipping,
      warnAboutImportCharges: settings.data.warnAboutImportCharges,
      deliveryTimePreference: settings.data.deliveryTimePreference,
    });
  }, [settings.data]);

  /**
   * Selectable delivery destinations.
   *
   * The static table is the fallback so the controls work before the request
   * resolves; unsupported countries are listed and disabled rather than hidden,
   * because "not available yet" and "we forgot" are otherwise indistinguishable.
   */
  const countryOptions = useMemo(() => {
    const fromApi = countries.data?.items;
    if (fromApi && fromApi.length > 0) return fromApi;
    return COUNTRIES.map((entry) => ({
      code: entry.code as CountryCode,
      name: entry.name,
      isSupported: entry.isSupported,
    }));
  }, [countries.data]);

  /**
   * Countries we actually have stores in.
   *
   * Derived from the store list rather than from the country table: offering
   * "prefer stores in Portugal" when no Portuguese store exists is a setting that
   * silently does nothing, which is worse than not offering it.
   */
  const storeCountryOptions = useMemo(() => {
    const codes = new Set<CountryCode>();
    for (const store of storeList.data?.items ?? []) {
      if (store.countryCode) codes.add(store.countryCode);
    }
    return [...codes].sort((a, b) => countryName(a).localeCompare(countryName(b)));
  }, [storeList.data]);

  if (settings.isPending) {
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <Skeleton className="h-7 w-32" />
        {Array.from({ length: 3 }, (_, index) => (
          <Card key={index}>
            <Skeleton className="mb-4 h-4 w-40" />
            <Skeleton className="h-24 w-full" />
          </Card>
        ))}
      </div>
    );
  }

  if (settings.isError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <ErrorState onRetry={() => void settings.refetch()} />
      </div>
    );
  }

  const stores = meta?.stores ?? [];
  const categories = meta?.verticals[0]?.categories ?? [];

  const toggle = (key: 'preferredStores' | 'preferredCategories', value: string) =>
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((entry) => entry !== value)
        : [...current[key], value],
    }));

  const save = () => {
    setSaved(false);
    setEmailError(null);

    // Checked here as well as on the server so the user gets a specific message
    // against the field rather than a round trip and a generic 400. The server
    // stays the authority.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setEmailError('Enter a valid email address, for example you@example.com.');
      return;
    }

    updateSettings.mutate(
      {
        email: form.email,
        name: form.name || null,
        notifyByEmail: form.notifyByEmail,
        notifyOnTargetReached: form.notifyOnTargetReached,
        notifyOnPriceDrop: form.notifyOnPriceDrop,
        checkFrequency: form.checkFrequency,
        preferredStores: form.preferredStores,
        preferredCategories: form.preferredCategories,
        currency: form.currency,

        // Sent alongside rather than instead of: a PATCH that omitted the
        // notification fields would be a different request, and the point of
        // sending the whole form is that nothing the user can see gets left behind.
        defaultCountryCode: form.defaultCountryCode,
        defaultStoreRegion: form.defaultStoreRegion,
        preferredStoreCountries: form.preferredStoreCountries,
        includeNonEuStores: form.includeNonEuStores,
        showUnknownShipping: form.showUnknownShipping,
        warnAboutImportCharges: form.warnAboutImportCharges,
        deliveryTimePreference: form.deliveryTimePreference,
      },
      { onSuccess: () => setSaved(true) },
    );
  };

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-ink-500">
          Where alerts go, how often we check, and what to show you by default.
        </p>
      </div>

      {/* ── Account ──────────────────────────────────────────────────────── */}
      <Card className="flex flex-col gap-4">
        <SectionHeading
          title="Account"
          description="This MVP uses a single development user; no password is required."
        />

        <Field label="Email address" description="Price alerts are sent here." error={emailError}>
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="email"
              type="email"
              value={form.email}
              onChange={(event) => {
                setForm({ ...form, email: event.target.value });
                setEmailError(null);
              }}
              autoComplete="email"
            />
          )}
        </Field>

        <Field label="Name">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Optional"
              autoComplete="name"
            />
          )}
        </Field>
      </Card>

      {/* ── Notifications ────────────────────────────────────────────────── */}
      <Card className="flex flex-col gap-4">
        <SectionHeading title="Notifications" />

        <div className="flex flex-col gap-3">
          <Checkbox
            label="Email me about price changes"
            description="Turn this off to pause every alert without losing your targets."
            checked={form.notifyByEmail}
            onChange={(event) => setForm({ ...form, notifyByEmail: event.target.checked })}
          />
          <Checkbox
            label="When a target price is reached"
            checked={form.notifyOnTargetReached}
            disabled={!form.notifyByEmail}
            onChange={(event) => setForm({ ...form, notifyOnTargetReached: event.target.checked })}
          />
          <Checkbox
            label="On any price drop, even above my target"
            description="More emails. Useful while you are deciding what target to set."
            checked={form.notifyOnPriceDrop}
            disabled={!form.notifyByEmail}
            onChange={(event) => setForm({ ...form, notifyOnPriceDrop: event.target.checked })}
          />
        </div>

        <Field
          label="How often to check prices"
          description="The server checks on a schedule; this sets the minimum gap between checks for your products."
        >
          {(fieldProps) => (
            <Select
              {...fieldProps}
              name="checkFrequency"
              value={form.checkFrequency}
              onChange={(event) =>
                setForm({ ...form, checkFrequency: event.target.value as CheckFrequency })
              }
            >
              {CHECK_FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {FREQUENCY_LABEL[frequency]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-sm font-medium text-ink-700">Check that alerts reach you</p>
          <p className="text-xs text-ink-500">
            Sends one real alert email through whichever transport the server is configured to use.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={sendTestAlert.isPending}
              onClick={() => sendTestAlert.mutate(undefined)}
              leadingIcon={<Mail className="size-4" aria-hidden="true" />}
            >
              Send a test alert
            </Button>

            {sendTestAlert.data && (
              <span className="text-xs text-ink-500" role="status">
                {sendTestAlert.data.delivered ? 'Sent' : 'Failed'} via{' '}
                <Badge tone="muted">{sendTestAlert.data.transport}</Badge>{' '}
                {sendTestAlert.data.outputPath
                  ? `— written to ${sendTestAlert.data.outputPath}`
                  : `to ${sendTestAlert.data.recipient}`}
              </span>
            )}
            {sendTestAlert.isError && (
              <span className="text-xs text-rise-700" role="alert">
                {sendTestAlert.error instanceof Error
                  ? sendTestAlert.error.message
                  : 'Could not send the test alert.'}
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* ── Preferences ──────────────────────────────────────────────────── */}
      <Card className="flex flex-col gap-5">
        <SectionHeading
          title="Search preferences"
          description="Defaults used when you open the search page."
        />

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1 text-sm font-medium text-ink-700">Preferred stores</legend>
          {stores.map((store) => (
            <Checkbox
              key={store.slug}
              label={store.name}
              checked={form.preferredStores.includes(store.slug)}
              onChange={() => toggle('preferredStores', store.slug)}
            />
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1 text-sm font-medium text-ink-700">Preferred categories</legend>
          <div className="grid grid-cols-2 gap-2">
            {categories.map((category) => (
              <Checkbox
                key={category.id}
                label={category.label}
                checked={form.preferredCategories.includes(category.id)}
                onChange={() => toggle('preferredCategories', category.id)}
              />
            ))}
          </div>
        </fieldset>

      </Card>

      {/* ── Delivery and currency ────────────────────────────────────────── */}
      <Card className="flex flex-col gap-5">
        <SectionHeading
          title="Delivery and currency"
          description="Where you want things delivered, and how prices are quoted. These seed the destination controls in the header; they do not switch destination comparison on by themselves."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Default delivery country"
            description="Used to pre-fill the “Deliver to” control."
          >
            {(fieldProps) => (
              <Select
                {...fieldProps}
                name="defaultCountryCode"
                value={form.defaultCountryCode}
                onChange={(event) =>
                  setForm({ ...form, defaultCountryCode: event.target.value as CountryCode })
                }
              >
                {/* Country names, never a flag alone: several are
                    indistinguishable at this size and screen readers announce
                    them as unhelpful emoji names. */}
                {countryOptions
                  .filter((option) => option.isSupported)
                  .map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.name}
                    </option>
                  ))}
                {countryOptions.some((option) => !option.isSupported) && (
                  <optgroup label="Not available yet">
                    {countryOptions
                      .filter((option) => !option.isSupported)
                      .map((option) => (
                        <option key={option.code} value={option.code} disabled>
                          {option.name}
                        </option>
                      ))}
                  </optgroup>
                )}
              </Select>
            )}
          </Field>

          <Field
            label="Preferred currency"
            description="Prices from other currencies are converted and labelled as estimates."
          >
            {(fieldProps) => (
              <Select
                {...fieldProps}
                name="currency"
                value={form.currency}
                onChange={(event) =>
                  setForm({ ...form, currency: event.target.value as Currency })
                }
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <SegmentedControl
          legend="Default store region"
          name="defaultStoreRegion"
          value={form.defaultStoreRegion}
          options={STORE_REGIONS.map((region) => ({ value: region, label: REGION_LABEL[region] }))}
          onChange={(next) => setForm({ ...form, defaultStoreRegion: next })}
        />

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1 text-sm font-medium text-ink-700">
            Preferred store countries
          </legend>
          <p className="text-xs text-ink-500">
            Narrows results to stores based in these countries, within whatever the region above
            allows. Leave all unchecked to include every store the region admits.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {storeCountryOptions.length === 0 ? (
              <p className="text-xs text-ink-500">Store countries load with the store list.</p>
            ) : (
              storeCountryOptions.map((code) => (
                <Checkbox
                  key={code}
                  label={countryName(code)}
                  checked={form.preferredStoreCountries.includes(code)}
                  onChange={() =>
                    setForm((current) => ({
                      ...current,
                      preferredStoreCountries: current.preferredStoreCountries.includes(code)
                        ? current.preferredStoreCountries.filter((entry) => entry !== code)
                        : [...current.preferredStoreCountries, code],
                    }))
                  }
                />
              ))
            )}
          </div>
        </fieldset>

        <Field
          label="Delivery-time preference"
          description="Offers slower than this are filtered out when a destination is selected."
        >
          {(fieldProps) => (
            <Select
              {...fieldProps}
              name="deliveryTimePreference"
              value={form.deliveryTimePreference}
              onChange={(event) =>
                setForm({
                  ...form,
                  deliveryTimePreference: event.target.value as DeliveryTimePreference,
                })
              }
            >
              {DELIVERY_TIME_PREFERENCES.map((preference) => (
                <option key={preference} value={preference}>
                  {DELIVERY_TIME_LABEL[preference]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="flex flex-col gap-3">
          <Checkbox
            label="Include stores outside the EU"
            description="Import duty and customs handling may apply on these routes, and we never claim to have calculated them."
            checked={form.includeNonEuStores}
            onChange={(event) => setForm({ ...form, includeNonEuStores: event.target.checked })}
          />
          <Checkbox
            label="Show offers with unknown shipping cost"
            description="They are shown with no delivered total, never as free delivery, and they cannot win the cheapest-delivered comparison."
            checked={form.showUnknownShipping}
            onChange={(event) => setForm({ ...form, showUnknownShipping: event.target.checked })}
          />
          <Checkbox
            label="Warn me about possible import charges"
            description="Shown on any route that could attract duty. Turning this off hides the warning, not the risk."
            checked={form.warnAboutImportCharges}
            onChange={(event) =>
              setForm({ ...form, warnAboutImportCharges: event.target.checked })
            }
          />
        </div>
      </Card>

      {/* ── Save ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={save}
          loading={updateSettings.isPending}
          leadingIcon={<Save className="size-4" aria-hidden="true" />}
        >
          Save settings
        </Button>
        {saved && (
          <span className="text-sm text-drop-700" role="status">
            Settings saved.
          </span>
        )}
        {updateSettings.isError && (
          <span className="text-sm text-rise-700" role="alert">
            {updateSettings.error instanceof Error
              ? updateSettings.error.message
              : 'Could not save your settings.'}
          </span>
        )}
      </div>

      {/* ── Danger zone ──────────────────────────────────────────────────── */}
      <Card className="flex flex-col gap-4 border-rise-700/25">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rise-700" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <h2 className="text-base">Clear your data</h2>
            <p className="text-sm text-ink-500">
              Removes your watchlist, saved searches and alert history. Products and their price
              history are shared reference data and are not affected. This cannot be undone.
            </p>
          </div>
        </div>

        <Field
          label="Type DELETE to confirm"
          description="Required by the API as well, so a stray request cannot wipe your data."
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="confirm"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
          )}
        </Field>

        <div className="flex flex-wrap gap-2">
          {(['watchlist', 'saved-searches', 'notifications', 'all'] as const).map((scope) => (
            <Button
              key={scope}
              variant="danger"
              size="sm"
              disabled={confirmText !== 'DELETE'}
              loading={clearData.isPending && clearData.variables?.scope === scope}
              onClick={() => {
                clearData.mutate(
                  { scope, confirm: 'DELETE' },
                  { onSuccess: () => setConfirmText('') },
                );
              }}
            >
              Clear {scope === 'all' ? 'everything' : scope.replace('-', ' ')}
            </Button>
          ))}
        </div>

        {clearData.data && (
          <p className="text-xs text-ink-500" role="status">
            Removed {clearData.data.deleted.watchlistItems} watchlist items,{' '}
            {clearData.data.deleted.savedSearches} saved searches and{' '}
            {clearData.data.deleted.notifications} notifications.
          </p>
        )}
      </Card>
    </div>
  );
}
