/**
 * The release guard itself.
 *
 * It also checks the REAL app.json, so the pins that ship are verified by the
 * test suite and not only by remembering to run the script.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDomains } from './check-ssl-pins.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PIN_A = 'sha256/jQJTbIh0grw0/1TkHSumWb+Fs0Ggogr621gT3PvPKG0=';
const PIN_B = 'sha256/5VLcahb6x4EvvFrCF2TePj8ZmM2w8h6vXhPvrTbU/qI=';

describe('checkDomains', () => {
  it('passes a host with two distinct, well-formed pins', () => {
    expect(checkDomains({ 'api.example': [PIN_A, PIN_B] })).toMatchObject({
      ready: true,
      problems: [],
    });
  });

  it('fails an empty configuration', () => {
    expect(checkDomains({}).ready).toBe(false);
    expect(checkDomains(undefined).ready).toBe(false);
  });

  it('fails a host with no pins — the release would refuse every request', () => {
    const result = checkDomains({ 'api.example': [] });
    expect(result.ready).toBe(false);
    expect(result.problems.join(' ')).toContain('no pins');
  });

  it('fails a single pin, and says why', () => {
    const result = checkDomains({ 'api.example': [PIN_A] });
    expect(result.ready).toBe(false);
    expect(result.problems.join(' ')).toContain('backup pin');
  });

  it('fails a duplicated pin — repeating one is not a backup', () => {
    const result = checkDomains({ 'api.example': [PIN_A, PIN_A] });
    expect(result.ready).toBe(false);
    expect(result.problems.join(' ')).toContain('duplicate');
  });

  it('fails a malformed pin', () => {
    expect(checkDomains({ 'api.example': [PIN_A, 'sha256/nope'] }).ready).toBe(false);
    expect(checkDomains({ 'api.example': [PIN_A, ''] }).ready).toBe(false);
  });

  it('accepts a pin written without the sha256/ prefix', () => {
    const bare = PIN_A.slice('sha256/'.length);
    expect(checkDomains({ 'api.example': [bare, PIN_B] }).ready).toBe(true);
  });
});

describe('the pins that actually ship', () => {
  const config = JSON.parse(readFileSync(path.join(here, '..', 'app.json'), 'utf8'));
  const domains = config?.expo?.extra?.sslPinning?.domains;

  it('are declared once, in expo.extra.sslPinning', () => {
    // The plugin and lib/ssl-pinning.ts both read this. They used to be
    // declared separately and had already drifted.
    expect(domains).toBeDefined();
    expect(Object.keys(domains).length).toBeGreaterThan(0);
  });

  it('pin the production API host', () => {
    expect(Object.keys(domains)).toContain('bf-api.tnc.trading');
  });

  it('would pass the release guard', () => {
    const result = checkDomains(domains);
    expect(result.problems).toEqual([]);
    expect(result.ready).toBe(true);
  });
});
