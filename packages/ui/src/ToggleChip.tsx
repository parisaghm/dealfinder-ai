import type { ReactNode } from 'react';
import { cn } from './utils/cn';

/**
 * An on/off chip.
 *
 * A real `<button aria-pressed>`, not a styled checkbox, because the thing it
 * toggles is a *view*, not a form value — nothing here gets submitted.
 * `aria-pressed` is what makes the state audible; the label is what makes it
 * legible. Neither is optional.
 *
 * `leadingIcon` exists for a colour swatch. The swatch must always be
 * decorative: if removing it would leave the chip ambiguous, the label is
 * wrong.
 */

export interface ToggleChipProps {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  /** Decorative only — the label carries the meaning. */
  leadingIcon?: ReactNode;
  /** Secondary text, e.g. the current price for this store. */
  trailingText?: string;
  children: ReactNode;
  className?: string;
}

export function ToggleChip({
  pressed,
  onPressedChange,
  leadingIcon,
  trailingText,
  children,
  className,
}: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        pressed
          ? 'border-line-strong bg-surface text-ink-900'
          // Dimmed *and* struck-through-adjacent: on a greyscale display the
          // border weight alone would not distinguish the two states.
          : 'border-line bg-surface-muted text-ink-400 line-through decoration-1',
        className,
      )}
    >
      {leadingIcon && (
        <span aria-hidden="true" className={cn('flex shrink-0', !pressed && 'opacity-40')}>
          {leadingIcon}
        </span>
      )}
      <span>{children}</span>
      {trailingText && (
        <span className={cn('tabular', pressed ? 'text-ink-500' : 'text-ink-400')}>
          {trailingText}
        </span>
      )}
    </button>
  );
}
