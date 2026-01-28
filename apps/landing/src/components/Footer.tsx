import { LINKS } from '../config';
import { useI18n } from '../i18n';

export default function Footer() {
  const { t } = useI18n();

  return (
    <footer className="border-t border-slate-800/50 bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center">
                <span className="text-slate-950 font-bold text-sm">T</span>
              </div>
              <span className="text-lg font-bold text-white">
                TNC <span className="text-gold-500">Trading</span>
              </span>
            </div>
            <p className="text-sm text-slate-500 leading-relaxed max-w-xs">
              {t.footer.description}
            </p>
          </div>

          {/* Platform */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4">{t.footer.platform}</h4>
            <ul className="space-y-2.5">
              <li>
                <a href={LINKS.platform} className="text-sm text-slate-400 hover:text-gold-400 transition-colors">
                  {t.footer.accessPlatform}
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-slate-400 hover:text-gold-400 transition-colors">
                  {t.footer.downloadMobile}
                </a>
              </li>
              <li>
                <a href={LINKS.platform} className="text-sm text-slate-400 hover:text-gold-400 transition-colors">
                  {t.footer.currentPrice}
                </a>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4">{t.footer.resources}</h4>
            <ul className="space-y-2.5">
              <li>
                <a href="#comment-ca-marche" className="text-sm text-slate-400 hover:text-gold-400 transition-colors">
                  {t.footer.howItWorks}
                </a>
              </li>
              <li>
                <a href="#offres" className="text-sm text-slate-400 hover:text-gold-400 transition-colors">
                  {t.footer.ourOffers}
                </a>
              </li>
              <li>
                <a href="#faq" className="text-sm text-slate-400 hover:text-gold-400 transition-colors">
                  {t.footer.frequentQuestions}
                </a>
              </li>
              <li>
                <a href="#securite" className="text-sm text-slate-400 hover:text-gold-400 transition-colors">
                  {t.footer.securityTitle}
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4">{t.footer.legal}</h4>
            <ul className="space-y-2.5">
              <li>
                <a href="#" className="text-sm text-slate-400 hover:text-gold-400 transition-colors">
                  {t.footer.terms}
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-slate-400 hover:text-gold-400 transition-colors">
                  {t.footer.privacy}
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-slate-400 hover:text-gold-400 transition-colors">
                  {t.footer.legalNotice}
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-slate-800/50">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xs text-slate-600">
              &copy; {new Date().getFullYear()} TNC Trading. {t.footer.rights}
            </p>

            {/* Admin / State links */}
            <div className="flex items-center gap-4">
              <a
                href={LINKS.admin}
                className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
              >
                {t.footer.adminAccess}
              </a>
              <span className="text-slate-800">|</span>
              <a
                href={LINKS.state}
                className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
              >
                {t.footer.stateAccess}
              </a>
            </div>
          </div>

          <p className="text-[10px] text-slate-700 mt-4 text-center max-w-2xl mx-auto">
            {t.footer.disclaimer}
          </p>
        </div>
      </div>
    </footer>
  );
}
