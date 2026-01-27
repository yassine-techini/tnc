/**
 * Shared theme utilities for web apps.
 * Uses localStorage + class on <html> element for Tailwind `darkMode: 'class'`.
 */

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'tnc-theme';

export function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  return (localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'dark';
}

export function setStoredTheme(theme: ThemeMode): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, theme);
}

export function getEffectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

export function applyTheme(mode: ThemeMode): void {
  const effective = getEffectiveTheme(mode);
  const root = document.documentElement;
  if (effective === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

/**
 * Initialize theme on page load. Call this in your entry point or layout.
 * Returns a cleanup function for the system theme media query listener.
 */
export function initTheme(): () => void {
  const mode = getStoredTheme();
  applyTheme(mode);

  // Listen for system theme changes if in 'system' mode
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (getStoredTheme() === 'system') {
      applyTheme('system');
    }
  };
  mql.addEventListener('change', handler);
  return () => mql.removeEventListener('change', handler);
}
