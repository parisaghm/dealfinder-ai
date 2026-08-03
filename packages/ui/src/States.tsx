import type { ReactNode } from 'react';
import { Button } from './Button';
import { cn } from './utils/cn';

/**
 * Loading, empty and error states.
 *
 * Treated as first-class UI rather than afterthoughts: every list in the app
 * renders one of these instead of a blank area, and each one tells the user
 * what happened and what they can do next.
 */

export interface SkeletonProps {
  className?: string;
}

/** Neutral placeholder block. Hidden from assistive tech — it conveys nothing. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-muted', className)}
    />
  );
}

/** Mirrors ProductCard's geometry so the grid does not reflow when data lands. */
export function ProductCardSkeleton() {
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <Skeleton className="mb-4 aspect-4/3 w-full rounded-lg" />
      <Skeleton className="mb-2 h-3 w-20" />
      <Skeleton className="mb-1.5 h-4 w-full" />
      <Skeleton className="mb-4 h-4 w-2/3" />
      <Skeleton className="mb-2 h-7 w-28" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line-strong bg-surface px-6 py-14 text-center',
        className,
      )}
    >
      {icon && <div className="text-ink-400">{icon}</div>}
      <div className="flex max-w-md flex-col gap-1.5">
        <h3 className="text-base">{title}</h3>
        {description && <p className="text-sm text-ink-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  /** Shown to the user. Keep it actionable, not a raw stack trace. */
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'We could not load this just now. It may be a temporary problem.',
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      // Announced immediately: a failure the user did not expect.
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-card border border-line bg-surface px-6 py-14 text-center',
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-rise-50 text-rise-700">
        <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden="true">
          <path
            d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="flex max-w-md flex-col gap-1.5">
        <h3 className="text-base">{title}</h3>
        <p className="text-sm text-ink-500">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Inline spinner with an accessible label, for non-blocking loads. */
export function LoadingIndicator({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink-500" role="status">
      <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path
          d="M22 12a10 10 0 0 0-10-10"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {label}
    </div>
  );
}
