import { Button, Field, Input, Select } from '@deal-finder/ui';
import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { MetaResponse } from '../../lib/api-client';

/**
 * The main search form, used on the home page.
 *
 * The free-text box accepts whole sentences ("Laptop under €1,000") which the
 * API interprets, and the explicit fields below let a user be precise. Both
 * paths are supported because both are natural: the results page then shows
 * exactly how the sentence was read, so an inferred filter is never invisible.
 */

export interface SearchFormValues {
  query: string;
  maximumPrice: string;
  minimumDiscount: string;
  category: string;
  stores: string[];
}

export const EMPTY_SEARCH: SearchFormValues = {
  query: '',
  maximumPrice: '',
  minimumDiscount: '',
  category: '',
  stores: [],
};

export interface SearchFormProps {
  meta: MetaResponse | undefined;
  initialValues?: Partial<SearchFormValues>;
  onSubmit: (values: SearchFormValues) => void;
  submitLabel?: string;
}

const DISCOUNT_OPTIONS = [10, 20, 30, 40, 50];

export function SearchForm({
  meta,
  initialValues,
  onSubmit,
  submitLabel = 'Find deals',
}: SearchFormProps) {
  const [values, setValues] = useState<SearchFormValues>({ ...EMPTY_SEARCH, ...initialValues });
  const categories = meta?.verticals[0]?.categories ?? [];

  const update = <K extends keyof SearchFormValues>(key: K, value: SearchFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" role="search">
      <Field label="What are you looking for?" hideLabel>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            name="query"
            type="search"
            value={values.query}
            onChange={(event) => update('query', event.target.value)}
            placeholder="Wireless headphones, laptop under €1,000, 30% off TVs…"
            className="h-13 text-base"
            leadingAddon={<Search className="size-4" aria-hidden="true" />}
            autoComplete="off"
            enterKeyHint="search"
          />
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Maximum price">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              name="maximumPrice"
              type="number"
              inputMode="decimal"
              min={0}
              step={10}
              value={values.maximumPrice}
              onChange={(event) => update('maximumPrice', event.target.value)}
              placeholder="Any"
              leadingAddon={<span className="text-sm">€</span>}
            />
          )}
        </Field>

        <Field label="Minimum discount">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              name="minimumDiscount"
              value={values.minimumDiscount}
              onChange={(event) => update('minimumDiscount', event.target.value)}
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
              value={values.category}
              onChange={(event) => update('category', event.target.value)}
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

        <Field label="Store">
          {(fieldProps) => (
            <Select
              {...fieldProps}
              name="stores"
              value={values.stores[0] ?? ''}
              onChange={(event) =>
                update('stores', event.target.value ? [event.target.value] : [])
              }
            >
              <option value="">All stores</option>
              {(meta?.stores ?? []).map((store) => (
                <option key={store.slug} value={store.slug}>
                  {store.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <div>
        <Button type="submit" size="lg" leadingIcon={<Search className="size-4" aria-hidden="true" />}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
