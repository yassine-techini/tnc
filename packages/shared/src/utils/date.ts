/**
 * Date Formatting Utilities
 * Formatage des dates avec timezone Burkina Faso
 */

import { TIMEZONE } from '../constants/index.js';

/**
 * Get current date/time in Burkina Faso timezone
 */
export function nowInBurkinaFaso(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
}

/**
 * Format a date as DD/MM/YYYY
 * @example formatDate(new Date()) => "26/01/2026"
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
}

/**
 * Format a date as DD/MM/YYYY HH:mm
 * @example formatDateTime(new Date()) => "26/01/2026 14:30"
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');

  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/**
 * Format a date as HH:mm
 * @example formatTime(new Date()) => "14:30"
 */
export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');

  return `${hours}:${minutes}`;
}

/**
 * Format a date as relative time (e.g., "il y a 5 minutes")
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return "A l'instant";
  }

  if (diffMinutes < 60) {
    return diffMinutes === 1 ? 'Il y a 1 minute' : `Il y a ${diffMinutes} minutes`;
  }

  if (diffHours < 24) {
    return diffHours === 1 ? 'Il y a 1 heure' : `Il y a ${diffHours} heures`;
  }

  if (diffDays < 7) {
    return diffDays === 1 ? 'Hier' : `Il y a ${diffDays} jours`;
  }

  // More than a week, show the date
  return formatDate(d);
}

/**
 * Format a date as a month name in French
 * @example formatMonth(new Date()) => "janvier 2026"
 */
export function formatMonth(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  const months = [
    'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'
  ];

  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Format a date as a full date in French
 * @example formatFullDate(new Date()) => "26 janvier 2026"
 */
export function formatFullDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  const months = [
    'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'
  ];

  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Check if a date is today
 */
export function isToday(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  const today = new Date();

  return d.getDate() === today.getDate() &&
         d.getMonth() === today.getMonth() &&
         d.getFullYear() === today.getFullYear();
}

/**
 * Check if a date is in the past
 */
export function isPast(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.getTime() < Date.now();
}

/**
 * Check if a date is in the future
 */
export function isFuture(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.getTime() > Date.now();
}

/**
 * Get days until a date
 */
export function daysUntil(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = d.getTime() - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Get days since a date
 */
export function daysSince(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Add days to a date
 */
export function addDays(date: Date | string, days: number): Date {
  const d = typeof date === 'string' ? new Date(date) : new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Format a countdown timer (for quote expiration)
 * @example formatCountdown(45) => "00:45"
 */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return '00:00';

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parse a French date string (DD/MM/YYYY) to Date
 */
export function parseFrenchDate(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;

  const [, day, month, year] = match;
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));

  // Validate the date is valid
  if (isNaN(date.getTime())) return null;

  return date;
}

/**
 * Get start and end of day
 */
export function getDayBounds(date: Date | string = new Date()): { start: Date; end: Date } {
  const d = typeof date === 'string' ? new Date(date) : new Date(date);

  const start = new Date(d);
  start.setHours(0, 0, 0, 0);

  const end = new Date(d);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

/**
 * Get start and end of month
 */
export function getMonthBounds(date: Date | string = new Date()): { start: Date; end: Date } {
  const d = typeof date === 'string' ? new Date(date) : new Date(date);

  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

  return { start, end };
}
