import { formatMoney, type Currency } from '@deal-finder/shared';
import { Button, Field, Input } from '@deal-finder/ui';
import { BellRing, Check } from 'lucide-react';
import { useState, type FormEvent } from 'react';

/**
 * Target-price form.
 *
 * Validated in the browser *and* by Zod on the server. The client-side pass
 * exists purely so a user gets an immediate, specific message instead of a
 * round trip and a generic 400 — the server remains the authority.
 *
 * The suggested-price hints matter more than they look: "what number should I
 * even pick?" is the real friction here, so the current price, the recorded low
 * and a round number below the average are all one click away.
 */

export interface TargetPriceFormProps {
  currency: Currency;
  currentPrice: number;
  lowestPrice: number | null;
  averagePrice: number | null;
  /** Existing target when the product is already tracked. */
  initialTarget?: number | null;
  isTracked: boolean;
  pending?: boolean;
  onSubmit: (targetPrice: number | null) => void;
  error?: string | null;
}

export function TargetPriceForm({
  currency,
  currentPrice,
  lowestPrice,
  averagePrice,
  initialTarget,
  isTracked,
  pending = false,
  onSubmit,
  error,
}: TargetPriceFormProps) {
  const [value, setValue] = useState(initialTarget != null ? String(initialTarget) : '');
  const [localError, setLocalError] = useState<string | null>(null);

  const suggestions = buildSuggestions({ currentPrice, lowestPrice, averagePrice });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);

    const trimmed = value.trim();
    if (trimmed === '') {
      // An empty field means "track without a target", which is valid.
      onSubmit(null);
      return;
    }

    const parsed = Number(trimmed.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      setLocalError('Enter a price, for example 249 or 249,90.');
      return;
    }
    if (parsed <= 0) {
      setLocalError('The target price has to be above zero.');
      return;
    }
    if (parsed >= currentPrice) {
      // Not rejected — just pointed out, because a target at or above the
      // current price would fire immediately and is usually a mistake.
      setLocalError(
        `That is at or above the current ${formatMoney(currentPrice, currency)}, so it would alert straight away. Enter a lower price, or clear the field to track without a target.`,
      );
      return;
    }

    onSubmit(Math.round(parsed * 100) / 100);
  };

  const message = error ?? localError;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field
        label="Alert me when the price drops to"
        description="We will email you once, when it reaches this price."
        error={message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            name="targetPrice"
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setLocalError(null);
            }}
            placeholder={lowestPrice != null ? String(Math.floor(lowestPrice)) : 'Any price'}
            leadingAddon={<span className="text-sm">€</span>}
          />
        )}
      </Field>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-500">Suggestions:</span>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              onClick={() => {
                setValue(String(suggestion.value));
                setLocalError(null);
              }}
              className="rounded-full border border-line-strong px-2.5 py-1 text-xs font-medium text-ink-700 transition-colors hover:border-accent-500 hover:text-accent-700"
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      )}

      <Button
        type="submit"
        loading={pending}
        leadingIcon={
          isTracked ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <BellRing className="size-4" aria-hidden="true" />
          )
        }
      >
        {isTracked ? 'Update target price' : 'Track this price'}
      </Button>
    </form>
  );
}

function buildSuggestions(args: {
  currentPrice: number;
  lowestPrice: number | null;
  averagePrice: number | null;
}): Array<{ label: string; value: number }> {
  const suggestions: Array<{ label: string; value: number }> = [];

  if (args.lowestPrice != null && args.lowestPrice < args.currentPrice) {
    suggestions.push({
      label: `Match its low (€${Math.floor(args.lowestPrice)})`,
      value: Math.floor(args.lowestPrice),
    });
  }

  const tenPercentOff = Math.floor(args.currentPrice * 0.9);
  if (tenPercentOff > 0) {
    suggestions.push({ label: `10% less (€${tenPercentOff})`, value: tenPercentOff });
  }

  if (args.averagePrice != null && args.averagePrice < args.currentPrice) {
    const belowAverage = Math.floor(args.averagePrice * 0.95);
    if (belowAverage > 0 && !suggestions.some((entry) => entry.value === belowAverage)) {
      suggestions.push({ label: `Under its average (€${belowAverage})`, value: belowAverage });
    }
  }

  return suggestions.slice(0, 3);
}
