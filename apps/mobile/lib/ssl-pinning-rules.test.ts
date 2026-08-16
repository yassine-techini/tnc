/**
 * The pinning decision, tested for a release build from a dev machine.
 *
 * `checkPin` takes `isDev` and the pins as arguments precisely so the
 * production behaviour — the one that matters — can be exercised without
 * building a release.
 */
import { describe, it, expect } from 'vitest';
import { checkPin, normalizePin, pinningReadiness } from './ssl-pinning-rules';

const PIN_A = 'sha256/jQJTbIh0grw0/1TkHSumWb+Fs0Ggogr621gT3PvPKG0=';
const PIN_B = 'sha256/5VLcahb6x4EvvFrCF2TePj8ZmM2w8h6vXhPvrTbU/qI=';
const OTHER = 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const host = 'bf-api.tnc.trading';

describe('normalizePin', () => {
  it('accepts a hash with or without the algorithm prefix', () => {
    expect(normalizePin('jQJTbIh0grw0/1TkHSumWb+Fs0Ggogr621gT3PvPKG0=')).toBe(PIN_A);
    expect(normalizePin(PIN_A)).toBe(PIN_A);
    expect(normalizePin(`  ${PIN_A}  `)).toBe(PIN_A);
  });
});

describe('checkPin', () => {
  it('trusts a certificate matching any configured pin', () => {
    expect(checkPin({ host, certificateHash: PIN_A, pins: [PIN_A, PIN_B], isDev: false })).toEqual({
      trusted: true,
      reason: 'PIN_MATCH',
    });
    // The backup pin must work, or rotation breaks the app.
    expect(checkPin({ host, certificateHash: PIN_B, pins: [PIN_A, PIN_B], isDev: false }).trusted).toBe(
      true
    );
  });

  it('rejects a certificate that matches nothing', () => {
    expect(checkPin({ host, certificateHash: OTHER, pins: [PIN_A, PIN_B], isDev: false })).toEqual({
      trusted: false,
      reason: 'PIN_MISMATCH',
    });
  });

  it('rejects a pinned host with no pins in a release build', () => {
    // This is the whole point: no pins is a misconfigured build, not an open
    // door. Falling back to the system trust store here would make pinning
    // decorative against a device carrying a rogue CA.
    expect(checkPin({ host, certificateHash: PIN_A, pins: [], isDev: false })).toEqual({
      trusted: false,
      reason: 'NO_PINS_CONFIGURED',
    });
  });

  it('allows an unpinned host only in development', () => {
    expect(checkPin({ host, certificateHash: PIN_A, pins: [], isDev: true })).toEqual({
      trusted: true,
      reason: 'NO_PINS_DEV',
    });
  });

  it('still enforces a mismatch in development', () => {
    // Dev leniency covers a MISSING configuration, never a WRONG certificate.
    expect(checkPin({ host, certificateHash: OTHER, pins: [PIN_A], isDev: true }).trusted).toBe(false);
  });

  it('compares pins written with and without the prefix as equal', () => {
    const bare = PIN_A.slice('sha256/'.length);
    expect(checkPin({ host, certificateHash: bare, pins: [PIN_A], isDev: false }).trusted).toBe(true);
    expect(checkPin({ host, certificateHash: PIN_A, pins: [bare], isDev: false }).trusted).toBe(true);
  });
});

describe('pinningReadiness', () => {
  it('accepts a host with two well-formed pins', () => {
    expect(pinningReadiness({ [host]: [PIN_A, PIN_B] })).toEqual({ ready: true, problems: [] });
  });

  it('refuses an empty configuration', () => {
    const result = pinningReadiness({});
    expect(result.ready).toBe(false);
    expect(result.problems[0]).toContain('Aucun domaine');
  });

  it('refuses a host with no pins', () => {
    const result = pinningReadiness({ [host]: [] });
    expect(result.ready).toBe(false);
    expect(result.problems.join(' ')).toContain('aucune empreinte');
  });

  it('refuses a single pin — rotation would break the app', () => {
    const result = pinningReadiness({ [host]: [PIN_A] });
    expect(result.ready).toBe(false);
    expect(result.problems.join(' ')).toContain('secours');
  });

  it('catches a malformed pin before it becomes a release-day outage', () => {
    const result = pinningReadiness({ [host]: [PIN_A, 'sha256/oops'] });
    expect(result.ready).toBe(false);
    expect(result.problems.join(' ')).toContain('mal formée');
  });

  it('reports every problematic host, not just the first', () => {
    const result = pinningReadiness({ a: [], b: [PIN_A] });
    expect(result.problems).toHaveLength(2);
  });
});
