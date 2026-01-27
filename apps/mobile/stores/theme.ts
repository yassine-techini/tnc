import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance, ColorSchemeName } from 'react-native';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeState {
  mode: ThemeMode;
  effectiveTheme: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
  _syncSystem: () => void;
}

function resolveEffective(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
  }
  return mode;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'dark',
      effectiveTheme: 'dark',
      setMode: (mode: ThemeMode) => {
        set({ mode, effectiveTheme: resolveEffective(mode) });
      },
      toggle: () => {
        const current = get().mode;
        const next = current === 'dark' ? 'light' : 'dark';
        set({ mode: next, effectiveTheme: next });
      },
      _syncSystem: () => {
        const { mode } = get();
        if (mode === 'system') {
          set({ effectiveTheme: resolveEffective('system') });
        }
      },
    }),
    {
      name: 'tnc-mobile-theme',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

// Colors for each theme
export const colors = {
  dark: {
    background: '#0F0F1A',
    surface: '#1A1A2E',
    surfaceElevated: '#252540',
    text: '#FFFFFF',
    textSecondary: '#9CA3AF',
    textTertiary: '#6B7280',
    border: '#2A2A45',
    gold: '#D4AF37',
    goldDark: '#B8962F',
    accent: '#D4AF37',
    error: '#EF4444',
    success: '#10B981',
    warning: '#F59E0B',
  },
  light: {
    background: '#F8FAFC',
    surface: '#FFFFFF',
    surfaceElevated: '#F1F5F9',
    text: '#0F172A',
    textSecondary: '#475569',
    textTertiary: '#94A3B8',
    border: '#E2E8F0',
    gold: '#B8962F',
    goldDark: '#9A7B24',
    accent: '#B8962F',
    error: '#DC2626',
    success: '#059669',
    warning: '#D97706',
  },
};

/**
 * Hook to get the current theme colors.
 */
export function useThemeColors() {
  const effectiveTheme = useThemeStore((s) => s.effectiveTheme);
  return colors[effectiveTheme];
}
