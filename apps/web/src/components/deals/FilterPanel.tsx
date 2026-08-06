import {
  DEAL_SORT_OPTIONS,
  countryName,
  type CountryCode,
  type Currency,
  type DealSort,
} from '@deal-finder/shared';
import { Button, Checkbox, Field, Input, Select } from '@deal-finder/ui';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MetaResponse } from '../../lib/api-client';

/**
 * Filter panel — a sidebar on desktop, a drawer on mobile.
 *
 * Edits are held in local state and applied on submit rather than firing a
 * request per keystroke. That keeps the results stable while a user is still
 * deciding, and makes "Apply"/"Clear" meaningful.
 */

export interface FilterValues {
  maximumPrice: string;
  minimumDiscount: string;
  category: string;
  stores: string[];

  /**
   * Destination-aware bounds.
   *
   * All optional, so every existing caller and test constructs a valid
   * `FilterValues` without knowing these exist. They are strings for the same
   * reason the others are: a partially-typed number is a string, and coercing it
   * on every keystroke fights the user.
   */
  maximumDeliveredPrice?: string;
  maximumShippingPrice?: string;
  maxDeliveryDays?: string;
  shipsToCountryOnly?: boolean;
  includeUnknownShipping?: boolean;
}

export const SORT_LABELS: Record<DealSort, string> = {
  'best-discount': 'Best discount',
  'lowest-price': 'Lowest price',
  'highest-price': 'Highest price',
  'recently-updated': 'Recently updated',
  // Names shipping explicitly, because "lowest price" and "lowest delivered
  // price" routinely identify different stores and the label is the only thing
  // telling the user which question they just asked.
  'lowest-delivered': 'Lowest delivered price',
};

/**
 * Sort options offered when no delivery destination is selected.
 *
 * `lowest-delivered` is withheld rather than shown-and-degraded: offering a sort
 * that cannot do what its name says is worse than not offering it. The
 * destination-aware surfaces add it back.
 */
export const SORT_OPTIONS_WITHOUT_DESTINATION = DEAL_SORT_OPTIONS.filter(
  (option) => option !== 'lowest-delivered',
);

export interface FilterPanelProps {
  meta: MetaResponse | undefined;
  values: FilterValues;
  onApply: (values: FilterValues) => void;
  onClear: () => void;
  /** Rendered inside a drawer; shows a close button. */
  onClose?: () => void;
  /**
   * The selected destination, or null.
   *
   * Null renders the panel exactly as it rendered before this feature existed —
   * same fields, same labels, same order — which is what keeps the existing
   * filter tests and the end-to-end `getByLabel('Maximum price')` honest.
   */
  destination?: { country: CountryCode; currency: Currency } | null;
}

const DISCOUNT_OPTIONS = [10, 20, 30, 40, 50];

const DELIVERY_DAY_OPTIONS = [3, 7, 14, 30];

export function FilterPanel({
  meta,
  values,
  onApply,
  onClear,
  onClose,
  destination = null,
}: FilterPanelProps) {
  const [draft, setDraft] = useState<FilterValues>(values);

  // Keep the draft in step when filters change elsewhere (e.g. the URL changes
  // via browser back, or a saved search is applied).
  useEffect(() => setDraft(values), [values]);

  const categories = meta?.verticals[0]?.categories ?? [];
  const stores = meta?.stores ?? [];

  const toggleStore = (slug: string) =>
    setDraft((current) => ({
      ...current,
      stores: current.stores.includes(slug)
        ? current.stores.filter((entry) => entry !== slug)
        : [...current.stores, slug],
    }));

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(draft);
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base">Filters</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-500 hover:bg-surface-muted"
            aria-label="Close filters"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/*
        One money field in this slot, and which question it asks depends on
        whether a destination is selected.

        Without one it is the listed price, labelled and named exactly as it always
        was. With one it becomes the *delivered* bound — because once a destination
        exists, the number a shopper is willing to spend is the one that includes
        getting the thing to them, and offering both bounds side by side invites
        setting the wrong one. The label change is therefore not cosmetic: the
        field is bound to a different parameter.
      */}
      {destination ? (
        <Field
          label="Maximum delivered price"
          description={`Total to ${countryName(destination.country)}, including delivery`}
        >
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="maximumDeliveredPrice"
              type="number"
              inputMode="decimal"
              min={0}
              step={10}
              value={draft.maximumDeliveredPrice ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, maximumDeliveredPrice: event.target.value })
              }
              placeholder="Any"
              leadingAddon={<span className="text-xs">{destination.currency}</span>}
            />
          )}
        </Field>
      ) : (
        <Field label="Maximum price" description="Leave empty for any price">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="maximumPrice"
              type="number"
              inputMode="decimal"
              min={0}
              step={10}
              value={draft.maximumPrice}
              onChange={(event) => setDraft({ ...draft, maximumPrice: event.target.value })}
              placeholder="Any"
              leadingAddon={<span className="text-sm">€</span>}
            />
          )}
        </Field>
      )}

      {destination && (
        <>
          <Field
            label="Maximum delivery cost"
            description="Offers with no published delivery cost are excluded by this"
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                name="maximumShippingPrice"
                type="number"
                inputMode="decimal"
                min={0}
                step={5}
                value={draft.maximumShippingPrice ?? ''}
                onChange={(event) =>
                  setDraft({ ...draft, maximumShippingPrice: event.target.value })
                }
                placeholder="Any"
                leadingAddon={<span className="text-xs">{destination.currency}</span>}
              />
            )}
          </Field>

          <Field label="Maximum delivery time">
            {(fieldProps) => (
              <Select
                {...fieldProps}
                name="maxDeliveryDays"
                value={draft.maxDeliveryDays ?? ''}
                onChange={(event) => setDraft({ ...draft, maxDeliveryDays: event.target.value })}
              >
                <option value="">Any delivery time</option>
                {DELIVERY_DAY_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    Within {days} business days
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-1 text-sm font-medium text-ink-700">
              Delivery to {countryName(destination.country)}
            </legend>
            <Checkbox
              name="shipsToCountryOnly"
              label={`Only offers that ship to ${countryName(destination.country)}`}
              description="Turn this off to also see stores that sell it but cannot deliver here."
              checked={draft.shipsToCountryOnly ?? true}
              onChange={(event) =>
                setDraft({ ...draft, shipsToCountryOnly: event.target.checked })
              }
            />
            <Checkbox
              name="includeUnknownShipping"
              label="Include offers with unknown delivery cost"
              description="Shown but never ranked as cheapest — their total cannot be calculated."
              checked={draft.includeUnknownShipping ?? true}
              onChange={(event) =>
                setDraft({ ...draft, includeUnknownShipping: event.target.checked })
              }
            />
          </fieldset>
        </>
      )}

      <Field label="Minimum discount">
        {(fieldProps) => (
          <Select
            {...fieldProps}
            name="minimumDiscount"
            value={draft.minimumDiscount}
            onChange={(event) => setDraft({ ...draft, minimumDiscount: event.target.value })}
          >
            <option value="">Any discount</option>
            {DISCOUNT_OPTIONS.map((percent) => (
              <option key={percent} value={percent}>
                {percent}% or more
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Category">
        {(fieldProps) => (
          <Select
            {...fieldProps}
            name="category"
            value={draft.category}
            onChange={(event) => setDraft({ ...draft, category: event.target.value })}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-1 text-sm font-medium text-ink-700">Stores</legend>
        {stores.length === 0 && <p className="text-xs text-ink-500">No stores available.</p>}
        {stores.map((store) => (
          <Checkbox
            key={store.slug}
            name="stores"
            value={store.slug}
            label={store.name}
            checked={draft.stores.includes(store.slug)}
            onChange={() => toggleStore(store.slug)}
          />
        ))}
      </fieldset>

      <div className="flex gap-2 border-t border-line pt-4">
        <Button type="submit" size="sm" className="flex-1">
          Apply filters
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>
    </form>
  );
}

export interface SortSelectProps {
  value: DealSort;
  onChange: (value: DealSort) => void;
  /**
   * Which options to offer. Defaults to the set that works without a delivery
   * destination, so a page that has not opted into destination awareness cannot
   * accidentally present a sort that has nothing to sort on.
   */
  options?: readonly DealSort[];
}

export function SortSelect({
  value,
  onChange,
  options = SORT_OPTIONS_WITHOUT_DESTINATION,
}: SortSelectProps) {
  /*
    `min-w-0 flex-1` below `sm` so the control can shrink into a narrow viewport.
    A bare `min-w-48` is a floor its flex container cannot go under, which is what
    pushed the results toolbar past the viewport at 320px.
  */
  return (
    <Field label="Sort by" hideLabel className="min-w-0 flex-1 sm:min-w-48 sm:flex-none">
      {(fieldProps) => (
        <Select
          {...fieldProps}
          name="sort"
          value={value}
          onChange={(event) => onChange(event.target.value as DealSort)}
          className="h-10"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              Sort: {SORT_LABELS[option]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
