import { describe, expect, it } from 'vitest';
import { niceScale } from './chart-scale';

/**
 * First coverage for the tick arithmetic. It had none while it lived inside
 * `PriceHistoryChart`, and it is now shared by two charts on the same page —
 * which is exactly when a silent disagreement would start to show.
 */
describe('niceScale', () => {
  it('produces round ticks a reader can hold in their head', () => {
    // The data's own range would give ticks like 65,97 / 85,97 / 105,97.
    const { ticks } = niceScale(65.97, 105.97);
    expect(ticks.every((tick) => Number.isInteger(tick) || tick % 0.5 === 0)).toBe(true);
    expect(ticks).toContain(80);
  });

  it('pads the domain so the line never touches the frame', () => {
    const { domain } = niceScale(100, 200);
    expect(domain[0]).toBeLessThanOrEqual(100);
    expect(domain[1]).toBeGreaterThanOrEqual(200);
  });

  it('never returns a negative lower bound for a price axis', () => {
    expect(niceScale(2, 8).domain[0]).toBe(0);
  });

  it('handles a flat series without collapsing the axis', () => {
    const { domain, ticks } = niceScale(329, 329);
    expect(domain[1]).toBeGreaterThan(domain[0]);
    expect(ticks.length).toBeGreaterThan(1);
  });

  it('produces ascending, unique ticks inside the domain', () => {
    const { domain, ticks } = niceScale(129.9, 1499);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(ticks[0]).toBeGreaterThanOrEqual(domain[0]);
  });

  it('is deterministic', () => {
    expect(niceScale(319, 339)).toEqual(niceScale(319, 339));
  });
});
