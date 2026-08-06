import {
  countryName,
  currencySymbol,
  formatMoney,
  type CountryCode,
  type Currency,
} from '@deal-finder/shared';
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
 *
 * With a `destination`, every one of those becomes destination-specific: the
 * threshold is on the *delivered* total, the reference price is the delivered
 * total rather than the shelf price, and the label names both the country and the
 * currency. Without one, the form is exactly what it was — which is why the prop
 * is nullable and why `onSubmit` still receives a bare number. The form reports
 * the number the user typed; the page, which is the thing that knows whether a
 * destination is active, decides which target it sets.
 */

export interface TargetPriceFormDestination {
  country: CountryCode;
  currency: Currency;
  /**
   * The current delivered total, when one can be computed.
   *
   * Null means unknown — unpublished shipping, or no usable exchange rate. The
   * form then stops comparing against anything rather than falling back to the
   * list price, because "your target is above the current price" would be a claim
   * about a number nobody has.
   */
  deliveredPrice: number | null;
}

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
  /** Null, and absent from test factories, keeps the pre-expansion form. */
  destination?: TargetPriceFormDestination | null;
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
  destination = null,
}: TargetPriceFormProps) {
  const [value, setValue] = useState(initialTarget != null ? String(initialTarget) : '');
  const [localError, setLocalError] = useState<string | null>(null);

  const targetCurrency = destination?.currency ?? currency;
  const destinationName = destination ? countryName(destination.country) : '';

  /**
   * The price a typed target is checked against.
   *
   * Null in destination mode with no delivered total: there is nothing to compare
   * to, and inventing a comparison out of the shelf price is the specific
   * dishonesty this whole feature exists to remove.
   */
  const referencePrice = destination ? destination.deliveredPrice : currentPrice;

  const suggestions = destination
    ? destination.deliveredPrice != null
      ? buildSuggestions(
          {
            currentPrice: destination.deliveredPrice,
            // The recorded low and average are list-price statistics. Offering them
            // as delivered targets would silently compare two different numbers.
            lowestPrice: null,
            averagePrice: null,
          },
          currencySymbol(targetCurrency),
        )
      : []
    : buildSuggestions({ currentPrice, lowestPrice, averagePrice });

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
    if (referencePrice != null && parsed >= referencePrice) {
      // Not rejected — just pointed out, because a target at or above the
      // current price would fire immediately and is usually a mistake.
      setLocalError(
        destination
          ? `That is at or above the current ${formatMoney(referencePrice, targetCurrency)} delivered to ${destinationName}, so it would alert straight away. Enter a lower price, or clear the field to track without a target.`
          : `That is at or above the current ${formatMoney(referencePrice, targetCurrency)}, so it would alert straight away. Enter a lower price, or clear the field to track without a target.`,
      );
      return;
    }

    onSubmit(Math.round(parsed * 100) / 100);
  };

  const message = error ?? localError;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field
        label={
          destination
            ? `Notify me when the delivered price to ${destinationName} is below`
            : 'Alert me when the price drops to'
        }
        description={
          destination
            ? `We will email you once, when the total delivered to ${destinationName} reaches this ${targetCurrency} amount.`
            : 'We will email you once, when it reaches this price.'
        }
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
            placeholder={
              destination
                ? destination.deliveredPrice != null
                  ? String(Math.floor(destination.deliveredPrice))
                  : 'Any price'
                : lowestPrice != null
                  ? String(Math.floor(lowestPrice))
                  : 'Any price'
            }
            leadingAddon={<span className="text-sm">{currencySymbol(targetCurrency)}</span>}
          />
        )}
      </Field>

      {/*
        Said before the user picks a number, not after they wonder why no alert
        arrived: with no delivered total there is nothing to evaluate a delivered
        target against, and the target is still worth setting for when one appears.
      */}
      {destination && destination.deliveredPrice == null && (
        <p className="text-xs font-medium text-warn-800">
          No delivered total can be calculated for {destinationName} yet, so we cannot compare your
          target to it. We will start checking as soon as delivery to {destinationName} is priced.
        </p>
      )}

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
        {destination
          ? isTracked
            ? 'Update delivered target'
            : 'Track delivered price'
          : isTracked
            ? 'Update target price'
            : 'Track this price'}
      </Button>
    </form>
  );
}

function buildSuggestions(
  args: {
    currentPrice: number;
    lowestPrice: number | null;
    averagePrice: number | null;
  },
  // Defaulted, so the pre-expansion call sites and their assertions are unchanged.
  symbol = '€',
): Array<{ label: string; value: number }> {
  const suggestions: Array<{ label: string; value: number }> = [];

  if (args.lowestPrice != null && args.lowestPrice < args.currentPrice) {
    suggestions.push({
      label: `Match its low (${symbol}${Math.floor(args.lowestPrice)})`,
      value: Math.floor(args.lowestPrice),
    });
  }

  const tenPercentOff = Math.floor(args.currentPrice * 0.9);
  if (tenPercentOff > 0) {
    suggestions.push({ label: `10% less (${symbol}${tenPercentOff})`, value: tenPercentOff });
  }

  if (args.averagePrice != null && args.averagePrice < args.currentPrice) {
    const belowAverage = Math.floor(args.averagePrice * 0.95);
    if (belowAverage > 0 && !suggestions.some((entry) => entry.value === belowAverage)) {
      suggestions.push({
        label: `Under its average (${symbol}${belowAverage})`,
        value: belowAverage,
      });
    }
  }

  return suggestions.slice(0, 3);
}
