export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'tnc-theme';

export function getStoredTheme(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'dark';
  return (localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'dark';
}

export function setStoredTheme(theme: ThemeMode): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, theme);
}

export function getEffectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const effective = getEffectiveTheme(mode);
  const el = document.documentElement;
  if (effective === 'dark') {
    el.classList.add('dark');
  } else {
    el.classList.remove('dark');
  }
}

export function initTheme(): () => void {
  const stored = getStoredTheme();
  applyTheme(stored);

  if (typeof window === 'undefined') return () => {};

  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    const current = getStoredTheme();
    if (current === 'system') {
      applyTheme('system');
    }
  };
  mql.addEventListener('change', handler);
  return () => mql.removeEventListener('change', handler);
}
