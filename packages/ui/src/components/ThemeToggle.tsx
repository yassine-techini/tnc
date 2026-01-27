import { useState, useEffect, useCallback } from 'react';
import {
  type ThemeMode,
  getStoredTheme,
  setStoredTheme,
  applyTheme,
  initTheme,
} from '@tnc-trading/shared/utils/theme';

/**
 * Hook for theme management. Returns current mode and a setter.
 */
export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => getStoredTheme());

  useEffect(() => {
    const cleanup = initTheme();
    return cleanup;
  }, []);

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    setStoredTheme(newMode);
    applyTheme(newMode);
  }, []);

  const toggle = useCallback(() => {
    const current = getStoredTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    setMode(next);
  }, [setMode]);

  return { mode, setMode, toggle };
}

/**
 * Simple sun/moon toggle button for dark/light mode.
 * className can be passed for additional styling.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { mode, toggle } = useTheme();

  const isDark = mode === 'dark' || (mode === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <button
      onClick={toggle}
      className={`p-2 rounded-xl transition-all duration-200 hover:bg-slate-200 dark:hover:bg-slate-800 ${className}`}
      title={isDark ? 'Mode clair' : 'Mode sombre'}
      aria-label={isDark ? 'Passer en mode clair' : 'Passer en mode sombre'}
    >
      {isDark ? (
        // Sun icon
        <svg className="w-5 h-5 text-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      ) : (
        // Moon icon
        <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      )}
    </button>
  );
}
