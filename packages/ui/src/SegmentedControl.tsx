import { useId } from 'react';
import { cn } from './utils/cn';

/**
 * A small set of mutually exclusive choices, shown as buttons.
 *
 * Built on native radio inputs rather than on buttons with `aria-pressed`, for
 * the same reason `Select` is a native `<select>`: arrow-key roving focus,
 * grouping via `<fieldset>`/`<legend>`, screen-reader announcement of "2 of 3",
 * and forced-colours support all arrive for free and are all easy to get wrong
 * by hand. The inputs are visually hidden; the labels are what you see.
 *
 * Use it when the user is choosing between *views* of the same data. A checkbox
 * would be wrong for that: it hides what the alternative is.
 */

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  /** Visible group label; keep it if there is room, hide it if there is not. */
  legend: string;
  hideLegend?: boolean;
  /** Radio group name. Must be unique on the page if two controls coexist. */
  name: string;
  value: T;
  options: readonly SegmentedControlOption<T>[];
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}

export function SegmentedControl<T extends string>({
  legend,
  hideLegend = false,
  name,
  value,
  options,
  onChange,
  size = 'sm',
  className,
}: SegmentedControlProps<T>) {
  const id = useId();

  return (
    <fieldset className={cn('flex min-w-0 flex-col gap-1', className)}>
      <legend
        className={cn(
          'text-xs font-medium text-ink-500',
          hideLegend && 'sr-only absolute size-px overflow-hidden whitespace-nowrap',
        )}
      >
        {legend}
      </legend>

      <div className="inline-flex rounded-lg border border-line-strong bg-surface-muted p-0.5">
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;
          const selected = option.value === value;
          return (
            <div key={option.value} className="relative">
              <input
                type="radio"
                id={optionId}
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                /*
                  Invisible but *full-size*, rather than `sr-only`.
                  `hidden` would drop it out of the keyboard order entirely, and
                  `sr-only` shrinks it to a 1px box the visible label then covers
                  — so the input, which is the actual control, has no clickable
                  area of its own. Anything driving it directly (assistive
                  tooling, a test runner, a stylus) then aims at something it
                  cannot hit. Stretching it over the segment keeps the control
                  and its hit target the same object.
                */
                className="peer absolute inset-0 z-10 m-0 cursor-pointer appearance-none opacity-0"
              />
              <label
                htmlFor={optionId}
                className={cn(
                  'block cursor-pointer rounded-md text-center font-medium whitespace-nowrap transition-colors',
                  size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
                  selected
                    ? 'bg-surface text-ink-900 shadow-card'
                    : 'text-ink-500 hover:text-ink-700',
                  // The focus ring has to live on the label, because the input
                  // it belongs to is visually hidden.
                  'peer-focus-visible:ring-2 peer-focus-visible:ring-accent-700 peer-focus-visible:ring-offset-1',
                )}
              >
                {option.label}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
