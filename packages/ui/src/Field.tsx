import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from './utils/cn';

/**
 * Form controls.
 *
 * Every control is wrapped by `Field`, which generates an id and wires up
 * `<label for>`, the description and the error message via `aria-describedby`
 * and `aria-invalid`. Making that automatic is the point: a labelled,
 * screen-reader-navigable form becomes the default rather than something each
 * page has to remember.
 */

export interface FieldProps {
  label: string;
  /** Helper text rendered under the control and linked for assistive tech. */
  description?: string;
  error?: string | null;
  /** Visually hides the label while keeping it available to screen readers. */
  hideLabel?: boolean;
  required?: boolean;
  className?: string;
  children: (props: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
  }) => ReactNode;
}

export function Field({
  label,
  description,
  error,
  hideLabel = false,
  required = false,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={id}
        className={cn(
          'text-sm font-medium text-ink-700',
          hideLabel && 'sr-only absolute size-px overflow-hidden whitespace-nowrap',
        )}
      >
        {label}
        {required && (
          <span className="ml-0.5 text-rise-700" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}

      {description && !error && (
        <p id={descriptionId} className="text-xs text-ink-500">
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-rise-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL_BASE =
  'w-full rounded-lg border bg-surface text-ink-900 placeholder:text-ink-400 transition-colors duration-150 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-400';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /**
   * Rendered inside the field, e.g. a currency symbol or a search icon.
   *
   * Named `leadingAddon` rather than `prefix` because `prefix` is a real HTML
   * attribute typed as `string`, and shadowing it with a ReactNode is a type
   * error waiting to happen.
   */
  leadingAddon?: ReactNode;
  invalid?: boolean;
}

export function Input({ className, leadingAddon, invalid, ...rest }: InputProps) {
  const control = (
    <input
      className={cn(
        CONTROL_BASE,
        'h-11 text-[0.9375rem]',
        // Longhand vs shorthand: `px-3` and `pl-9` in the same class list race
        // on CSS source order, not attribute order, so the addon's clearance
        // was unreliable. Pick one padding rule per case instead.
        leadingAddon ? 'pr-3 pl-9' : 'px-3',
        invalid || rest['aria-invalid'] ? 'border-rise-700' : 'border-line-strong',
        className,
      )}
      {...rest}
    />
  );

  if (!leadingAddon) return control;

  return (
    <div className="relative">
      {/*
        Centred with `inset-y-0` + flex rather than `top-1/2 -translate-y-1/2`:
        the translate approach positions relative to the span's own line box,
        which drifts against the input's text baseline at some font sizes.
      */}
      <span
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-400"
        aria-hidden="true"
      >
        {leadingAddon}
      </span>
      {control}
    </div>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/**
 * A native `<select>`.
 *
 * Deliberately not a custom dropdown: the platform control is fully accessible,
 * keyboard-navigable and uses the native picker on mobile — all of which a
 * hand-rolled listbox would have to reimplement, usually worse.
 */
/**
 * The chevron is drawn as a background image so the control needs no icon
 * dependency and no wrapper element.
 *
 * Every background property is set inline rather than via Tailwind arbitrary
 * values: `bg-[length:…]`/`bg-[right_…]` are ambiguous to parse and silently
 * failed to apply `no-repeat`, which tiled the chevron across the whole field.
 * Inline styles are unambiguous and version-proof.
 */
const CHEVRON_BACKGROUND = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%23667085' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 8l4 4 4-4'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0.75rem center',
  backgroundSize: '1rem 1rem',
} as const;

export function Select({ className, invalid, children, style, ...rest }: SelectProps) {
  return (
    <select
      className={cn(
        CONTROL_BASE,
        'h-11 cursor-pointer appearance-none pr-9 pl-3 text-[0.9375rem]',
        invalid || rest['aria-invalid'] ? 'border-rise-700' : 'border-line-strong',
        className,
      )}
      style={{ ...CHEVRON_BACKGROUND, ...style }}
      {...rest}
    >
      {children}
    </select>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: string;
}

export function Checkbox({ label, description, className, ...rest }: CheckboxProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        id={id}
        type="checkbox"
        aria-describedby={descriptionId}
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line-strong text-accent-700 accent-accent-700"
        {...rest}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm text-ink-700">
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-xs text-ink-500">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
