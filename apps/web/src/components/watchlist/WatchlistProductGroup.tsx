import {
  COUNTRIES,
  CURRENCIES,
  countryName,
  formatMoney,
  formatRelativeTime,
  type AlertStatus,
  type CountryCode,
  type CreateWatchlistItemPayload,
  type Currency,
  type UpdateWatchlistItemInput,
  type WatchlistItem,
} from '@deal-finder/shared';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  type BadgeTone,
} from '@deal-finder/ui';
import {
  AlertTriangle,
  BellOff,
  BellRing,
  Check,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DemoStoreNotice } from '../deals/DeliveryDetails';

/**
 * One tracked product, and every destination it is tracked for.
 *
 * Grouping is the whole point of this component. Tracking identity is
 * `(user, product, destination, currency)`, so one product legitimately produces
 * several rows — and a flat list of four visually identical entries for the same
 * headphones reads as a duplicate bug rather than as four deliberate targets.
 * Grouped under one product heading, with every row naming its destination *and*
 * its currency, the same data reads as what it is.
 *
 * Two rules here are safety rules rather than presentation:
 *
 *  1. **An unknown delivered total is never "target reached."** Unpublished
 *     shipping, a missing exchange rate or a stale one all leave the delivered
 *     total unknown, and an unknown number has not been shown to beat anything.
 *  2. **Changing a currency updates the row it is on.** A second target for the
 *     same destination is a separate, separately-labelled action. The cost of
 *     getting this wrong is duplicate alert emails the user never asked for, and
 *     a dropdown is not a request.
 *
 * Presentational on purpose: every mutation arrives as a callback, so the page
 * owns the query client and this file can be tested by rendering it.
 */

export const STATUS_LABEL: Record<AlertStatus, string> = {
  NO_TARGET: 'No target set',
  WAITING: 'Waiting for target',
  TARGET_REACHED: 'Target reached',
  PAUSED: 'Alerts paused',
};

export const STATUS_TONE: Record<AlertStatus, BadgeTone> = {
  NO_TARGET: 'muted',
  WAITING: 'neutral',
  TARGET_REACHED: 'drop',
  PAUSED: 'warn',
};

/** Copy that must not drift between the row, the form and the confirmations. */
export const WATCHLIST_COPY = {
  scope: (country: string, currency: string) => `Delivered to ${country} · ${currency}`,
  deliveredTargetLabel: (country: string, currency: string) =>
    `Notify me when the delivered price to ${country} is below this ${currency} amount`,
  listTargetLabel: 'Notify me when the list price is below',
  listTargetNote: 'Compares the shelf price only — delivery is not counted.',
  unknownDelivered: (country: string) =>
    'No delivered total can be calculated yet, so this target cannot be evaluated. Most often the store has not published its delivery cost to ' +
    country +
    '.',
  currencyUpdatesInPlace:
    'Changing the currency updates this target. To watch a second currency as well, use “Add another target”.',
  added: (country: string, currency: string) =>
    `Now watching the delivered price to ${country}, in ${currency}.`,
  updated: (country: string, currency: string) =>
    `Target updated. Now watching the delivered price to ${country}, in ${currency}.`,
} as const;

// ── 409 conflicts ───────────────────────────────────────────────────────────

export interface WatchlistTargetConflict {
  /** The server's own wording, which already names destination and currency. */
  message: string;
  reason: 'DUPLICATE_TRACKING_TARGET' | 'CURRENCY_ONLY_CONFLICT' | null;
  existingItemId: string | null;
  existingCurrency: string | null;
  requestedCurrency: string | null;
}

/**
 * Read a duplicate-target conflict out of a failed create.
 *
 * The API answers a currency-only collision with `409` *and the existing item's
 * id*, precisely so the client can offer "update that one instead" rather than
 * making the user work out which of their rows is in the way. Throwing that
 * detail away and showing a bare error would waste the most useful part of the
 * response.
 *
 * Structural rather than `instanceof ApiRequestError`, so the helper stays
 * testable with a plain object and does not couple this component to the
 * transport.
 */
export function readTargetConflict(error: unknown): WatchlistTargetConflict | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { status?: unknown; message?: unknown; details?: unknown };
  if (candidate.status !== 409) return null;

  const details =
    typeof candidate.details === 'object' && candidate.details !== null
      ? (candidate.details as Record<string, unknown>)
      : {};

  const reason = details['reason'];

  return {
    message:
      typeof candidate.message === 'string' && candidate.message.length > 0
        ? candidate.message
        : 'You are already tracking this product for that destination and currency.',
    reason:
      reason === 'DUPLICATE_TRACKING_TARGET' || reason === 'CURRENCY_ONLY_CONFLICT' ? reason : null,
    existingItemId: typeof details['watchlistItemId'] === 'string' ? details['watchlistItemId'] : null,
    existingCurrency:
      typeof details['existingCurrency'] === 'string' ? details['existingCurrency'] : null,
    requestedCurrency:
      typeof details['requestedCurrency'] === 'string' ? details['requestedCurrency'] : null,
  };
}

// ── Grouping ────────────────────────────────────────────────────────────────

export interface WatchlistProductGroupData {
  productId: string;
  product: WatchlistItem['product'];
  items: WatchlistItem[];
}

/**
 * Collapse a flat watchlist into one entry per product.
 *
 * Insertion-ordered so the API's `createdAt desc` ordering still decides which
 * product appears first; within a group, rows are sorted by destination then
 * currency so the same product always lists its targets the same way rather than
 * reshuffling whenever one of them is edited.
 */
export function groupWatchlistByProduct(
  items: readonly WatchlistItem[],
): WatchlistProductGroupData[] {
  const groups = new Map<string, WatchlistProductGroupData>();

  for (const item of items) {
    const existing = groups.get(item.productId);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(item.productId, {
      productId: item.productId,
      product: item.product,
      items: [item],
    });
  }

  for (const group of groups.values()) {
    group.items.sort(
      (a, b) =>
        a.destinationCountryName.localeCompare(b.destinationCountryName) ||
        a.preferredCurrency.localeCompare(b.preferredCurrency),
    );
  }

  return [...groups.values()];
}

// ── Status ──────────────────────────────────────────────────────────────────

/**
 * The status this row is allowed to display.
 *
 * The server derives the same thing; it is re-asserted here because "target
 * reached" is the one label that makes somebody go and spend money. It must not
 * be possible for a single wrong or stale field to produce it while the delivered
 * total is unknown.
 */
export function displayAlertStatus(item: WatchlistItem): AlertStatus {
  if (
    item.targetDeliveredPrice != null &&
    item.currentDeliveredPrice == null &&
    item.alertStatus === 'TARGET_REACHED'
  ) {
    return 'WAITING';
  }
  return item.alertStatus;
}

// ── Group ───────────────────────────────────────────────────────────────────

export interface WatchlistProductGroupProps {
  group: WatchlistProductGroupData;
  onUpdate: (id: string, input: UpdateWatchlistItemInput) => void;
  onRemove: (id: string) => void;
  onAddTarget: (input: CreateWatchlistItemPayload) => void;
  /** Selectable destinations. Defaults to the supported set from `COUNTRIES`. */
  countryOptions?: readonly { code: CountryCode; name: string; isSupported: boolean }[];
  /** True for synthetic demo retailers, so the disclosure stays visible here too. */
  isDemoStore?: boolean;
  pending?: boolean;
  /** A failed create for *this* product, surfaced verbatim from the API. */
  conflict?: WatchlistTargetConflict | null;
  /** Set after a successful create or update, so the user is told what happened. */
  confirmation?: string | null;
  onDismissConflict?: () => void;
}

export function WatchlistProductGroup({
  group,
  onUpdate,
  onRemove,
  onAddTarget,
  countryOptions,
  isDemoStore = false,
  pending = false,
  conflict = null,
  confirmation = null,
  onDismissConflict,
}: WatchlistProductGroupProps) {
  const [adding, setAdding] = useState(false);
  const { product, items } = group;

  const countries =
    countryOptions ??
    COUNTRIES.map((country) => ({
      code: country.code,
      name: country.name,
      isSupported: country.isSupported,
    }));

  return (
    <Card className="flex flex-col gap-4" data-testid="watchlist-product-group">
      {/* ── The product, once ───────────────────────────────────────────── */}
      <div className="flex gap-4">
        <Link
          to={`/products/${product.id}`}
          className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-surface-muted"
        >
          {product.imageUrl ? (
            <img src={product.imageUrl} alt="" className="max-h-14 object-contain p-1" />
          ) : null}
        </Link>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-sm leading-snug font-semibold">
            <Link to={`/products/${product.id}`} className="hover:text-accent-700">
              {product.name}
            </Link>
          </h2>
          <p className="text-xs text-ink-500">
            {product.store.name} · listed at {formatMoney(product.currentPrice, product.currency)}
          </p>
          {/*
            Stated on the group rather than per row: it is a fact about the
            retailer, and repeating it on four targets for the same shop would be
            noise. Text, not a tooltip — a disclosure nobody can reach by touch
            is not a disclosure.
          */}
          {isDemoStore && <DemoStoreNotice compact />}
          {items.length > 1 && (
            <p className="text-xs text-ink-500">
              {items.length} targets for this product, one per destination and currency.
            </p>
          )}
        </div>
      </div>

      {/* ── One row per destination and currency ────────────────────────── */}
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id}>
            <WatchlistTargetRow
              item={item}
              countryOptions={countries}
              onUpdate={onUpdate}
              onRemove={onRemove}
              pending={pending}
            />
          </li>
        ))}
      </ul>

      {/* ── Adding a second target, explicitly ──────────────────────────── */}
      <div className="flex flex-col gap-3 border-t border-line pt-3">
        {confirmation && (
          <p className="text-xs font-medium text-drop-700" role="status">
            {confirmation}
          </p>
        )}

        {conflict && (
          <div
            className="flex flex-col gap-2 rounded-lg border border-warn-800/30 bg-warn-50 p-3"
            data-testid="watchlist-conflict"
          >
            <p className="flex items-start gap-1.5 text-xs font-medium text-warn-800" role="alert">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {/* The server's wording, unaltered: it already names the destination
                  and the currency, which is exactly what the user needs to know. */}
              <span>{conflict.message}</span>
            </p>
            {conflict.reason === 'CURRENCY_ONLY_CONFLICT' && conflict.existingItemId && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (!conflict.requestedCurrency) return;
                    onUpdate(conflict.existingItemId!, {
                      preferredCurrency: conflict.requestedCurrency as Currency,
                    });
                    onDismissConflict?.();
                  }}
                >
                  Update the existing target to {conflict.requestedCurrency}
                </Button>
              </div>
            )}
          </div>
        )}

        {adding ? (
          <AddTargetForm
            productId={group.productId}
            existingTargets={items}
            countryOptions={countries}
            pending={pending}
            onCancel={() => setAdding(false)}
            onSubmit={(input) => {
              onAddTarget(input);
              /*
                Closed on submit, not left open with the same values in it. A
                filled form still sitting there after a target was added is a
                second click away from a duplicate — the exact outcome the
                separate-action design exists to prevent. If the server refuses
                the target, the conflict box appears in its place and the button
                is back.
              */
              setAdding(false);
            }}
          />
        ) : (
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() => {
              onDismissConflict?.();
              setAdding(true);
            }}
            leadingIcon={<Plus className="size-3.5" aria-hidden="true" />}
          >
            Add another target
          </Button>
        )}
      </div>
    </Card>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────

interface WatchlistTargetRowProps {
  item: WatchlistItem;
  countryOptions: readonly { code: CountryCode; name: string; isSupported: boolean }[];
  onUpdate: (id: string, input: UpdateWatchlistItemInput) => void;
  onRemove: (id: string) => void;
  pending?: boolean;
}

function WatchlistTargetRow({
  item,
  countryOptions,
  onUpdate,
  onRemove,
  pending = false,
}: WatchlistTargetRowProps) {
  const [editing, setEditing] = useState(false);

  const status = displayAlertStatus(item);
  const country = item.destinationCountryName;
  const currency = item.preferredCurrency;
  const deliveredUnknown = item.targetDeliveredPrice != null && item.currentDeliveredPrice == null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3" data-testid="watchlist-target-row">
      <div className="flex flex-wrap items-center gap-2">
        {/*
          The row's identity, always both parts. Two EUR/SEK rows for one country
          are only legible if the currency is on the row rather than implied.
        */}
        <Badge tone="neutral" data-testid="target-scope">
          {WATCHLIST_COPY.scope(country, currency)}
        </Badge>
        <Badge tone={STATUS_TONE[status]} data-testid="target-status">
          {STATUS_LABEL[status]}
        </Badge>
        {!item.alertsEnabled && <span className="text-xs text-ink-500">No emails will be sent</span>}
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <Pair
          term={`Target delivered price`}
          value={
            item.targetDeliveredPrice != null
              ? formatMoney(item.targetDeliveredPrice, currency)
              : '—'
          }
        />
        <Pair
          term="Current delivered price"
          value={
            item.currentDeliveredPrice != null
              ? formatMoney(item.currentDeliveredPrice, currency)
              : 'Unknown'
          }
          tone={item.currentDeliveredPrice == null ? 'warn' : 'default'}
          testId="current-delivered"
        />
        {item.deliveredComparison && (
          <Pair
            term="Difference"
            value={`${item.deliveredComparison.reached ? '' : '+'}${formatMoney(
              Math.abs(item.deliveredComparison.difference),
              currency,
            )}${item.deliveredComparison.reached ? '' : ' to go'}`}
            tone={item.deliveredComparison.reached ? 'drop' : 'default'}
          />
        )}
        {/*
          Legacy list-price targets predate destinations and stay exactly as they
          were. Shown alongside rather than converted into a delivered target,
          because "the sticker says €249" and "it costs €249 to my door" are
          different promises and we were only ever asked for the first one.
        */}
        {item.targetPrice != null && (
          <Pair
            term="List-price target"
            value={formatMoney(item.targetPrice, item.product.currency)}
            testId="list-price-target"
          />
        )}
        <Pair term="Checked" value={formatRelativeTime(item.product.lastCheckedAt)} />
        {item.lastAlertedAt && (
          <Pair term="Last alert" value={formatRelativeTime(item.lastAlertedAt)} />
        )}
      </dl>

      {item.targetPrice != null && item.targetDeliveredPrice == null && (
        <p className="text-xs text-ink-500">{WATCHLIST_COPY.listTargetNote}</p>
      )}

      {deliveredUnknown && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-warn-800">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{WATCHLIST_COPY.unknownDelivered(country)}</span>
        </p>
      )}

      {editing ? (
        <EditTargetRowForm
          item={item}
          countryOptions={countryOptions}
          pending={pending}
          onCancel={() => setEditing(false)}
          onSubmit={(input) => {
            onUpdate(item.id, input);
            setEditing(false);
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setEditing(true)}
            leadingIcon={<Pencil className="size-3.5" aria-hidden="true" />}
            aria-label={`Edit target for delivery to ${country} in ${currency}`}
          >
            Edit target
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onUpdate(item.id, { alertsEnabled: !item.alertsEnabled })}
            leadingIcon={
              item.alertsEnabled ? (
                <BellOff className="size-3.5" aria-hidden="true" />
              ) : (
                <BellRing className="size-3.5" aria-hidden="true" />
              )
            }
            aria-label={`${item.alertsEnabled ? 'Pause' : 'Resume'} alerts for delivery to ${country} in ${currency}`}
          >
            {item.alertsEnabled ? 'Pause' : 'Resume'}
          </Button>
          {/*
            The accessible name starts with the visible text, per WCAG 2.5.3 —
            a voice-control user saying "click Remove" must reach this button. The
            destination follows, because a grouped product has several of these
            and they are otherwise indistinguishable.
          */}
          <Button
            size="sm"
            variant="danger"
            onClick={() => onRemove(item.id)}
            leadingIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
            aria-label={`Remove the ${currency} target for delivery to ${country}`}
          >
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

function Pair({
  term,
  value,
  tone = 'default',
  testId,
}: {
  term: string;
  value: string;
  tone?: 'default' | 'warn' | 'drop';
  testId?: string;
}) {
  const toneClass =
    tone === 'warn' ? 'text-warn-800' : tone === 'drop' ? 'text-drop-700' : 'text-ink-900';
  return (
    <div className="flex gap-1.5">
      <dt className="text-ink-400">{term}</dt>
      <dd className={`font-semibold tabular ${toneClass}`} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

// ── Edit ────────────────────────────────────────────────────────────────────

/**
 * Editing one existing target.
 *
 * The destination and currency selects submit through `PATCH`, which updates this
 * row rather than creating another — the difference between a user changing their
 * mind and a user suddenly receiving two alert emails.
 */
function EditTargetRowForm({
  item,
  countryOptions,
  pending,
  onCancel,
  onSubmit,
}: {
  item: WatchlistItem;
  countryOptions: readonly { code: CountryCode; name: string; isSupported: boolean }[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: UpdateWatchlistItemInput) => void;
}) {
  const [country, setCountry] = useState<CountryCode>(item.destinationCountry);
  const [currency, setCurrency] = useState<Currency>(item.preferredCurrency);
  const [delivered, setDelivered] = useState(
    item.targetDeliveredPrice != null ? String(item.targetDeliveredPrice) : '',
  );
  const [listPrice, setListPrice] = useState(
    item.targetPrice != null ? String(item.targetPrice) : '',
  );
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const deliveredValue = parsePrice(delivered);
    const listValue = parsePrice(listPrice);

    if (deliveredValue === 'invalid' || listValue === 'invalid') {
      setError('Enter a price above zero, for example 300 or 299,90.');
      return;
    }

    onSubmit({
      destinationCountry: country,
      preferredCurrency: currency,
      targetDeliveredPrice: deliveredValue,
      targetPrice: listValue,
    });
  };

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Deliver to">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              name={`destination-${item.id}`}
              value={country}
              onChange={(event) => setCountry(event.target.value as CountryCode)}
            >
              {countryOptions.map((option) => (
                <option key={option.code} value={option.code} disabled={!option.isSupported}>
                  {option.name}
                  {option.isSupported ? '' : ' (not available yet)'}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Currency" description={WATCHLIST_COPY.currencyUpdatesInPlace}>
          {(fieldProps) => (
            <Select
              {...fieldProps}
              name={`currency-${item.id}`}
              value={currency}
              onChange={(event) => setCurrency(event.target.value as Currency)}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field
        label={WATCHLIST_COPY.deliveredTargetLabel(countryName(country), currency)}
        description="Leave empty to track this destination without a delivered-price target."
        error={error}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            name={`targetDeliveredPrice-${item.id}`}
            type="text"
            inputMode="decimal"
            value={delivered}
            onChange={(event) => setDelivered(event.target.value)}
          />
        )}
      </Field>

      <Field label={WATCHLIST_COPY.listTargetLabel} description={WATCHLIST_COPY.listTargetNote}>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            name={`targetPrice-${item.id}`}
            type="text"
            inputMode="decimal"
            value={listPrice}
            onChange={(event) => setListPrice(event.target.value)}
          />
        )}
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={pending}
          onClick={submit}
          leadingIcon={<Check className="size-3.5" aria-hidden="true" />}
        >
          Save target
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          leadingIcon={<X className="size-3.5" aria-hidden="true" />}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Add ─────────────────────────────────────────────────────────────────────

/**
 * Adding a *second* target for a product already tracked.
 *
 * Deliberately a separate form behind a separate button. `allowAdditionalCurrency`
 * is sent only when the chosen destination is already tracked in another
 * currency, so the API's currency-only `409` still protects the accidental case
 * while this explicit one goes through.
 */
function AddTargetForm({
  productId,
  existingTargets,
  countryOptions,
  pending,
  onCancel,
  onSubmit,
}: {
  productId: string;
  existingTargets: readonly WatchlistItem[];
  countryOptions: readonly { code: CountryCode; name: string; isSupported: boolean }[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateWatchlistItemPayload) => void;
}) {
  const taken = new Set(existingTargets.map((item) => item.destinationCountry));
  const firstFree =
    countryOptions.find((option) => option.isSupported && !taken.has(option.code))?.code ??
    countryOptions.find((option) => option.isSupported)?.code ??
    'FI';

  const [country, setCountry] = useState<CountryCode>(firstFree);
  const [currency, setCurrency] = useState<Currency>('EUR');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sameDestination = existingTargets.some((item) => item.destinationCountry === country);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line-strong p-3">
      <p className="text-sm font-medium text-ink-700">Add another delivery target</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Deliver to">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              name={`add-destination-${productId}`}
              value={country}
              onChange={(event) => setCountry(event.target.value as CountryCode)}
            >
              {countryOptions.map((option) => (
                <option key={option.code} value={option.code} disabled={!option.isSupported}>
                  {option.name}
                  {option.isSupported ? '' : ' (not available yet)'}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Currency">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              name={`add-currency-${productId}`}
              value={currency}
              onChange={(event) => setCurrency(event.target.value as Currency)}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field
        label={WATCHLIST_COPY.deliveredTargetLabel(countryName(country), currency)}
        description="Leave empty to watch this destination without a target."
        error={error}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            name={`add-targetDeliveredPrice-${productId}`}
            type="text"
            inputMode="decimal"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
        )}
      </Field>

      {sameDestination && (
        <p className="text-xs text-warn-800">
          You already track {countryName(country)} for this product. Adding this creates a second,
          independent {currency} target for the same destination.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={pending}
          onClick={() => {
            setError(null);
            const parsed = parsePrice(target);
            if (parsed === 'invalid') {
              setError('Enter a price above zero, for example 300 or 299,90.');
              return;
            }
            onSubmit({
              productId,
              destinationCountry: country,
              preferredCurrency: currency,
              targetDeliveredPrice: parsed,
              alertsEnabled: true,
              // Only for the deliberate case. Leaving it false elsewhere keeps the
              // server's guard against a changed dropdown creating a second row.
              allowAdditionalCurrency: sameDestination,
            });
          }}
          leadingIcon={<Plus className="size-3.5" aria-hidden="true" />}
        >
          {sameDestination ? `Add a separate ${currency} target` : 'Add target'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          leadingIcon={<X className="size-3.5" aria-hidden="true" />}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Empty means "no target", which is valid. Anything unparseable is rejected. */
function parsePrice(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) return 'invalid';
  return Math.round(parsed * 100) / 100;
}
