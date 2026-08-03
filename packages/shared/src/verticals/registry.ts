import { electronicsVertical } from './electronics';
import type { CategoryDescriptor, VerticalDescriptor } from './types';

/**
 * The vertical registry.
 *
 * Adding a market later is a three-step change with no migration of core
 * tables and no edits to search, scoring or alerting:
 *   1. write `verticals/<name>.ts` exporting a `VerticalDescriptor`,
 *   2. register it here,
 *   3. add store adapters for it in `@deal-finder/store-providers`.
 */

export const DEFAULT_VERTICAL_ID = 'electronics';

const REGISTRY = new Map<string, VerticalDescriptor<never>>(
  [electronicsVertical as unknown as VerticalDescriptor<never>].map((vertical) => [
    vertical.id,
    vertical,
  ]),
);

export function listVerticals(options?: { enabledOnly?: boolean }): VerticalDescriptor<never>[] {
  const all = [...REGISTRY.values()];
  return options?.enabledOnly ? all.filter((vertical) => vertical.enabled) : all;
}

export function getVertical(id: string): VerticalDescriptor<never> | undefined {
  return REGISTRY.get(id);
}

/** The default vertical, guaranteed to exist — the app is unusable without it. */
export function getDefaultVertical(): VerticalDescriptor<never> {
  const vertical = REGISTRY.get(DEFAULT_VERTICAL_ID);
  if (!vertical) {
    throw new Error(`Default vertical "${DEFAULT_VERTICAL_ID}" is not registered`);
  }
  return vertical;
}

export function isKnownVertical(id: string): boolean {
  return REGISTRY.has(id);
}

export function getCategories(
  verticalId: string = DEFAULT_VERTICAL_ID,
): readonly CategoryDescriptor[] {
  return getVertical(verticalId)?.categories ?? [];
}

export function findCategoryById(
  categoryId: string,
  verticalId: string = DEFAULT_VERTICAL_ID,
): CategoryDescriptor | undefined {
  return getCategories(verticalId).find((category) => category.id === categoryId);
}

/**
 * Resolve a free-text term onto a category, matching the id, the label or any
 * declared synonym. Longest synonyms are tried first so "robot vacuum" wins
 * over "vacuum" when both would match.
 */
export function matchCategory(
  term: string,
  verticalId: string = DEFAULT_VERTICAL_ID,
): CategoryDescriptor | undefined {
  const needle = term.trim().toLowerCase();
  if (!needle) return undefined;

  const categories = getCategories(verticalId);
  for (const category of categories) {
    if (category.id === needle || category.label.toLowerCase() === needle) return category;
  }

  const candidates = categories
    .flatMap((category) => category.synonyms.map((synonym) => ({ category, synonym })))
    .sort((a, b) => b.synonym.length - a.synonym.length);

  return candidates.find(({ synonym }) => synonym === needle)?.category;
}

/** Every `(synonym, category)` pair, longest synonym first. Used by the parser. */
export function categorySynonymIndex(
  verticalId: string = DEFAULT_VERTICAL_ID,
): Array<{ synonym: string; category: CategoryDescriptor }> {
  return getCategories(verticalId)
    .flatMap((category) => [
      { synonym: category.label.toLowerCase(), category },
      ...category.synonyms.map((synonym) => ({ synonym: synonym.toLowerCase(), category })),
    ])
    .sort((a, b) => b.synonym.length - a.synonym.length);
}
