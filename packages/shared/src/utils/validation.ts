/**
 * Validation Utilities
 * Helpers pour la validation des donnees
 */

import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIRE_UPPERCASE,
  PASSWORD_REQUIRE_LOWERCASE,
  PASSWORD_REQUIRE_NUMBER,
  PASSWORD_REQUIRE_SPECIAL,
  PHONE_REGEX_BF,
} from '../constants/index.js';

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): {
  isValid: boolean;
  score: number;
  errors: string[];
  suggestions: string[];
} {
  const errors: string[] = [];
  const suggestions: string[] = [];
  let score = 0;

  // Check minimum length
  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Minimum ${PASSWORD_MIN_LENGTH} caracteres`);
  } else {
    score += 1;
    if (password.length >= 16) score += 1;
  }

  // Check uppercase
  if (PASSWORD_REQUIRE_UPPERCASE && !/[A-Z]/.test(password)) {
    errors.push('Une majuscule requise');
  } else if (/[A-Z]/.test(password)) {
    score += 1;
  }

  // Check lowercase
  if (PASSWORD_REQUIRE_LOWERCASE && !/[a-z]/.test(password)) {
    errors.push('Une minuscule requise');
  } else if (/[a-z]/.test(password)) {
    score += 1;
  }

  // Check number
  if (PASSWORD_REQUIRE_NUMBER && !/[0-9]/.test(password)) {
    errors.push('Un chiffre requis');
  } else if (/[0-9]/.test(password)) {
    score += 1;
  }

  // Check special character
  if (PASSWORD_REQUIRE_SPECIAL && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Un caractere special requis (!@#$%...)');
  } else if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    score += 1;
  }

  // Suggestions
  if (score < 4 && password.length < 16) {
    suggestions.push('Utilisez un mot de passe plus long');
  }
  if (score < 4 && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    suggestions.push('Ajoutez des caracteres speciaux');
  }

  return {
    isValid: errors.length === 0,
    score: Math.min(score, 5),
    errors,
    suggestions,
  };
}

/**
 * Get password strength label
 */
export function getPasswordStrengthLabel(score: number): {
  label: string;
  color: string;
} {
  if (score <= 1) return { label: 'Tres faible', color: 'text-red-600' };
  if (score === 2) return { label: 'Faible', color: 'text-orange-500' };
  if (score === 3) return { label: 'Moyen', color: 'text-yellow-500' };
  if (score === 4) return { label: 'Fort', color: 'text-green-500' };
  return { label: 'Tres fort', color: 'text-green-600' };
}

/**
 * Validate date of birth (must be 18+)
 */
export function validateDateOfBirth(dob: string | Date): {
  isValid: boolean;
  age: number;
  error?: string;
} {
  const date = typeof dob === 'string' ? new Date(dob) : dob;

  if (isNaN(date.getTime())) {
    return { isValid: false, age: 0, error: 'Date invalide' };
  }

  if (date > new Date()) {
    return { isValid: false, age: 0, error: 'La date ne peut pas etre dans le futur' };
  }

  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) {
    age--;
  }

  if (age < 18) {
    return { isValid: false, age, error: 'Vous devez avoir au moins 18 ans' };
  }

  if (age > 120) {
    return { isValid: false, age, error: 'Date de naissance invalide' };
  }

  return { isValid: true, age };
}

/**
 * Validate amount
 */
export function validateAmount(
  amount: number | string,
  options: {
    min?: number;
    max?: number;
    allowDecimals?: boolean;
    maxDecimals?: number;
  } = {}
): {
  isValid: boolean;
  value: number;
  error?: string;
} {
  const { min = 0, max = Infinity, allowDecimals = true, maxDecimals = 3 } = options;

  const value = typeof amount === 'string' ? parseFloat(amount) : amount;

  if (isNaN(value)) {
    return { isValid: false, value: 0, error: 'Montant invalide' };
  }

  if (value < min) {
    return { isValid: false, value, error: `Montant minimum: ${min}` };
  }

  if (value > max) {
    return { isValid: false, value, error: `Montant maximum: ${max}` };
  }

  if (!allowDecimals && !Number.isInteger(value)) {
    return { isValid: false, value, error: 'Les decimales ne sont pas autorisees' };
  }

  // Check decimal places
  const decimalPart = value.toString().split('.')[1];
  if (decimalPart && decimalPart.length > maxDecimals) {
    return { isValid: false, value, error: `Maximum ${maxDecimals} decimales` };
  }

  return { isValid: true, value };
}

/**
 * Sanitize string input (remove dangerous characters)
 */
export function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, ''); // Remove event handlers
}

/**
 * Validate and sanitize name
 */
export function validateName(name: string): {
  isValid: boolean;
  sanitized: string;
  error?: string;
} {
  const sanitized = sanitizeString(name);

  if (sanitized.length < 2) {
    return { isValid: false, sanitized, error: 'Minimum 2 caracteres' };
  }

  if (sanitized.length > 50) {
    return { isValid: false, sanitized, error: 'Maximum 50 caracteres' };
  }

  // Only allow letters, spaces, hyphens, and apostrophes
  if (!/^[a-zA-ZÀ-ÿ\s'-]+$/.test(sanitized)) {
    return { isValid: false, sanitized, error: 'Caracteres invalides' };
  }

  return { isValid: true, sanitized };
}

/**
 * Validate TOTP code format
 */
export function validateTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/**
 * Validate verification code format
 */
export function validateVerificationCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/**
 * Check if value is empty (null, undefined, empty string, empty array)
 */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * Mask sensitive data for logging
 */
export function maskSensitiveData(data: string, visibleChars: number = 4): string {
  if (data.length <= visibleChars * 2) {
    return '*'.repeat(data.length);
  }

  const start = data.substring(0, visibleChars);
  const end = data.substring(data.length - visibleChars);
  const middle = '*'.repeat(Math.min(data.length - visibleChars * 2, 8));

  return `${start}${middle}${end}`;
}
