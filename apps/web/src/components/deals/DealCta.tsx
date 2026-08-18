import { canOpenExternalDeal, isDemoDataSource } from '@deal-finder/shared';
import { Badge, cn } from '@deal-finder/ui';
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * The one place a "View deal" affordance is built.
 *
 * Five surfaces used to render their own external anchor straight from
 * `productUrl`, which meant five independent decisions about whether that URL was
 * safe to open — and in the default mock mode none of them were. The sample
 * catalogues interpolate synthetic ids into the retailers' genuine URL shapes, so
 * `https://www.gigantti.fi/product/gig-sony-wh1000xm5` is well-formed, on a real
 * domain, and a 404. A shopper clicking it was shown an invented price attributed
 * to a real shop and then sent nowhere.
 *
 * So the decision moved into `canOpenExternalDeal` in `@deal-finder/shared`, and
 * the rendering moved here. A component that needs a deal CTA asks for one; it
 * does not get to inspect the source itself.
 *
 * Note that this is *not* the same question as `isDemoStore`. That says the
 * retailer is invented — true for the seven European stores, false for Gigantti.
 * `dataSourceType` says the numbers and the URL are invented, which is true for
 * all ten today. Both are disclosed, and they are disclosed differently, because
 * "a fictional shop" and "a real shop with a sample price" are different claims.
 */

export const DEAL_CTA_COPY = {
  /** The verified case. Unchanged from what every surface said before. */
  external: 'View deal',
  /** A demo offer with somewhere internal to go. */
  internal: 'View demo details',
  /** A demo offer with nowhere to go — we are already on the detail page. */
  disabled: 'Demo offer',

  /** Said of a real retailer carrying sample data. */
  demoOfferFrom: (storeName: string) => `Demo offer from ${storeName}`,
  demoOfferDisclosure:
    "Demo data — this offer is illustrative and may not exist on the retailer's website.",
  illustrativePrice: 'Price and availability are illustrative.',

  /**
   * Said when the source is not one we recognise at all.
   *
   * Distinct from demo data: we are not claiming this is a sample, only that we
   * cannot vouch for where it came from, so we will not link to it.
   */
  unverifiedBadge: 'Unverified source',
  unverified: 'Source not verified — no retailer link is shown for this offer.',
} as const;

/**
 * The shapes the CTA takes across the app.
 *
 * Explicit variants rather than letting callers pass conflicting utility classes:
 * `cn` concatenates without resolving Tailwind conflicts, so an overriding height
 * would win or lose depending on stylesheet order. Naming the shapes keeps every
 * surface looking exactly as it did.
 */
export type DealCtaAppearance = 'secondary' | 'primary' | 'compact' | 'link';

const APPEARANCE_CLASS: Record<DealCtaAppearance, string> = {
  secondary:
    'inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-ink-900 transition-colors hover:bg-surface-muted',
  primary:
    'inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent-700 px-4 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-800',
  compact:
    'inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 text-xs font-semibold text-ink-900 transition-colors hover:bg-surface-muted',
  link: 'inline-flex items-center gap-1 text-xs font-semibold text-accent-700 hover:text-accent-800',
};

/** The muted, non-navigating counterpart of each appearance. */
const DISABLED_CLASS: Record<DealCtaAppearance, string> = {
  secondary:
    'inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line bg-surface-muted px-3 text-sm font-semibold text-ink-500',
  primary:
    'inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line bg-surface-muted px-4 text-[0.9375rem] font-semibold text-ink-500',
  compact:
    'inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-muted px-2.5 text-xs font-semibold text-ink-500',
  link: 'inline-flex items-center gap-1 text-xs font-semibold text-ink-500',
};

/** The icon size that matches each appearance's type scale. */
const ICON_CLASS: Record<DealCtaAppearance, string> = {
  secondary: 'size-3.5',
  primary: 'size-4',
  compact: 'size-3',
  link: 'size-3',
};

export interface DealCtaProps {
  /**
   * The offer, structurally. Any payload carrying these two fields works, which is
   * what lets one component serve product cards, the canonical comparison and the
   * delivered comparison without a union of DTO types.
   */
  offer: { dataSourceType?: string | null; productUrl?: string | null };
  /** Named in the accessible label, so the destination is announced. */
  storeName: string;
  /**
   * Where to go instead, for a non-linkable offer. Omit when there is nowhere —
   * on the product detail page itself — and a disabled control is rendered.
   */
  internalTo?: string;
  appearance?: DealCtaAppearance;
  /**
   * Overrides the external label only.
   *
   * The product detail page says "View at Gigantti" rather than "View deal", and
   * that wording predates this change; there is no reason for a trust fix to
   * rewrite it. The demo and disabled labels are deliberately *not* overridable,
   * because those are the disclosure.
   */
  externalLabel?: ReactNode;
  className?: string;
}

/**
 * Exactly one of: an external anchor, an internal link, or a disabled control.
 *
 * Never an external anchor for demo or unverified data — that is the whole point,
 * and it is decided by `canOpenExternalDeal` rather than here.
 */
export function DealCta({
  offer,
  storeName,
  internalTo,
  appearance = 'secondary',
  externalLabel,
  className,
}: DealCtaProps) {
  if (canOpenExternalDeal(offer)) {
    return (
      <a
        href={offer.productUrl ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(APPEARANCE_CLASS[appearance], className)}
      >
        {externalLabel ?? DEAL_CTA_COPY.external}
        <ExternalLink className={ICON_CLASS[appearance]} aria-hidden="true" />
        <span className="sr-only">(opens {storeName} in a new tab)</span>
      </a>
    );
  }

  // No external-link icon on either branch below. The icon is the promise that a
  // click leaves for the retailer, and neither of these does.
  if (internalTo != null) {
    return (
      <Link
        to={internalTo}
        className={cn(APPEARANCE_CLASS[appearance], className)}
        data-testid="demo-deal-cta"
      >
        {DEAL_CTA_COPY.internal}
        <span className="sr-only"> for this {storeName} offer</span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      className={cn(DISABLED_CLASS[appearance], 'cursor-not-allowed', className)}
      data-testid="demo-deal-cta"
    >
      {DEAL_CTA_COPY.disabled}
      <span className="sr-only"> from {storeName}, not available to open</span>
    </button>
  );
}

export interface DemoOfferNoticeProps {
  offer: { dataSourceType?: string | null; productUrl?: string | null };
  storeName: string;
  /**
   * Whether the *retailer* is fictional.
   *
   * When it is, `DemoStoreNotice` already says so and this component defers to it
   * rather than stacking two overlapping disclosures on one card. When it is
   * false but the data is still sample data — the Gigantti case — this is the only
   * thing that discloses it, which is exactly why it cannot be left to
   * `isDemoStore`.
   */
  isDemoStore?: boolean;
  className?: string;
}

/**
 * Why there is no retailer link, in visible text.
 *
 * A badge and a sentence, never a tooltip: a disclosure that requires hovering is
 * not a disclosure, and it is unreachable by touch entirely. Renders nothing when
 * the offer is genuinely linkable, and nothing when `isDemoStore` has already
 * covered it.
 */
export function DemoOfferNotice({
  offer,
  storeName,
  isDemoStore = false,
  className,
}: DemoOfferNoticeProps) {
  if (canOpenExternalDeal(offer)) return null;

  // The store-level notice is the stronger statement — a fictional shop — and it
  // is rendered elsewhere. Two stacked warnings read as a bug, not as candour.
  if (isDemoStore) return null;

  const isDemo = isDemoDataSource(offer.dataSourceType);

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      data-testid="demo-offer-notice"
    >
      <Badge tone="warn">
        {isDemo ? DEAL_CTA_COPY.demoOfferFrom(storeName) : DEAL_CTA_COPY.unverifiedBadge}
      </Badge>
      <span className="text-xs text-ink-500">
        {isDemo ? DEAL_CTA_COPY.demoOfferDisclosure : DEAL_CTA_COPY.unverified}
      </span>
    </div>
  );
}
