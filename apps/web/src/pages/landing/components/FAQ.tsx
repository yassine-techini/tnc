import { useState } from 'react';
import { useI18n } from '../i18n';

export default function FAQ() {
  const { t } = useI18n();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const questions = [
    { q: t.faq.q1, a: t.faq.a1 },
    { q: t.faq.q2, a: t.faq.a2 },
    { q: t.faq.q3, a: t.faq.a3 },
    { q: t.faq.q4, a: t.faq.a4 },
    { q: t.faq.q5, a: t.faq.a5 },
    { q: t.faq.q6, a: t.faq.a6 },
  ];

  return (
    <section id="faq" className="py-20 md:py-28 relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-800 to-transparent" />
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-white">
            {t.faq.title}
          </h2>
          <p className="text-slate-400">
            {t.faq.subtitle}
          </p>
        </div>

        <div className="space-y-3">
          {questions.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <div
                key={i}
                className="rounded-xl border border-slate-800/60 bg-slate-900/40 overflow-hidden transition-all"
              >
                <button
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  className="flex items-center justify-between w-full px-6 py-4 text-left"
                >
                  <span className="text-sm font-medium text-white pr-4">{item.q}</span>
                  <svg
                    className={`w-5 h-5 text-gold-500 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isOpen && (
                  <div className="px-6 pb-4">
                    <p className="text-sm text-slate-400 leading-relaxed">{item.a}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
