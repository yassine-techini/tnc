import { useI18n } from '../i18n';

export default function Security() {
  const { t } = useI18n();

  const items = [
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
      title: t.security.encryption,
      desc: t.security.encryptionDesc,
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
      title: t.security.twoFactor,
      desc: t.security.twoFactorDesc,
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      ),
      title: t.security.audit,
      desc: t.security.auditDesc,
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      title: t.security.cloudflare,
      desc: t.security.cloudflareDesc,
    },
  ];

  return (
    <section id="securite" className="py-20 md:py-28 relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-800 to-transparent" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-white">
            {t.security.title} <span className="text-gradient-gold">{t.security.titleHighlight}</span>
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">
            {t.security.subtitle}
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {items.map((item, i) => (
            <div
              key={i}
              className="flex gap-4 p-6 rounded-2xl bg-slate-900/60 border border-slate-800/60 hover:border-gold-500/20 transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-gold-500/10 flex items-center justify-center text-gold-500 shrink-0">
                {item.icon}
              </div>
              <div>
                <h3 className="text-base font-semibold text-white mb-1">{item.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
