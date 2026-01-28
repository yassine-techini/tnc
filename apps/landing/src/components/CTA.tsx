import { LINKS, getMobileStoreLink, isMobile } from '../config';
import { useI18n } from '../i18n';

export default function CTA() {
  const mobile = isMobile();
  const storeInfo = getMobileStoreLink();
  const { t } = useI18n();

  return (
    <section className="py-20 md:py-28 relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-800 to-transparent" />
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="p-8 sm:p-12 rounded-3xl bg-gradient-to-b from-gold-500/10 via-slate-900/80 to-slate-900/80 border border-gold-500/20">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-white">
            {t.cta.title} <span className="text-gradient-gold">{t.cta.titleHighlight}</span>{t.cta.titleEnd}
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto mb-8">
            {t.cta.subtitle}
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            {mobile ? (
              <>
                <a
                  href={storeInfo.url}
                  className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-gold-500 to-gold-600 text-slate-950 rounded-2xl font-bold text-lg shadow-xl shadow-gold-500/25 hover:shadow-gold-500/40 transition-all hover:scale-[1.02]"
                >
                  {storeInfo.store === 'ios' ? t.cta.ctaAppStore : t.cta.ctaPlayStore}
                </a>
                <a
                  href={LINKS.platform}
                  className="text-sm text-slate-400 hover:text-gold-400 transition-colors"
                >
                  {t.cta.ctaBrowser}
                </a>
              </>
            ) : (
              <a
                href={LINKS.platform}
                className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-gold-500 to-gold-600 text-slate-950 rounded-2xl font-bold text-lg shadow-xl shadow-gold-500/25 hover:shadow-gold-500/40 transition-all hover:scale-[1.02]"
              >
                {t.cta.ctaPlatform}
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            )}
          </div>

          {/* Trust badges */}
          <div className="flex items-center justify-center gap-6 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4 text-gold-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {t.cta.noFees}
            </span>
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4 text-gold-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {t.cta.noEngagement}
            </span>
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4 text-gold-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {t.cta.secure}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
