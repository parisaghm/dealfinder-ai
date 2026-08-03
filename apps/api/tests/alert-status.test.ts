import { describe, expect, it } from 'vitest';
import { deriveAlertStatus } from '../src/services/watchlist.service';

/**
 * The delivered-price alert rules.
 *
 * These four behaviours were settled during review and are easy to regress,
 * because each one is a case where the *obvious* implementation is wrong:
 *
 *  1. A delivered target takes precedence over a list-price target when both are
 *     set — the delivered figure is what the user actually pays.
 *  2. An unknown delivered total yields WAITING, never TARGET_REACHED. An unknown
 *     total has not been shown to beat anything.
 *  3. A stale or missing exchange rate must never trigger TARGET_REACHED. It
 *     reaches this function as a null delivered total, which case 2 covers.
 *  4. Legacy list-price targets behave exactly as they always did.
 *
 * Pure function, no database — the DB-level behaviour is covered by the
 * monitoring suite.
 */

describe('deriveAlertStatus — paused', () => {
  it('reports PAUSED regardless of any target being met', () => {
    // Telling a user their target was reached when no email is coming would be
    // misleading, so paused wins over everything.
    expect(
      deriveAlertStatus({
        alertsEnabled: false,
        targetPrice: 500,
        currentPrice: 100,
        targetDeliveredPrice: 500,
        currentDeliveredPrice: 100,
      }),
    ).toBe('PAUSED');
  });
});

describe('deriveAlertStatus — legacy list-price targets are unchanged', () => {
  it('reports NO_TARGET when nothing is set', () => {
    expect(deriveAlertStatus({ alertsEnabled: true, targetPrice: null, currentPrice: 299 })).toBe(
      'NO_TARGET',
    );
  });

  it('reports TARGET_REACHED below the list target', () => {
    expect(deriveAlertStatus({ alertsEnabled: true, targetPrice: 300, currentPrice: 299 })).toBe(
      'TARGET_REACHED',
    );
  });

  it('reports TARGET_REACHED exactly at the list target', () => {
    expect(deriveAlertStatus({ alertsEnabled: true, targetPrice: 300, currentPrice: 300 })).toBe(
      'TARGET_REACHED',
    );
  });

  it('reports WAITING above the list target', () => {
    expect(deriveAlertStatus({ alertsEnabled: true, targetPrice: 300, currentPrice: 301 })).toBe(
      'WAITING',
    );
  });

  it('is unaffected by a delivered total when no delivered target is set', () => {
    // An existing item means what it always meant. Knowing the delivered price
    // must not retroactively change when a list-price alert fires.
    expect(
      deriveAlertStatus({
        alertsEnabled: true,
        targetPrice: 300,
        currentPrice: 299,
        targetDeliveredPrice: null,
        currentDeliveredPrice: 311.9,
      }),
    ).toBe('TARGET_REACHED');
  });
});

describe('deriveAlertStatus — delivered targets take precedence', () => {
  it('uses the delivered total, not the list price, when both targets are set', () => {
    // The list price beats its target (299 <= 300) but the delivered total does
    // not (311.90 > 300). The delivered answer must win, or the user is told they
    // hit €300 when the parcel will cost €311.90.
    expect(
      deriveAlertStatus({
        alertsEnabled: true,
        targetPrice: 300,
        currentPrice: 299,
        targetDeliveredPrice: 300,
        currentDeliveredPrice: 311.9,
      }),
    ).toBe('WAITING');
  });

  it('reports TARGET_REACHED when the delivered total beats the delivered target', () => {
    expect(
      deriveAlertStatus({
        alertsEnabled: true,
        targetPrice: null,
        currentPrice: 299,
        targetDeliveredPrice: 320,
        currentDeliveredPrice: 311.9,
      }),
    ).toBe('TARGET_REACHED');
  });

  it('reports TARGET_REACHED exactly at the delivered target', () => {
    expect(
      deriveAlertStatus({
        alertsEnabled: true,
        targetPrice: null,
        currentPrice: 299,
        targetDeliveredPrice: 311.9,
        currentDeliveredPrice: 311.9,
      }),
    ).toBe('TARGET_REACHED');
  });

  it('ignores a list price that is far above the delivered target', () => {
    expect(
      deriveAlertStatus({
        alertsEnabled: true,
        targetPrice: 10,
        currentPrice: 9999,
        targetDeliveredPrice: 400,
        currentDeliveredPrice: 311.9,
      }),
    ).toBe('TARGET_REACHED');
  });
});

describe('deriveAlertStatus — an unknown delivered total never fires', () => {
  it('reports WAITING when a delivered target is set but the total is unknown', () => {
    // Unpublished shipping. The total is unknowable, so it has not been shown to
    // beat anything — and must not be reported as though it had.
    expect(
      deriveAlertStatus({
        alertsEnabled: true,
        targetPrice: null,
        currentPrice: 299,
        targetDeliveredPrice: 300,
        currentDeliveredPrice: null,
      }),
    ).toBe('WAITING');
  });

  it('does not fall back to the list price when the delivered total is unknown', () => {
    // The dangerous case: 299 <= 300 would fire on the list price, which is
    // exactly the substitution that makes an unpublished delivery cost read as
    // free. A delivered target must be answered with delivered data or not at all.
    expect(
      deriveAlertStatus({
        alertsEnabled: true,
        targetPrice: 300,
        currentPrice: 299,
        targetDeliveredPrice: 300,
        currentDeliveredPrice: null,
      }),
    ).toBe('WAITING');
  });

  it('reports WAITING when a stale exchange rate leaves the total unusable', () => {
    // A stale or missing rate reaches this function as a null delivered total —
    // the conversion layer refuses to produce a figure it cannot stand behind, so
    // this function never has to know about exchange rates itself.
    expect(
      deriveAlertStatus({
        alertsEnabled: true,
        targetPrice: null,
        currentPrice: 277.53,
        targetDeliveredPrice: 300,
        currentDeliveredPrice: null,
      }),
    ).toBe('WAITING');
  });

  it('treats an undefined delivered total the same as null', () => {
    // The field is optional on the input type, so absent and explicitly-null must
    // not diverge.
    expect(
      deriveAlertStatus({
        alertsEnabled: true,
        targetPrice: null,
        currentPrice: 299,
        targetDeliveredPrice: 300,
      }),
    ).toBe('WAITING');
  });
});
