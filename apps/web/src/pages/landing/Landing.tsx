import { useState } from 'react';
import { I18nContext, getStoredLocale, getTranslations, storeLocale, type Locale } from './i18n';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import Features from './components/Features';
import HowItWorks from './components/HowItWorks';
import Offers from './components/Offers';
import Security from './components/Security';
import FAQ from './components/FAQ';
import CTA from './components/CTA';
import Footer from './components/Footer';

export default function Landing() {
  const [locale, setLocaleState] = useState<Locale>(getStoredLocale);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    storeLocale(l);
    document.documentElement.lang = l;
  };

  const t = getTranslations(locale);

  return (
    <I18nContext.Provider value={{ locale, t, setLocale }}>
      <div className="min-h-screen bg-slate-950">
        <Navbar />
        <Hero />
        <Features />
        <HowItWorks />
        <Offers />
        <Security />
        <FAQ />
        <CTA />
        <Footer />
      </div>
    </I18nContext.Provider>
  );
}
