/**
 * Canonical serialization for reserve attestations.
 *
 * An attestation is only useful if a third party can recompute its digest and
 * get the same bytes we did — years later, on another runtime. Two things break
 * that: object key order, and floating-point formatting (`900` vs `900.0` vs
 * `900.0000000001`). Key order is fixed here by sorting; float formatting is
 * avoided entirely by carrying every gram quantity as a fixed-precision STRING
 * in the payload (see `grams()`), so JSON never has to render a float.
 */

/** Values a canonical payload may contain. Deliberately narrow. */
export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

/**
 * Deterministic JSON: object keys sorted, array order preserved (it carries
 * meaning), no whitespace. Rejects anything whose rendering is not stable.
 */
export function canonicalJson(value: CanonicalValue): string {
  if (value === null) return 'null';

  const t = typeof value;

  if (t === 'string') return JSON.stringify(value);
  if (t === 'boolean') return value ? 'true' : 'false';

  if (t === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new Error('canonicalJson: non-finite number');
    }
    // Only integers are allowed as raw numbers — decimals must go through
    // grams() and travel as strings, so no float formatting is ever involved.
    if (!Number.isInteger(n)) {
      throw new Error('canonicalJson: non-integer number, use grams() instead');
    }
    return String(n);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  if (t === 'object') {
    const obj = value as { [key: string]: CanonicalValue };
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue; // absent and undefined must not differ
      parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
    }
    return `{${parts.join(',')}}`;
  }

  throw new Error(`canonicalJson: unsupported type ${t}`);
}

/** Gram quantity as a fixed 3-decimal string — the precision of a token. */
export function grams(value: number): string {
  if (!Number.isFinite(value)) throw new Error('grams: non-finite value');
  return value.toFixed(3);
}

/** Lowercase hex SHA-256 of a UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
