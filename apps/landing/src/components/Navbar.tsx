import { useState } from 'react';
import { LINKS } from '../config';
import { useI18n, type Locale } from '../i18n';

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { locale, t, setLocale } = useI18n();

  const toggleLang = () => setLocale(locale === 'fr' ? 'en' : 'fr');
  const otherLang: Locale = locale === 'fr' ? 'en' : 'fr';

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <a href="#" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center">
              <span className="text-slate-950 font-bold text-sm">T</span>
            </div>
            <span className="text-lg font-bold text-white">
              TNC <span className="text-gold-500">Trading</span>
            </span>
          </a>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            <a href="#offres" className="text-sm text-slate-300 hover:text-gold-500 transition-colors">{t.nav.offers}</a>
            <a href="#comment-ca-marche" className="text-sm text-slate-300 hover:text-gold-500 transition-colors">{t.nav.howItWorks}</a>
            <a href="#securite" className="text-sm text-slate-300 hover:text-gold-500 transition-colors">{t.nav.security}</a>
            <a href="#faq" className="text-sm text-slate-300 hover:text-gold-500 transition-colors">{t.nav.faq}</a>
          </div>

          {/* CTA + Lang */}
          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={toggleLang}
              className="px-3 py-1.5 text-xs font-semibold text-slate-400 border border-slate-700 rounded-lg hover:text-gold-400 hover:border-gold-500/50 transition-all uppercase"
            >
              {otherLang}
            </button>
            <a
              href={LINKS.platform}
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
            >
              {t.nav.login}
            </a>
            <a
              href={LINKS.platform}
              className="px-5 py-2.5 text-sm font-semibold bg-gradient-to-r from-gold-500 to-gold-600 text-slate-950 rounded-xl hover:from-gold-400 hover:to-gold-500 transition-all shadow-lg shadow-gold-500/20"
            >
              {t.nav.createAccount}
            </a>
          </div>

          {/* Mobile: lang + hamburger */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={toggleLang}
              className="px-2.5 py-1 text-xs font-semibold text-slate-400 border border-slate-700 rounded-lg uppercase"
            >
              {otherLang}
            </button>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 text-slate-400 hover:text-white"
              aria-label="Menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {menuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-slate-800/50 py-4 space-y-3">
            <a href="#offres" onClick={() => setMenuOpen(false)} className="block text-sm text-slate-300 hover:text-gold-500 py-2">{t.nav.offers}</a>
            <a href="#comment-ca-marche" onClick={() => setMenuOpen(false)} className="block text-sm text-slate-300 hover:text-gold-500 py-2">{t.nav.howItWorks}</a>
            <a href="#securite" onClick={() => setMenuOpen(false)} className="block text-sm text-slate-300 hover:text-gold-500 py-2">{t.nav.security}</a>
            <a href="#faq" onClick={() => setMenuOpen(false)} className="block text-sm text-slate-300 hover:text-gold-500 py-2">{t.nav.faq}</a>
            <div className="pt-3 border-t border-slate-800/50 space-y-2">
              <a href={LINKS.platform} className="block text-center px-4 py-2.5 text-sm font-semibold bg-gradient-to-r from-gold-500 to-gold-600 text-slate-950 rounded-xl">
                {t.nav.accessPlatform}
              </a>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
