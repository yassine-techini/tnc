import { createContext, useContext } from 'react';
import { fr } from './fr';
import { en } from './en';

export type Locale = 'fr' | 'en';
export type Translations = typeof fr;

const translations: Record<Locale, Translations> = { fr, en };

export function getTranslations(locale: Locale): Translations {
  return translations[locale];
}

export function getStoredLocale(): Locale {
  if (typeof localStorage === 'undefined') return 'fr';
  const stored = localStorage.getItem('tnc-lang');
  if (stored === 'en' || stored === 'fr') return stored;
  // Detect browser language
  const browserLang = navigator.language?.slice(0, 2);
  return browserLang === 'en' ? 'en' : 'fr';
}

export function storeLocale(locale: Locale) {
  localStorage.setItem('tnc-lang', locale);
}

export interface I18nContextType {
  locale: Locale;
  t: Translations;
  setLocale: (locale: Locale) => void;
}

export const I18nContext = createContext<I18nContextType>({
  locale: 'fr',
  t: fr,
  setLocale: () => {},
});

export function useI18n() {
  return useContext(I18nContext);
}
