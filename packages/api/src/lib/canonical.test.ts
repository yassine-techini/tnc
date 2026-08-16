import { describe, it, expect } from 'vitest';
import { canonicalJson, grams, sha256Hex } from './canonical';

describe('canonicalJson', () => {
  it('is independent of key insertion order', () => {
    const a = canonicalJson({ b: 1, a: 'x', c: true });
    const b = canonicalJson({ c: true, a: 'x', b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":"x","b":1,"c":true}');
  });

  it('sorts nested keys too', () => {
    expect(canonicalJson({ z: { d: 1, a: 2 }, a: [{ y: 1, x: 2 }] })).toBe(
      '{"a":[{"x":2,"y":1}],"z":{"a":2,"d":1}}'
    );
  });

  it('preserves array order, which carries meaning', () => {
    expect(canonicalJson(['b', 'a'])).toBe('["b","a"]');
    expect(canonicalJson(['b', 'a'])).not.toBe(canonicalJson(['a', 'b']));
  });

  it('treats an absent key and an undefined value as the same document', () => {
    const withUndefined = canonicalJson({ a: 1, b: undefined as never });
    expect(withUndefined).toBe(canonicalJson({ a: 1 }));
  });

  it('refuses values whose rendering is not stable', () => {
    // Decimals must travel as fixed-precision strings via grams().
    expect(() => canonicalJson(0.1 + 0.2)).toThrow(/non-integer/);
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
  });

  it('escapes strings so a value cannot forge structure', () => {
    const forged = canonicalJson({ a: '","b":"injected' });
    expect(forged).toBe('{"a":"\\",\\"b\\":\\"injected"}');
    expect(JSON.parse(forged)).toEqual({ a: '","b":"injected' });
  });
});

describe('grams', () => {
  it('renders a stable 3-decimal string', () => {
    expect(grams(900)).toBe('900.000');
    expect(grams(0.1 + 0.2)).toBe('0.300');
    expect(grams(910.0006)).toBe('910.001');
    expect(grams(910.0004)).toBe('910.000');
  });

  it('truncates below token precision rather than inventing it', () => {
    // Sub-milligram differences are not representable as tokens and must not
    // change the digest. toFixed is fully specified by ECMAScript, so this
    // rounding is identical on any runtime recomputing the attestation.
    expect(grams(900.00001)).toBe(grams(900));
  });

  it('makes float drift invisible to the digest', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point, but the attestation must not
    // change digest because of it.
    expect(grams(0.1 + 0.2)).toBe(grams(0.3));
  });
});

describe('sha256Hex', () => {
  it('matches the known digest of the empty string', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('changes when a single gram changes', async () => {
    const a = await sha256Hex(canonicalJson({ allocated: grams(10000) }));
    const b = await sha256Hex(canonicalJson({ allocated: grams(10000.001) }));
    expect(a).not.toBe(b);
  });
});
