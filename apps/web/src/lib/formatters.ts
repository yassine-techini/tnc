import { parseApiDate } from '@tnc-trading/shared';

/**
 * Formatting utilities for TNC Trading Web App
 */

/**
 * Format currency amount
 * @param amount - Amount to format
 * @param currency - Currency code (XOF or USD)
 * @param showSymbol - Whether to show currency symbol
 */
export function formatCurrency(
  amount: number,
  currency: 'XOF' | 'USD' = 'XOF',
  showSymbol = true
): string {
  const formatter = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  });

  const formatted = formatter.format(amount);

  if (!showSymbol) return formatted;

  return currency === 'XOF' ? `${formatted} FCFA` : `$${formatted}`;
}

/**
 * Format gold amount in grams
 * @param grams - Amount in grams
 * @param precision - Decimal precision (default 3)
 */
export function formatGrams(grams: number, precision = 3): string {
  return `${grams.toFixed(precision)} g`;
}

/**
 * Format date in French locale
 * @param date - Date string or Date object
 * @param format - Output format
 */
export function formatDate(
  date: string | Date,
  format: 'short' | 'long' | 'relative' | 'datetime' = 'short'
): string {
  /**
   * `new Date(date)` lisait les horodatages sans fuseau de SQLite comme des
   * heures LOCALES : sur un navigateur a UTC+2, un evenement vieux de 30 minutes
   * s'affichait « il y a 2 h 30 » — y compris sur l'ecran des sessions actives,
   * la ou un titulaire repere une intrusion (constat AF).
   *
   * Un utilisateur a Ouagadougou voyait l'heure juste, ce qui explique la
   * survie du defaut. La plateforme n'est pas dediee a un pays (ADR 017).
   *
   * `parseApiDate` est la fonction PARTAGEE, corrigee une fois pour toutes ;
   * ce fichier en portait une copie fautive.
   */
  const d = parseApiDate(date);

  switch (format) {
    case 'short':
      return d.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });

    case 'long':
      return d.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });

    case 'datetime':
      return d.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

    case 'relative':
      return formatRelativeTime(d);

    default:
      return d.toLocaleDateString('fr-FR');
  }
}

/**
 * Format relative time (e.g., "il y a 5 minutes")
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return 'A l\'instant';
  }
  if (minutes < 60) {
    return `Il y a ${minutes} minute${minutes > 1 ? 's' : ''}`;
  }
  if (hours < 24) {
    return `Il y a ${hours} heure${hours > 1 ? 's' : ''}`;
  }
  if (days < 7) {
    return `Il y a ${days} jour${days > 1 ? 's' : ''}`;
  }

  return formatDate(date, 'short');
}

/**
 * Format time only
 */
export function formatTime(date: string | Date): string {
  const d = parseApiDate(date);
  return d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Truncate transaction/certificate ID
 * @param id - Full ID string
 * @param length - Characters to show (default 8)
 */
export function truncateId(id: string, length = 8): string {
  if (id.length <= length) return id;
  return id.slice(0, length).toUpperCase();
}

/**
 * Format phone number with spacing
 * @param phone - Phone number (with or without country code)
 */
export function formatPhone(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');

  // Handle Burkina Faso numbers
  if (digits.startsWith('226') || digits.length === 8) {
    const local = digits.startsWith('226') ? digits.slice(3) : digits;
    return `+226 ${local.slice(0, 2)} ${local.slice(2, 4)} ${local.slice(4, 6)} ${local.slice(6)}`;
  }

  // Return as-is if not recognized
  return phone;
}

/**
 * Mask phone number for display
 * @param phone - Phone number
 */
export function maskPhone(phone: string): string {
  const formatted = formatPhone(phone);
  const parts = formatted.split(' ');
  if (parts.length >= 5) {
    return `${parts[0]} ${parts[1]} ** ** ${parts[4]}`;
  }
  return formatted.replace(/\d(?=\d{2})/g, '*');
}

/**
 * Format percentage
 */
export function formatPercent(value: number, precision = 2): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(precision)}%`;
}

/**
 * Format large numbers with K/M suffix
 */
export function formatCompact(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toString();
}

/**
 * Format file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format countdown timer
 */
export function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
