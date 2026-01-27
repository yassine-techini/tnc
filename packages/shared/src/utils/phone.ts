/**
 * Phone Number Utilities
 * Validation et formatage des numeros de telephone burkinabe
 */

import { PHONE_COUNTRY_CODES, PHONE_REGEX_BF } from '../constants/index.js';

/**
 * Validate a Burkina Faso phone number
 * Accepts formats: +22670123456, 70123456, 0070123456
 */
export function isValidPhoneBF(phone: string): boolean {
  const normalized = normalizePhoneBF(phone);
  return PHONE_REGEX_BF.test(normalized);
}

/**
 * Normalize a phone number to international format (+226XXXXXXXX)
 */
export function normalizePhoneBF(phone: string): string {
  // Remove all non-digit characters except +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // Remove leading zeros after country code
  cleaned = cleaned.replace(/^00/, '');

  // If starts with 226, add +
  if (cleaned.startsWith('226')) {
    cleaned = '+' + cleaned;
  }

  // If starts with just a mobile prefix (5, 6, 7), add country code
  if (/^[567]\d{7}$/.test(cleaned)) {
    cleaned = '+226' + cleaned;
  }

  // If starts with 0 followed by mobile prefix, convert
  if (/^0[567]\d{7}$/.test(cleaned)) {
    cleaned = '+226' + cleaned.substring(1);
  }

  return cleaned;
}

/**
 * Format a phone number for display
 * @example formatPhoneDisplay("+22670123456") => "+226 70 12 34 56"
 */
export function formatPhoneDisplay(phone: string): string {
  const normalized = normalizePhoneBF(phone);

  if (!PHONE_REGEX_BF.test(normalized)) {
    return phone; // Return as-is if invalid
  }

  // Format: +226 XX XX XX XX
  const match = normalized.match(/^\+(\d{3})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (match) {
    return `+${match[1]} ${match[2]} ${match[3]} ${match[4]} ${match[5]}`;
  }

  return phone;
}

/**
 * Mask a phone number for privacy
 * @example maskPhone("+22670123456") => "+226 70 ** ** 56"
 */
export function maskPhone(phone: string): string {
  const normalized = normalizePhoneBF(phone);

  if (!PHONE_REGEX_BF.test(normalized)) {
    return '***';
  }

  // Format: +226 XX ** ** XX
  const match = normalized.match(/^\+(\d{3})(\d{2})\d{4}(\d{2})$/);
  if (match) {
    return `+${match[1]} ${match[2]} ** ** ${match[3]}`;
  }

  return '***';
}

/**
 * Extract operator from phone number
 * Returns: 'orange', 'moov', 'telecel', or 'unknown'
 */
export function getPhoneOperator(phone: string): 'orange' | 'moov' | 'telecel' | 'unknown' {
  const normalized = normalizePhoneBF(phone);

  if (!PHONE_REGEX_BF.test(normalized)) {
    return 'unknown';
  }

  // Get the prefix (first 2 digits after country code)
  const prefix = normalized.substring(4, 6);

  // Orange: 70-79
  if (prefix.startsWith('7')) {
    return 'orange';
  }

  // Moov: 60-69
  if (prefix.startsWith('6')) {
    return 'moov';
  }

  // Telecel: 50-59
  if (prefix.startsWith('5')) {
    return 'telecel';
  }

  return 'unknown';
}

/**
 * Get phone operator name for display
 */
export function getPhoneOperatorName(phone: string): string {
  const operator = getPhoneOperator(phone);

  switch (operator) {
    case 'orange':
      return 'Orange Burkina';
    case 'moov':
      return 'Moov Africa';
    case 'telecel':
      return 'Telecel Faso';
    default:
      return 'Inconnu';
  }
}

/**
 * Check if phone supports mobile money
 */
export function supportsMobileMoney(phone: string): {
  orangeMoney: boolean;
  moovMoney: boolean;
} {
  const operator = getPhoneOperator(phone);

  return {
    orangeMoney: operator === 'orange',
    moovMoney: operator === 'moov',
  };
}

/**
 * Validate phone number and return validation result
 */
export function validatePhone(phone: string): {
  isValid: boolean;
  normalized: string;
  operator: string;
  error?: string;
} {
  if (!phone || phone.trim() === '') {
    return {
      isValid: false,
      normalized: '',
      operator: 'unknown',
      error: 'Le numero de telephone est requis',
    };
  }

  const normalized = normalizePhoneBF(phone);
  const isValid = PHONE_REGEX_BF.test(normalized);

  if (!isValid) {
    return {
      isValid: false,
      normalized,
      operator: 'unknown',
      error: 'Format invalide. Utilisez le format +226 XX XX XX XX',
    };
  }

  return {
    isValid: true,
    normalized,
    operator: getPhoneOperatorName(normalized),
  };
}
