import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './utils/cn';

/**
 * Button.
 *
 * Four variants, and only one of them is the accent colour — a page with three
 * competing primary buttons has no primary action. `disabled` is a real
 * attribute rather than a style, so assistive technology and keyboard
 * navigation both respect it.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a spinner, disables the button, and announces busy state. */
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55 select-none';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent-700 text-white hover:bg-accent-800 active:bg-accent-900',
  secondary:
    'bg-surface text-ink-900 border border-line-strong hover:bg-surface-muted active:bg-line',
  ghost: 'bg-transparent text-ink-700 hover:bg-surface-muted hover:text-ink-900',
  danger: 'bg-surface text-rise-700 border border-line-strong hover:bg-rise-50',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-[0.9375rem]',
  lg: 'h-12 px-6 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  leadingIcon,
  trailingIcon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {loading ? <Spinner /> : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
