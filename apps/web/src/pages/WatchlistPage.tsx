import {
  formatMoney,
  formatRelativeTime,
  type AlertStatus,
  type WatchlistItem,
} from '@deal-finder/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Skeleton,
  type BadgeTone,
} from '@deal-finder/ui';
import {
  ArrowDown,
  ArrowUp,
  BellOff,
  BellRing,
  BookmarkX,
  Check,
  Minus,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useRemoveWatchlistItem, useUpdateWatchlistItem, useWatchlist } from '../lib/queries';

/**
 * Watchlist.
 *
 * A table-like list rather than a card grid: the user is comparing the same
 * three numbers (current, target, gap) across rows, and alignment is what makes
 * that scannable. Target editing is inline, because leaving the page to change
 * one number is friction for the single most common action here.
 */

const STATUS_LABEL: Record<AlertStatus, string> = {
  NO_TARGET: 'No target set',
  WAITING: 'Waiting for target',
  TARGET_REACHED: 'Target reached',
  PAUSED: 'Alerts paused',
};

const STATUS_TONE: Record<AlertStatus, BadgeTone> = {
  NO_TARGET: 'muted',
  WAITING: 'neutral',
  TARGET_REACHED: 'drop',
  PAUSED: 'warn',
};

export function WatchlistPage() {
  const watchlist = useWatchlist();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold">Watchlist</h1>
        <p className="text-sm text-ink-500">
          Products you are tracking. We check them on a schedule and email you when a target price
          is reached.
        </p>
      </div>

      {watchlist.isPending && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Card key={index}>
              <div className="flex gap-4">
                <Skeleton className="size-16 rounded-lg" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {watchlist.isError && (
        <ErrorState
          message={
            watchlist.error instanceof Error
              ? watchlist.error.message
              : 'We could not load your watchlist.'
          }
          onRetry={() => void watchlist.refetch()}
        />
      )}

      {watchlist.data && watchlist.data.items.length === 0 && (
        <EmptyState
          icon={<BookmarkX className="size-8" aria-hidden="true" />}
          title="You are not tracking anything yet"
          description="Find a product you want and choose “Track price”. Set a target and we will email you when it gets there."
          action={
            <Link
              to="/search"
              className="inline-flex h-9 items-center rounded-lg bg-accent-700 px-4 text-sm font-semibold text-white hover:bg-accent-800"
            >
              Browse deals
            </Link>
          }
        />
      )}

      {watchlist.data && watchlist.data.items.length > 0 && (
        <>
          <p className="text-sm text-ink-500" role="status">
            {watchlist.data.total} tracked {watchlist.data.total === 1 ? 'product' : 'products'}
          </p>
          <ul className="flex flex-col gap-3">
            {watchlist.data.items.map((item) => (
              <li key={item.id}>
                <WatchlistRow item={item} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function WatchlistRow({ item }: { item: WatchlistItem }) {
  const updateItem = useUpdateWatchlistItem();
  const removeItem = useRemoveWatchlistItem();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.targetPrice != null ? String(item.targetPrice) : '');
  const [error, setError] = useState<string | null>(null);

  const { product, targetComparison } = item;

  const saveTarget = () => {
    setError(null);
    const trimmed = draft.trim();

    if (trimmed === '') {
      updateItem.mutate(
        { id: item.id, input: { targetPrice: null } },
        { onSuccess: () => setEditing(false) },
      );
      return;
    }

    const parsed = Number(trimmed.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter a price above zero.');
      return;
    }

    updateItem.mutate(
      { id: item.id, input: { targetPrice: Math.round(parsed * 100) / 100 } },
      {
        onSuccess: () => setEditing(false),
        onError: (mutationError) =>
          setError(mutationError instanceof Error ? mutationError.message : 'Could not save.'),
      },
    );
  };

  return (
    <Card className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <Link
        to={`/products/${product.id}`}
        className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-surface-muted"
      >
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="max-h-14 object-contain p-1" />
        ) : null}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[item.alertStatus]}>{STATUS_LABEL[item.alertStatus]}</Badge>
          <span className="text-xs text-ink-500">{product.store.name}</span>
          <PriceChangeIndicator change={item.priceChangeSincePrevious} currency={product.currency} />
        </div>

        <h2 className="text-sm leading-snug font-semibold">
          <Link to={`/products/${product.id}`} className="hover:text-accent-700">
            {product.name}
          </Link>
        </h2>

        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <div className="flex gap-1.5">
            <dt className="text-ink-400">Current</dt>
            <dd className="font-semibold tabular text-ink-900">
              {formatMoney(product.currentPrice, product.currency)}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-ink-400">Target</dt>
            <dd className="font-semibold tabular text-ink-900">
              {item.targetPrice != null ? formatMoney(item.targetPrice, product.currency) : '—'}
            </dd>
          </div>
          {targetComparison && (
            <div className="flex gap-1.5">
              <dt className="text-ink-400">Difference</dt>
              <dd
                className={
                  targetComparison.reached
                    ? 'font-semibold tabular text-drop-700'
                    : 'font-semibold tabular text-ink-700'
                }
              >
                {targetComparison.reached ? '' : '+'}
                {formatMoney(Math.abs(targetComparison.difference), product.currency)}
                {!targetComparison.reached && ` to go`}
              </dd>
            </div>
          )}
          <div className="flex gap-1.5">
            <dt className="text-ink-400">Checked</dt>
            <dd className="text-ink-700">{formatRelativeTime(product.lastCheckedAt)}</dd>
          </div>
          {item.lastAlertedAt && (
            <div className="flex gap-1.5">
              <dt className="text-ink-400">Last alert</dt>
              <dd className="text-ink-700">{formatRelativeTime(item.lastAlertedAt)}</dd>
            </div>
          )}
        </dl>

        {editing && (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <div className="flex items-end gap-2">
              <Field label="Target price" error={error} className="w-40">
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    name="targetPrice"
                    type="text"
                    inputMode="decimal"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    leadingAddon={<span className="text-sm">€</span>}
                    autoFocus
                  />
                )}
              </Field>
              <Button
                size="sm"
                onClick={saveTarget}
                loading={updateItem.isPending}
                leadingIcon={<Check className="size-3.5" aria-hidden="true" />}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                  setDraft(item.targetPrice != null ? String(item.targetPrice) : '');
                }}
                leadingIcon={<X className="size-3.5" aria-hidden="true" />}
              >
                Cancel
              </Button>
            </div>
            <p className="text-xs text-ink-500">Leave empty to track without a target price.</p>
          </div>
        )}
      </div>

      {!editing && (
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setEditing(true)}
            leadingIcon={<Pencil className="size-3.5" aria-hidden="true" />}
          >
            Edit target
          </Button>

          <Button
            size="sm"
            variant="secondary"
            loading={updateItem.isPending}
            onClick={() =>
              updateItem.mutate({ id: item.id, input: { alertsEnabled: !item.alertsEnabled } })
            }
            leadingIcon={
              item.alertsEnabled ? (
                <BellOff className="size-3.5" aria-hidden="true" />
              ) : (
                <BellRing className="size-3.5" aria-hidden="true" />
              )
            }
          >
            {item.alertsEnabled ? 'Pause' : 'Resume'}
          </Button>

          {/*
            The accessible name must *start with* the visible text ("Remove"),
            per WCAG 2.5.3 Label in Name — otherwise a voice-control user saying
            "click Remove" gets nothing, and the button's spoken name disagrees
            with what is written on it. The product name is appended for context,
            since a watchlist has many identical-looking Remove buttons.
          */}
          <Button
            size="sm"
            variant="danger"
            loading={removeItem.isPending}
            onClick={() => removeItem.mutate(item.id)}
            leadingIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
            aria-label={`Remove ${product.name} from your watchlist`}
          >
            Remove
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Direction of the last recorded move. Never colour alone — an arrow too. */
function PriceChangeIndicator({
  change,
  currency,
}: {
  change: number | null;
  currency: WatchlistItem['product']['currency'];
}) {
  if (change == null || change === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ink-400">
        <Minus className="size-3" aria-hidden="true" />
        Unchanged
      </span>
    );
  }

  const dropped = change < 0;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold ${
        dropped ? 'text-drop-700' : 'text-rise-700'
      }`}
    >
      {dropped ? (
        <ArrowDown className="size-3" aria-hidden="true" />
      ) : (
        <ArrowUp className="size-3" aria-hidden="true" />
      )}
      {dropped ? 'Down' : 'Up'} {formatMoney(Math.abs(change), currency)}
    </span>
  );
}
