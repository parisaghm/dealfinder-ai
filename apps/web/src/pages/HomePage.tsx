import { Card, ErrorState, ProductCardSkeleton, SectionHeading } from '@deal-finder/ui';
import { BellRing, LineChart, Search, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ProductCard } from '../components/deals/ProductCard';
import { SearchForm, type SearchFormValues } from '../components/deals/SearchForm';
import { useAddToWatchlist, useDeals, useMeta } from '../lib/queries';
import { buildSearchParams } from '../lib/search-params';

/**
 * Home page.
 *
 * The hero states the actual proposition — that a sale label is not evidence —
 * because that claim is the product. Featured deals below are real, scored
 * results rather than a static banner, so the promise is demonstrated
 * immediately rather than asserted.
 */
export function HomePage() {
  const navigate = useNavigate();
  const { data: meta } = useMeta();
  const addToWatchlist = useAddToWatchlist();

  // Genuinely good deals, ranked by discount, in stock.
  const featured = useDeals({ sort: 'best-discount', limit: 6 });

  const exampleSearches = meta?.verticals[0]?.exampleSearches ?? [];
  const categories = meta?.verticals[0]?.categories ?? [];

  const runSearch = (values: SearchFormValues) => {
    navigate(`/search?${buildSearchParams(values).toString()}`);
  };

  return (
    <div className="flex flex-col gap-14">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-7">
        <div className="flex max-w-2xl flex-col gap-3">
          <h1 className="text-3xl leading-[1.15] font-bold sm:text-4xl">
            Find real discounts, not just sale labels.
          </h1>
          <p className="text-base text-ink-500 sm:text-lg">
            Compare prices, track products, and get notified when the price is right.
          </p>
        </div>

        <Card className="p-5 sm:p-6">
          <SearchForm meta={meta} onSubmit={runSearch} />
        </Card>

        {exampleSearches.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-ink-500">Try:</span>
            {exampleSearches.map((example) => (
              <Link
                key={example}
                to={`/search?query=${encodeURIComponent(example)}`}
                className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:border-accent-500 hover:text-accent-700"
              >
                {example}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Categories ───────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Popular categories"
          description="Browse the electronics we currently track in Finland."
        />
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {categories.map((category) => (
            <li key={category.id}>
              <Link
                to={`/search?category=${encodeURIComponent(category.id)}`}
                className="flex h-full flex-col gap-1 rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-accent-500"
              >
                <span className="text-sm font-semibold">{category.label}</span>
                {category.description && (
                  <span className="text-xs leading-relaxed text-ink-500">
                    {category.description}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Featured deals ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Featured deals"
          description="The largest current reductions, each checked against its own price history."
          action={
            <Link
              to="/search?sort=best-discount"
              className="text-sm font-semibold text-accent-700 hover:text-accent-800"
            >
              See all deals →
            </Link>
          }
        />

        {featured.isPending && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <ProductCardSkeleton key={index} />
            ))}
          </div>
        )}

        {featured.isError && (
          <ErrorState
            message="We could not load featured deals. The API may not be running."
            onRetry={() => void featured.refetch()}
          />
        )}

        {featured.data && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.data.items.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                trackPending={
                  addToWatchlist.isPending && addToWatchlist.variables?.productId === product.id
                }
                onTrack={(target) => addToWatchlist.mutate({ productId: target.id, alertsEnabled: true })}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          title="How DealFinder works"
          description="Four steps, and none of them require trusting a crossed-out price."
        />
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <HowItWorksStep
            step={1}
            icon={<Search className="size-5" aria-hidden="true" />}
            title="Search across stores"
            description="One search covers every store we support, so you compare the same product side by side."
          />
          <HowItWorksStep
            step={2}
            icon={<LineChart className="size-5" aria-hidden="true" />}
            title="See the real price history"
            description="We record what a product has actually cost over time and chart it, rather than showing only today's number."
          />
          <HowItWorksStep
            step={3}
            icon={<ShieldCheck className="size-5" aria-hidden="true" />}
            title="Check whether it is really a deal"
            description="Each offer is scored against its own history. A permanent “sale” gets called out instead of celebrated."
          />
          <HowItWorksStep
            step={4}
            icon={<BellRing className="size-5" aria-hidden="true" />}
            title="Get told when to buy"
            description="Set a target price and we email you when the product reaches it. No need to keep checking."
          />
        </ol>
      </section>
    </div>
  );
}

function HowItWorksStep({
  step,
  icon,
  title,
  description,
}: {
  step: number;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
          {icon}
        </span>
        <span className="text-xs font-semibold tabular text-ink-400">Step {step}</span>
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs leading-relaxed text-ink-500">{description}</p>
    </li>
  );
}
