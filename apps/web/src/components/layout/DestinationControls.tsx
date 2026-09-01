import {
  CURRENCIES,
  STORE_REGIONS,
  countryName,
  type CountryCode,
  type Currency,
  type StoreRegion,
} from '@deal-finder/shared';
import { Field, SegmentedControl, Select, cn } from '@deal-finder/ui';
import { useCountryOptions } from '../../lib/queries';
import { useDestination } from '../../lib/destination';

/**
 * The delivery-destination controls.
 *
 * Rendered twice — once in the header for wide viewports, once inside the
 * existing mobile navigation panel — and never both at once: the desktop copy is
 * `hidden md:flex` and the mobile panel is `md:hidden` *and* only mounted while
 * open. That matters beyond duplicate-DOM tidiness, because `SegmentedControl`
 * is built on real radio inputs: two groups sharing a `name` attribute would
 * fight over which one is checked. Hence the required `idPrefix`.
 *
 * Country names are always the visible text. No flag is used as an identifier at
 * all: several are indistinguishable at 16px, screen readers announce them as
 * unhelpful emoji names, and a shopping tool has no business asserting the
 * political questions a few of them carry.
 */

const REGION_LABELS: Record<StoreRegion, string> = {
  local: 'Local',
  nordic: 'Nordic',
  european: 'European',
};

const REGION_OPTIONS = STORE_REGIONS.map((region) => ({
  value: region,
  label: REGION_LABELS[region],
}));

export interface DestinationControlsProps {
  /** Distinguishes the two rendered copies. Must be unique on the page. */
  idPrefix: string;
  /** `header` is compact with hidden labels; `panel` is stacked and labelled. */
  layout: 'header' | 'panel';
  className?: string;
}

export function DestinationControls({ idPrefix, layout, className }: DestinationControlsProps) {
  const { country, currency, region, isActive, setDestination, clearDestination } =
    useDestination();
  const compact = layout === 'header';

  /**
   * Selectable destinations, and the rest.
   *
   * `useCountryOptions` falls back to the static shared table, so this control is
   * complete on the first paint and stays complete if `/api/countries` never
   * answers. The API only mirrors that table, so a dead server is no reason to
   * offer one country — which is what this did before, and it read as "we ship
   * to one place" rather than "the server is down".
   *
   * Unsupported countries are listed and disabled rather than omitted. Omitting
   * them leaves "why is Norway missing?" unanswerable; showing them greyed out
   * with a reason is the honest version, and it is also the only way a user can
   * tell "not supported yet" from "we forgot".
   */
  const options = useCountryOptions();
  const supported = options.filter((option) => option.isSupported);
  const modelled = options.filter((option) => !option.isSupported);

  return (
    <div
      className={cn(
        compact ? 'flex items-end gap-2' : 'flex flex-col gap-3 border-t border-line px-3 py-3',
        className,
      )}
    >
      <Field
        label="Deliver to"
        hideLabel={compact}
        className={cn('gap-0.5', compact ? 'w-36' : 'w-full')}
      >
        {(fieldProps) => (
          <Select
            {...fieldProps}
            value={country}
            onChange={(event) => setDestination({ country: event.target.value as CountryCode })}
            className={compact ? 'h-9 text-xs' : undefined}
          >
            {supported.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
            {modelled.length > 0 && (
              <optgroup label="Not available yet">
                {modelled.map((option) => (
                  <option key={option.code} value={option.code} disabled>
                    {option.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        )}
      </Field>

      <Field
        label="Currency"
        hideLabel={compact}
        className={cn('gap-0.5', compact ? 'w-20' : 'w-full')}
      >
        {(fieldProps) => (
          <Select
            {...fieldProps}
            value={currency}
            onChange={(event) => setDestination({ currency: event.target.value as Currency })}
            className={compact ? 'h-9 text-xs' : undefined}
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <SegmentedControl
        legend="Store region"
        hideLegend={compact}
        // Unique per rendered copy: two radio groups sharing a name would let the
        // hidden mobile panel decide what the visible header shows.
        name={`${idPrefix}-region`}
        value={region}
        options={REGION_OPTIONS}
        onChange={(next) => setDestination({ region: next })}
        className={compact ? undefined : 'w-full'}
      />

      {isActive && (
        <button
          type="button"
          onClick={clearDestination}
          className={cn(
            'rounded-lg text-xs text-ink-500 underline transition-colors hover:text-accent-700',
            compact ? 'pb-2' : 'self-start',
          )}
        >
          Clear destination
        </button>
      )}
    </div>
  );
}

/**
 * A one-line statement of where prices are being compared for.
 *
 * Every results and comparison surface has to say this, because a delivered
 * total means nothing without a destination attached to it. Kept as its own
 * component so the wording cannot drift between pages.
 */
export function DestinationSummary({
  country,
  currency,
  className,
}: {
  country: CountryCode;
  currency: Currency;
  className?: string;
}) {
  return (
    <p className={cn('text-sm text-ink-500', className)} data-testid="destination-summary">
      Delivered prices to <span className="font-medium text-ink-700">{countryName(country)}</span>,
      shown in {currency}.
    </p>
  );
}
