import { useState, useEffect } from 'react';
import { translations, Language } from './i18n';

const COUNTRIES = [
  {
    code: 'bf',
    name: { fr: 'Burkina Faso', en: 'Burkina Faso' },
    flag: '🇧🇫',
    url: 'https://bf.tnc.trading',
    status: 'active' as const,
  },
  {
    code: 'ml',
    name: { fr: 'Mali', en: 'Mali' },
    flag: '🇲🇱',
    url: '#',
    status: 'coming' as const,
  },
  {
    code: 'ne',
    name: { fr: 'Niger', en: 'Niger' },
    flag: '🇳🇪',
    url: '#',
    status: 'coming' as const,
  },
  {
    code: 'sn',
    name: { fr: 'Senegal', en: 'Senegal' },
    flag: '🇸🇳',
    url: '#',
    status: 'coming' as const,
  },
  {
    code: 'ci',
    name: { fr: "Cote d'Ivoire", en: 'Ivory Coast' },
    flag: '🇨🇮',
    url: '#',
    status: 'coming' as const,
  },
];

function App() {
  const [lang, setLang] = useState<Language>('fr');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const t = translations[lang];

  // Detect browser language on mount
  useEffect(() => {
    const browserLang = navigator.language.split('-')[0];
    if (browserLang === 'en') {
      setLang('en');
    }
  }, []);

  const toggleLanguage = () => {
    setLang(lang === 'fr' ? 'en' : 'fr');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800/50 sticky top-0 bg-slate-950/90 backdrop-blur-md z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-gold-400 to-gold-600 rounded-xl flex items-center justify-center shadow-lg shadow-gold-500/20">
              <span className="text-slate-900 font-bold text-xl sm:text-2xl">T</span>
            </div>
            <div className="hidden sm:block">
              <span className="text-lg sm:text-xl font-bold">TNC Trading</span>
              <p className="text-xs text-slate-400">{t.header.tagline}</p>
            </div>
            <span className="sm:hidden text-lg font-bold">TNC</span>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-6">
            <a href="#countries" className="text-slate-300 hover:text-white transition-colors">
              {t.header.countries}
            </a>
            <a href="#about" className="text-slate-300 hover:text-white transition-colors">
              {t.header.about}
            </a>
            <a href="#contact" className="text-slate-300 hover:text-white transition-colors">
              {t.header.contact}
            </a>
            <button
              onClick={toggleLanguage}
              className="px-3 py-1.5 bg-slate-800 rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors"
            >
              {lang === 'fr' ? 'EN' : 'FR'}
            </button>
          </nav>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-3 md:hidden">
            <button
              onClick={toggleLanguage}
              className="px-3 py-1.5 bg-slate-800 rounded-lg text-sm font-medium"
            >
              {lang === 'fr' ? 'EN' : 'FR'}
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-slate-300"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <nav className="md:hidden border-t border-slate-800 bg-slate-950/95 backdrop-blur-md">
            <div className="container mx-auto px-4 py-4 flex flex-col gap-4">
              <a
                href="#countries"
                className="text-slate-300 hover:text-white py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t.header.countries}
              </a>
              <a
                href="#about"
                className="text-slate-300 hover:text-white py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t.header.about}
              </a>
              <a
                href="#contact"
                className="text-slate-300 hover:text-white py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t.header.contact}
              </a>
            </div>
          </nav>
        )}
      </header>

      {/* Hero */}
      <section className="py-12 sm:py-20 md:py-32">
        <div className="container mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 bg-gold-500/10 text-gold-400 px-3 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-medium mb-4 sm:mb-6">
            <span className="w-2 h-2 bg-gold-400 rounded-full animate-pulse" />
            {t.hero.badge}
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-4 sm:mb-6 leading-tight">
            {t.hero.title1}<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-gold-400 to-gold-600">
              {t.hero.title2}
            </span>
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-8 sm:mb-10 px-4">
            {t.hero.description}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center px-4">
            <a
              href="https://bf.tnc.trading"
              className="px-6 sm:px-8 py-3 sm:py-4 bg-gradient-to-r from-gold-500 to-gold-600 text-slate-900 font-bold rounded-xl hover:from-gold-400 hover:to-gold-500 transition-all shadow-lg shadow-gold-500/25 text-sm sm:text-base"
            >
              {t.hero.ctaPrimary}
            </a>
            <a
              href="#countries"
              className="px-6 sm:px-8 py-3 sm:py-4 bg-slate-800 text-white font-semibold rounded-xl hover:bg-slate-700 transition-colors border border-slate-700 text-sm sm:text-base"
            >
              {t.hero.ctaSecondary}
            </a>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 sm:py-16 border-y border-slate-800/50">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8 text-center">
            <div>
              <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-gold-400">1</p>
              <p className="text-slate-400 text-sm sm:text-base mt-1">{t.stats.activeCountries}</p>
            </div>
            <div>
              <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-gold-400">4</p>
              <p className="text-slate-400 text-sm sm:text-base mt-1">{t.stats.comingCountries}</p>
            </div>
            <div>
              <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-gold-400">100%</p>
              <p className="text-slate-400 text-sm sm:text-base mt-1">{t.stats.guaranteed}</p>
            </div>
            <div>
              <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-gold-400">24K</p>
              <p className="text-slate-400 text-sm sm:text-base mt-1">{t.stats.purity}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Countries */}
      <section id="countries" className="py-16 sm:py-20 scroll-mt-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-8 sm:mb-12">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4">{t.countries.title}</h2>
            <p className="text-slate-400 max-w-xl mx-auto text-sm sm:text-base px-4">
              {t.countries.description}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 max-w-4xl mx-auto">
            {COUNTRIES.map((country) => (
              <a
                key={country.code}
                href={country.url}
                className={`
                  p-4 sm:p-6 rounded-xl sm:rounded-2xl border transition-all
                  ${country.status === 'active'
                    ? 'bg-slate-800/50 border-gold-500/30 hover:border-gold-500 hover:shadow-lg hover:shadow-gold-500/10'
                    : 'bg-slate-900/50 border-slate-800 opacity-60 cursor-not-allowed'
                  }
                `}
                onClick={(e) => country.status === 'coming' && e.preventDefault()}
              >
                <div className="flex items-center gap-3 sm:gap-4">
                  <span className="text-3xl sm:text-4xl">{country.flag}</span>
                  <div>
                    <h3 className="text-base sm:text-lg font-semibold">{country.name[lang]}</h3>
                    {country.status === 'active' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-emerald-400">
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                        {t.countries.available}
                      </span>
                    ) : (
                      <span className="text-xs sm:text-sm text-slate-500">{t.countries.comingSoon}</span>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* About */}
      <section id="about" className="py-16 sm:py-20 bg-slate-900/50 scroll-mt-20">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4 sm:mb-6">{t.about.title}</h2>
            <p className="text-slate-400 text-base sm:text-lg mb-8 px-4">
              {t.about.description}
            </p>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 text-left">
              <div className="p-4 sm:p-6 bg-slate-800/50 rounded-xl">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gold-500/10 rounded-lg flex items-center justify-center mb-3 sm:mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <h3 className="font-semibold mb-2 text-sm sm:text-base">{t.about.secure.title}</h3>
                <p className="text-slate-400 text-xs sm:text-sm">
                  {t.about.secure.description}
                </p>
              </div>
              <div className="p-4 sm:p-6 bg-slate-800/50 rounded-xl">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gold-500/10 rounded-lg flex items-center justify-center mb-3 sm:mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                  </svg>
                </div>
                <h3 className="font-semibold mb-2 text-sm sm:text-base">{t.about.transparent.title}</h3>
                <p className="text-slate-400 text-xs sm:text-sm">
                  {t.about.transparent.description}
                </p>
              </div>
              <div className="p-4 sm:p-6 bg-slate-800/50 rounded-xl sm:col-span-2 md:col-span-1">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gold-500/10 rounded-lg flex items-center justify-center mb-3 sm:mb-4">
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <h3 className="font-semibold mb-2 text-sm sm:text-base">{t.about.accessible.title}</h3>
                <p className="text-slate-400 text-xs sm:text-sm">
                  {t.about.accessible.description}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="py-16 sm:py-20 scroll-mt-20">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4">{t.contact.title}</h2>
          <p className="text-slate-400 mb-6 sm:mb-8 text-sm sm:text-base px-4">
            {t.contact.description}
          </p>
          <a
            href="mailto:contact@tnc.trading"
            className="inline-flex items-center gap-2 px-6 sm:px-8 py-3 sm:py-4 bg-slate-800 text-white font-semibold rounded-xl hover:bg-slate-700 transition-colors border border-slate-700 text-sm sm:text-base"
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            contact@tnc.trading
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-6 sm:py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gold-500 rounded-lg flex items-center justify-center">
                <span className="text-slate-900 font-bold">T</span>
              </div>
              <span className="font-semibold">TNC Trading</span>
            </div>
            <p className="text-slate-500 text-xs sm:text-sm text-center">
              {t.footer.copyright}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
