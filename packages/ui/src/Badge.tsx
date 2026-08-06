import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './utils/cn';

/**
 * Badge — small status label.
 *
 * Tones are semantic, not decorative: `drop`/`rise` are reserved for price
 * direction and `warn` for the fake-discount notice, so a colour always means
 * the same thing wherever it appears.
 */
export type BadgeTone = 'neutral' | 'accent' | 'drop' | 'rise' | 'warn' | 'muted';

/**
 * Extends the span's own attributes, matching `Card`, so a caller can attach a
 * `data-testid` or an `aria-*` hook without this component having to enumerate
 * one prop per use site.
 */
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  /** Rendered before the label, e.g. an arrow. */
  icon?: ReactNode;
  size?: 'sm' | 'md';
}

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-ink-700 border-line',
  accent: 'bg-accent-50 text-accent-800 border-accent-100',
  drop: 'bg-drop-50 text-drop-700 border-drop-50',
  rise: 'bg-rise-50 text-rise-700 border-rise-50',
  warn: 'bg-warn-50 text-warn-800 border-warn-200',
  muted: 'bg-transparent text-ink-500 border-line',
};

export function Badge({
  tone = 'neutral',
  size = 'sm',
  icon,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border font-semibold whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-0.5 text-[0.6875rem]' : 'px-2 py-1 text-xs',
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}
