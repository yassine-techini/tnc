import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

export default function Offers() {
  const { t } = useI18n();

  const plans = [
    {
      name: t.offers.basic,
      desc: t.offers.basicDesc,
      features: t.offers.basicFeatures,
      cta: t.offers.basicCta,
      popular: false,
    },
    {
      name: t.offers.standard,
      desc: t.offers.standardDesc,
      features: t.offers.standardFeatures,
      cta: t.offers.standardCta,
      popular: true,
    },
    {
      name: t.offers.verified,
      desc: t.offers.verifiedDesc,
      features: t.offers.verifiedFeatures,
      cta: t.offers.verifiedCta,
      popular: false,
    },
  ];

  return (
    <section id="offres" className="py-20 md:py-28 relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-800 to-transparent" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-white">
            {t.offers.title}
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">
            {t.offers.subtitle}
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map((plan, i) => (
            <div
              key={i}
              className={`relative p-6 rounded-2xl border transition-all duration-300 hover:-translate-y-1 ${
                plan.popular
                  ? 'bg-gradient-to-b from-gold-500/10 to-slate-900/80 border-gold-500/40 shadow-xl shadow-gold-500/10'
                  : 'bg-slate-900/60 border-slate-800/60 hover:border-slate-700'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-gold-500 text-slate-950 text-xs font-bold rounded-full">
                  {t.offers.popular}
                </div>
              )}

              <div className="text-center mb-6">
                <h3 className={`text-xl font-bold mb-1 ${plan.popular ? 'text-gold-400' : 'text-white'}`}>
                  {plan.name}
                </h3>
                <p className="text-sm text-slate-500">{plan.desc}</p>
              </div>

              <ul className="space-y-3 mb-8">
                {plan.features.map((feature, j) => (
                  <li key={j} className="flex items-start gap-3 text-sm">
                    <svg className="w-5 h-5 text-gold-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-slate-300">{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                to="/register"
                className={`block text-center px-6 py-3 rounded-xl text-sm font-semibold transition-all ${
                  plan.popular
                    ? 'bg-gradient-to-r from-gold-500 to-gold-600 text-slate-950 shadow-lg shadow-gold-500/20 hover:shadow-gold-500/40'
                    : 'border border-slate-700 text-slate-300 hover:border-gold-500/50 hover:text-gold-400'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
