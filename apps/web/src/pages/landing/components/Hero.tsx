import { Link } from 'react-router-dom';
import { getMobileStoreLink, isMobile } from '../config';
import { useI18n } from '../i18n';

export default function Hero() {
  const mobile = isMobile();
  const storeInfo = getMobileStoreLink();
  const { t } = useI18n();

  return (
    <section className="relative pt-32 pb-20 md:pt-44 md:pb-32 overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-gold-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold-500/20 to-transparent" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gold-500/10 border border-gold-500/20 mb-8 animate-fade-in">
          <span className="w-2 h-2 rounded-full bg-gold-500 animate-pulse" />
          <span className="text-sm text-gold-400 font-medium">{t.hero.badge}</span>
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight mb-6 animate-fade-in">
          {t.hero.title1}{' '}
          <span className="text-gradient-gold">{t.hero.titleGold}</span>
          <br className="hidden sm:block" />
          {' '}{t.hero.title2}
        </h1>

        {/* Subtitle */}
        <p className="text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto mb-10 animate-fade-in-delay">
          {t.hero.subtitle}
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in-delay-2">
          {mobile ? (
            <>
              {storeInfo.store === 'ios' ? (
                <a
                  href={storeInfo.url}
                  className="inline-flex items-center gap-3 px-7 py-4 bg-gradient-to-r from-gold-500 to-gold-600 text-slate-950 rounded-2xl font-bold text-lg shadow-xl shadow-gold-500/25 hover:shadow-gold-500/40 transition-all hover:scale-[1.02]"
                >
                  <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                  {t.hero.ctaAppStore}
                </a>
              ) : (
                <a
                  href={storeInfo.url}
                  className="inline-flex items-center gap-3 px-7 py-4 bg-gradient-to-r from-gold-500 to-gold-600 text-slate-950 rounded-2xl font-bold text-lg shadow-xl shadow-gold-500/25 hover:shadow-gold-500/40 transition-all hover:scale-[1.02]"
                >
                  <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor"><path d="M3.18 23.78L14.11 12.84 3.18.22c-.27.13-.18.83-.18 1.08v21.48c0 .25-.09.87.18 1zm1.65 1.22l12.26-6.87-2.72-2.73-9.54 9.6zm14.27-8l-2.6-1.44L13.77 12.84l2.73-2.73 2.6-1.46c.92-.5.92-1.32 0-1.82l-2.6-1.46L13.77 8.1l2.73 2.73 2.6 1.46c.92.5.92 1.32 0 1.82l-2.6 1.46zm-14.27-16L7.55 3.72l2.72-2.73L3.18 1.22z"/></svg>
                  {t.hero.ctaPlayStore}
                </a>
              )}
              <Link
                to="/login"
                className="px-6 py-3 text-sm font-medium text-slate-300 border border-slate-700 rounded-xl hover:border-gold-500/50 hover:text-gold-400 transition-all"
              >
                {t.hero.ctaBrowser}
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/register"
                className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-gold-500 to-gold-600 text-slate-950 rounded-2xl font-bold text-lg shadow-xl shadow-gold-500/25 hover:shadow-gold-500/40 transition-all hover:scale-[1.02]"
              >
                {t.hero.ctaPlatform}
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
              <a
                href="#comment-ca-marche"
                className="px-8 py-4 text-sm font-semibold text-slate-300 border-2 border-slate-700 rounded-2xl hover:border-gold-500/50 hover:text-gold-400 transition-all"
              >
                {t.hero.ctaHow}
              </a>
            </>
          )}
        </div>

        {/* Key stats */}
        <div className="grid grid-cols-3 gap-8 max-w-lg mx-auto mt-16 animate-fade-in-delay-2">
          <div>
            <div className="text-2xl sm:text-3xl font-bold text-gold-500">{t.hero.stat1}</div>
            <div className="text-xs text-slate-500 mt-1">{t.hero.stat1Label}</div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-bold text-gold-500">{t.hero.stat2}</div>
            <div className="text-xs text-slate-500 mt-1">{t.hero.stat2Label}</div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-bold text-gold-500">{t.hero.stat3}</div>
            <div className="text-xs text-slate-500 mt-1">{t.hero.stat3Label}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
