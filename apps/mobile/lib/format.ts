/**
 * Display formatting.
 *
 * Deliberately not `toLocaleString('fr-FR')`: on React Native the ICU data is
 * not guaranteed to be present (Android ships a trimmed build unless
 * `jsEngine` is configured for it), so the same amount can render with a
 * different separator — or none — from one device to the next. An app that
 * shows money formats it the same way everywhere.
 */

/** Group thousands with a plain space: 33000000 -> "33 000 000". */
export function groupDigits(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatXof(amount: number): string {
  return `${groupDigits(amount)} FCFA`;
}

/** Grams to the milligram — the unit the platform accounts in. */
export function formatGrams(grams: number, precision = 3): string {
  return `${grams.toFixed(precision)} g`;
}
