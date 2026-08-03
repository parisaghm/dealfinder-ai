/**
 * Conditional className joiner.
 *
 * Hand-written rather than pulling in a dependency: this is the entire feature
 * set the design system needs, and it keeps `packages/ui` free of runtime
 * dependencies beyond React.
 */
export type ClassValue = string | number | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  let result = '';
  for (const value of values) {
    if (!value && value !== 0) continue;
    result = result ? `${result} ${value}` : String(value);
  }
  return result;
}
