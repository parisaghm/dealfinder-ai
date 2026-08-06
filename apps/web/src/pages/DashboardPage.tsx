import { formatMoney, formatRelativeTime, type PriceChangeEntry } from '@deal-finder/shared';
import { Badge, Button, Card, EmptyState, ErrorState, SectionHeading, Skeleton } from '@deal-finder/ui';
import {
  ArrowDown,
  ArrowUp,
  BellRing,
  Bookmark,
  LineChart,
  PiggyBank,
  Search,
  Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { ProductCard } from '../components/deals/ProductCard';
import { useAddToWatchlist, useDashboard, useDeleteSavedSearch } from '../lib/queries';

/**
 * Dashboard.
 *
 * Four summary tiles, then the things a user can act on. "Estimated savings" is
 * labelled as an estimate everywhere it appears — it is the sum of how far
 * tracked products sit below their own recorded averages, which is a useful
 * signal but not money in anyone's pocket, and the copy says so.
 */
export function DashboardPage() {
  const dashboard = useDashboard();
  const deleteSavedSearch = useDeleteSavedSearch();
  const addToWatchlist = useAddToWatchlist();

  if (dashboard.isPending) return <DashboardSkeleton />;

  if (dashboard.isError || !dashboard.data) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <ErrorState
          message={
            dashboard.error instanceof Error
              ? dashboard.error.message
              : 'We could not load your dashboard.'
          }
          onRetry={() => void dashboard.refetch()}
        />
      </div>
    );
  }

  const { summary, recentPriceChanges, bestDeals, alertActivity, savedSearches } = dashboard.data;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-ink-500">
          An overview of what you are tracking and what has changed recently.
        </p>
      </div>

      {/* ── Summary tiles ────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile
          label="Tracked products"
          value={String(summary.trackedProducts)}
          icon={<Bookmark className="size-4" aria-hidden="true" />}
          href="/watchlist"
        />
        <SummaryTile
          label="Active price alerts"
          value={String(summary.activeAlerts)}
          icon={<BellRing className="size-4" aria-hidden="true" />}
          note="With a target price set"
          href="/watchlist"
        />
        <SummaryTile
          label="Deals found this week"
          value={String(summary.dealsFoundThisWeek)}
          icon={<LineChart className="size-4" aria-hidden="true" />}
          note="Discounted products that moved"
          href="/search"
        />
        <SummaryTile
          label="Estimated savings"
          value={formatMoney(summary.estimatedSavings, summary.currency)}
          icon={<PiggyBank className="size-4" aria-hidden="true" />}
          note="Estimate vs recorded averages"
        />
      </div>

      {/* ── Recent changes + alert activity ──────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/*
          `min-w-0` on the grid children, because a grid item's default
          `min-width: auto` lets its content widen the track. Without it the long
          product names in these rows push the column past the viewport and the
          whole page scrolls sideways at 320px — the `truncate` on the name cannot
          help, since the track has already grown to fit it.
        */}
        <section className="flex min-w-0 flex-col gap-4">
          <SectionHeading
            title="Recent price changes"
            description="Movements among the products you track."
          />
          {recentPriceChanges.length === 0 ? (
            <EmptyState
              title="No recent movement"
              description="Nothing you track has changed price since the last check."
              className="py-10"
            />
          ) : (
            <Card padded={false}>
              <ul className="divide-y divide-line">
                {recentPriceChanges.map((entry) => (
                  <li key={entry.product.id}>
                    <PriceChangeRow entry={entry} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-4">
          <SectionHeading
            title="Alert activity"
            description="Emails we have sent you about tracked products."
          />
          {alertActivity.length === 0 ? (
            <EmptyState
              title="No alerts yet"
              description="Once a tracked product reaches your target price, the email will be listed here."
              className="py-10"
            />
          ) : (
            <Card padded={false}>
              <ul className="divide-y divide-line">
                {alertActivity.map((notification) => (
                  <li key={notification.id} className="flex flex-col gap-1 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          notification.status === 'SENT'
                            ? 'drop'
                            : notification.status === 'FAILED'
                              ? 'rise'
                              : 'muted'
                        }
                      >
                        {notification.status.toLowerCase()}
                      </Badge>
                      <Badge tone="muted">{notification.type.replace(/_/g, ' ').toLowerCase()}</Badge>
                      <span className="text-xs text-ink-400">
                        {formatRelativeTime(notification.sentAt ?? notification.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm text-ink-700">{notification.message}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>

      {/* ── Saved searches ──────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Saved searches"
          description="Filter sets you can re-run with one click."
        />
        {savedSearches.length === 0 ? (
          <EmptyState
            icon={<Search className="size-8" aria-hidden="true" />}
            title="No saved searches"
            description="Run a search, then choose “Save this search” to keep it here."
            className="py-10"
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {savedSearches.map((search) => {
              const params = new URLSearchParams();
              if (search.query) params.set('query', search.query);
              if (search.category) params.set('category', search.category);
              if (search.maximumPrice != null) params.set('maximumPrice', String(search.maximumPrice));
              if (search.minimumDiscount != null)
                params.set('minimumDiscount', String(search.minimumDiscount));
              if (search.stores.length > 0) params.set('stores', search.stores.join(','));

              return (
                <li key={search.id}>
                  <Card className="flex h-full flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        {search.name ?? search.query ?? 'Saved search'}
                      </h3>
                      {search.alertsEnabled && <Badge tone="accent">Alerts on</Badge>}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {search.category && <Badge tone="muted">{search.category}</Badge>}
                      {search.maximumPrice != null && (
                        <Badge tone="muted">under {formatMoney(search.maximumPrice)}</Badge>
                      )}
                      {search.minimumDiscount != null && (
                        <Badge tone="muted">{search.minimumDiscount}%+ off</Badge>
                      )}
                      {search.stores.map((store) => (
                        <Badge key={store} tone="muted">
                          {store}
                        </Badge>
                      ))}
                    </div>

                    <div className="mt-auto flex gap-2">
                      <Link
                        to={`/search?${params.toString()}`}
                        className="inline-flex h-9 flex-1 items-center justify-center rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold hover:bg-surface-muted"
                      >
                        Run search
                      </Link>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={deleteSavedSearch.isPending}
                        onClick={() => deleteSavedSearch.mutate(search.id)}
                        aria-label={`Delete saved search ${search.name ?? ''}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Best deals ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Best current deals"
          description="The largest in-stock reductions we can see right now."
          action={
            <Link
              to="/search?sort=best-discount"
              className="text-sm font-semibold text-accent-700 hover:text-accent-800"
            >
              See all →
            </Link>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bestDeals.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onTrack={(target) =>
                addToWatchlist.mutate({ productId: target.id, alertsEnabled: true })
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  icon,
  note,
  href,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  note?: string;
  href?: string;
}) {
  const content = (
    <Card className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2 text-ink-500">
        <span className="flex size-7 items-center justify-center rounded-md bg-accent-50 text-accent-700">
          {icon}
        </span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      {/* Proportional figures, not tabular: a standalone display number looks
          loose when every digit is padded to the width of a zero. */}
      <span className="text-2xl font-semibold tracking-tight">{value}</span>
      {note && <span className="text-xs text-ink-400">{note}</span>}
    </Card>
  );

  return href ? (
    <Link to={href} className="block transition-shadow hover:shadow-raised">
      {content}
    </Link>
  ) : (
    content
  );
}

function PriceChangeRow({ entry }: { entry: PriceChangeEntry }) {
  const dropped = entry.changePercent < 0;

  return (
    <Link
      to={`/products/${entry.product.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted/60"
    >
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
          dropped ? 'bg-drop-50 text-drop-700' : 'bg-rise-50 text-rise-700'
        }`}
      >
        {dropped ? (
          <ArrowDown className="size-4" aria-hidden="true" />
        ) : (
          <ArrowUp className="size-4" aria-hidden="true" />
        )}
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{entry.product.name}</span>
        <span className="text-xs text-ink-500">
          {formatMoney(entry.previousPrice, entry.product.currency)} →{' '}
          {formatMoney(entry.currentPrice, entry.product.currency)} ·{' '}
          {formatRelativeTime(entry.changedAt)}
        </span>
      </div>

      <span
        className={`shrink-0 text-sm font-semibold tabular ${
          dropped ? 'text-drop-700' : 'text-rise-700'
        }`}
      >
        {dropped ? '' : '+'}
        {entry.changePercent}%
      </span>
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-7 w-40" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index}>
            <Skeleton className="mb-3 h-4 w-24" />
            <Skeleton className="h-7 w-16" />
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <Card key={index}>
            <Skeleton className="mb-4 h-4 w-32" />
            <Skeleton className="h-40 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}
