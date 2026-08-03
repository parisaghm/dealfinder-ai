import { CHECK_FREQUENCIES, CURRENCIES, type CheckFrequency } from '@deal-finder/shared';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ErrorState,
  Field,
  Input,
  SectionHeading,
  Select,
  Skeleton,
} from '@deal-finder/ui';
import { AlertTriangle, Mail, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  useClearData,
  useMeta,
  useSendTestAlert,
  useSettings,
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

export function SettingsPage() {
  const settings = useSettings();
  const { data: meta } = useMeta();
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
    currency: 'EUR',
  });
  const [saved, setSaved] = useState(false);
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
    });
  }, [settings.data]);

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
        currency: form.currency as (typeof CURRENCIES)[number],
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

        <Field label="Email address" description="Price alerts are sent here.">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="email"
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
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

        <Field label="Currency" description="Only EUR is populated in this MVP.">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              name="currency"
              value={form.currency}
              onChange={(event) => setForm({ ...form, currency: event.target.value })}
            >
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
          )}
        </Field>
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
