import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface FAQItem {
  question: string;
  answer: string;
}

const faqItems: FAQItem[] = [
  {
    question: "Qu'est-ce qu'un token d'or TNC ?",
    answer: "Un token TNC représente 1 gramme d'or physique stocké de manière sécurisée par l'État burkinabè. En achetant des tokens, vous détenez une part réelle d'or souverain, sans avoir à vous soucier du stockage ou de la sécurité.",
  },
  {
    question: 'Comment acheter de l\'or sur TNC Trading ?',
    answer: "Après avoir créé votre compte et complété la vérification KYC, vous pouvez acheter des tokens d'or en utilisant Orange Money, Moov Money ou par virement bancaire. Le processus est simple et prend moins de 2 minutes.",
  },
  {
    question: 'Mon or est-il vraiment garanti ?',
    answer: "Oui, chaque token émis est adossé à de l'or physique détenu par l'État. La plateforme est régulée et des audits réguliers garantissent que le stock d'or couvre 100% des tokens en circulation.",
  },
  {
    question: 'Quels sont les frais ?',
    answer: "TNC Trading applique un spread transparent de 2% à l'achat et à la vente. Il n'y a pas de frais cachés, pas de frais de stockage et pas de frais de gestion. Vous voyez exactement ce que vous payez.",
  },
  {
    question: 'Puis-je retirer mon argent à tout moment ?',
    answer: "Oui, vous pouvez vendre vos tokens et retirer votre argent à tout moment via Orange Money, Moov Money ou virement bancaire. Les retraits sont généralement traités sous 24 heures.",
  },
  {
    question: 'Quelle est la quantité minimale d\'achat ?',
    answer: "Vous pouvez acheter à partir de 0.001 gramme d'or, ce qui rend l'investissement accessible à tous. Pas besoin d'acheter un lingot entier pour commencer à investir dans l'or !",
  },
];

const howItWorksSteps = [
  {
    step: 1,
    title: 'Créez votre compte',
    description: 'Inscrivez-vous en quelques minutes avec votre email et numéro de téléphone.',
    icon: '📝',
  },
  {
    step: 2,
    title: 'Vérifiez votre identité',
    description: 'Complétez la vérification KYC en soumettant votre pièce d\'identité (CNIB, passeport).',
    icon: '🪪',
  },
  {
    step: 3,
    title: 'Déposez des fonds',
    description: 'Alimentez votre compte via Orange Money, Moov Money ou virement bancaire.',
    icon: '💰',
  },
  {
    step: 4,
    title: 'Achetez de l\'or',
    description: 'Achetez des tokens d\'or au prix du marché. 1 token = 1 gramme d\'or physique.',
    icon: '🥇',
  },
];

const testimonials = [
  {
    name: 'Amadou K.',
    location: 'Ouagadougou',
    text: "Grâce à TNC Trading, j'ai pu commencer à investir dans l'or avec seulement 5000 FCFA. C'est simple et transparent.",
    avatar: 'AK',
  },
  {
    name: 'Fatima S.',
    location: 'Bobo-Dioulasso',
    text: "Je fais confiance à cette plateforme car l'or est garanti par l'État. Je me sens en sécurité pour mes économies.",
    avatar: 'FS',
  },
  {
    name: 'Ibrahim O.',
    location: 'Koudougou',
    text: "Les retraits sont rapides et le support client est excellent. Je recommande TNC Trading à tous mes amis.",
    avatar: 'IO',
  },
];

function FAQAccordion({ items }: { items: FAQItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={index} className="card p-0 overflow-hidden">
          <button
            className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-slate-800/40 transition-colors"
            onClick={() => setOpenIndex(openIndex === index ? null : index)}
          >
            <span className="font-medium pr-4 text-white">{item.question}</span>
            <svg
              className={`w-5 h-5 text-gold-500 transition-transform duration-200 flex-shrink-0 ${openIndex === index ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openIndex === index && (
            <div className="px-6 pb-5 text-slate-400 border-t border-slate-800/60">
              <p className="pt-4 text-sm leading-relaxed">{item.answer}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Landing() {
  const { data: priceData } = useQuery({
    queryKey: ['price'],
    queryFn: () => api.getPrice(),
    refetchInterval: 60000,
  });

  const price = priceData?.data;

  return (
    <div className="min-h-[calc(100vh-200px)]">
      {/* Hero Section */}
      <section className="py-20 md:py-28 px-4 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-gold-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-gold-600/5 rounded-full blur-3xl" />
        </div>
        <div className="container mx-auto text-center max-w-4xl relative z-10">
          <div className="inline-flex items-center gap-2 bg-gold-500/10 border border-gold-500/20 rounded-xl px-4 py-2 mb-8">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-xs font-medium text-gold-400">
              Prix actuel: {price ? `${price.buyPrice.toLocaleString()} FCFA/g` : 'Chargement...'}
            </span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold mb-6 tracking-tight leading-tight">
            Investissez dans l'
            <span className="text-gradient-gold">Or Souverain</span>
            <br />du Burkina Faso
          </h1>
          <p className="text-lg md:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Achetez, vendez et détenez de l'or tokenisé.
            1 token = 1 gramme d'or physique garanti par l'État.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register" className="btn-primary text-base px-8 py-4 gold-glow">
              Commencer maintenant
            </Link>
            <Link to="/login" className="btn-outline text-base px-8 py-4">
              Se connecter
            </Link>
          </div>

          {/* Price badges */}
          {price && (
            <div className="flex flex-wrap justify-center gap-3 mt-10">
              <div className="card py-2.5 px-4 !rounded-xl !p-0 px-4 py-2.5 bg-slate-900/60 border-slate-800/80">
                <span className="text-xs text-slate-500">Achat: </span>
                <span className="text-emerald-400 font-semibold text-sm">{price.buyPrice.toLocaleString()} FCFA/g</span>
              </div>
              <div className="card py-2.5 px-4 !rounded-xl !p-0 px-4 py-2.5 bg-slate-900/60 border-slate-800/80">
                <span className="text-xs text-slate-500">Vente: </span>
                <span className="text-blue-400 font-semibold text-sm">{price.sellPrice.toLocaleString()} FCFA/g</span>
              </div>
              <div className="card py-2.5 px-4 !rounded-xl !p-0 px-4 py-2.5 bg-slate-900/60 border-slate-800/80">
                <span className="text-xs text-slate-500">24h: </span>
                <span className={`font-semibold text-sm ${price.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {price.change24h >= 0 ? '+' : ''}{price.change24h.toFixed(2)}%
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 border-y border-slate-800/60">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { value: '100%', label: 'Couverture en or physique' },
              { value: '2%', label: 'Spread transparent' },
              { value: '24/7', label: 'Accès à votre or' },
              { value: 'BCEAO', label: 'Plateforme régulée' },
            ].map((stat) => (
              <div key={stat.value}>
                <p className="text-3xl md:text-4xl font-bold text-gradient-gold">{stat.value}</p>
                <p className="text-slate-500 mt-2 text-sm">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-3 tracking-tight">
            Comment ça marche ?
          </h2>
          <p className="text-slate-500 text-center mb-12 max-w-2xl mx-auto text-sm">
            Investir dans l'or n'a jamais été aussi simple. Suivez ces 4 étapes pour commencer.
          </p>
          <div className="grid md:grid-cols-4 gap-6">
            {howItWorksSteps.map((step, index) => (
              <div key={step.step} className="relative">
                {index < howItWorksSteps.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-1/2 w-full h-px bg-gradient-to-r from-gold-500/40 to-gold-500/5" />
                )}
                <div className="card-interactive text-center relative z-10">
                  <div className="w-14 h-14 bg-gold-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 ring-1 ring-gold-500/20">
                    <span className="text-2xl">{step.icon}</span>
                  </div>
                  <div className="absolute -top-2.5 -right-2.5 w-7 h-7 bg-gradient-to-br from-gold-500 to-gold-700 rounded-lg flex items-center justify-center text-white font-bold text-xs shadow-lg shadow-gold-500/20">
                    {step.step}
                  </div>
                  <h3 className="text-base font-semibold mb-2 text-white">{step.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4 border-t border-slate-800/40">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-3 tracking-tight">
            Pourquoi choisir TNC Trading ?
          </h2>
          <p className="text-slate-500 text-center mb-12 max-w-2xl mx-auto text-sm">
            Une plateforme conçue pour rendre l'investissement dans l'or accessible à tous les Burkinabè.
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: '🏦', title: 'Or Souverain', desc: "Chaque token est adossé à de l'or physique détenu par l'État burkinabè. Votre investissement est garanti." },
              { icon: '📱', title: 'Simple & Accessible', desc: "Achetez de l'or en quelques clics via Orange Money ou Moov Money. Pas besoin de compte bancaire." },
              { icon: '🔒', title: 'Sécurisé', desc: "Plateforme conforme aux réglementations BCEAO et UEMOA. Vos données et votre argent sont protégés." },
              { icon: '💎', title: 'Fractionnable', desc: "Achetez à partir de 0.001g d'or. Investissez selon vos moyens, même avec de petites sommes." },
              { icon: '📊', title: 'Transparent', desc: "Prix en temps réel basé sur le cours LBMA. Suivez la valeur de votre portefeuille à tout moment." },
              { icon: '🏃', title: 'Liquide', desc: "Vendez votre or et retirez votre argent à tout moment. Retraits traités sous 24 heures." },
            ].map((feature) => (
              <div key={feature.title} className="card-interactive text-center group">
                <div className="w-14 h-14 bg-gold-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 ring-1 ring-gold-500/20 group-hover:ring-gold-500/40 transition-all">
                  <span className="text-2xl">{feature.icon}</span>
                </div>
                <h3 className="text-base font-semibold mb-2 text-white">{feature.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-20 px-4 border-t border-slate-800/40">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-3 tracking-tight">
            Ce que disent nos utilisateurs
          </h2>
          <p className="text-slate-500 text-center mb-12 max-w-2xl mx-auto text-sm">
            Rejoignez des milliers de Burkinabè qui font confiance à TNC Trading pour leurs investissements en or.
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, index) => (
              <div key={index} className="card">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-gradient-to-br from-gold-500 to-gold-700 rounded-xl flex items-center justify-center text-white font-bold text-xs">
                    {testimonial.avatar}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-white">{testimonial.name}</p>
                    <p className="text-slate-500 text-xs">{testimonial.location}</p>
                  </div>
                </div>
                <p className="text-slate-400 text-sm leading-relaxed italic">"{testimonial.text}"</p>
                <div className="flex gap-0.5 mt-4">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <svg key={star} className="w-4 h-4 text-gold-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 px-4 border-t border-slate-800/40">
        <div className="container mx-auto max-w-3xl">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-3 tracking-tight">
            Questions Fréquentes
          </h2>
          <p className="text-slate-500 text-center mb-12 text-sm">
            Tout ce que vous devez savoir sur TNC Trading et l'investissement dans l'or tokenisé.
          </p>
          <FAQAccordion items={faqItems} />
          <div className="text-center mt-8">
            <p className="text-slate-500 text-sm">
              Vous avez d'autres questions ?{' '}
              <a href="mailto:support@tnc-trading.com" className="text-gold-500 hover:text-gold-400 font-medium transition-colors">
                Contactez notre support
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-16 border-y border-slate-800/60">
        <div className="container mx-auto px-4">
          <h3 className="text-center text-xs text-slate-600 uppercase tracking-widest font-semibold mb-8">Plateforme régulée et sécurisée</h3>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16">
            {[
              { name: 'BCEAO', label: 'Régulateur' },
              { name: 'UEMOA', label: 'Zone monétaire' },
              { name: 'LBMA', label: 'Prix de référence' },
              { name: 'SSL/TLS', label: 'Connexion sécurisée' },
            ].map((trust) => (
              <div key={trust.name} className="text-center">
                <p className="text-xl font-bold text-gradient-gold">{trust.name}</p>
                <p className="text-slate-600 text-xs mt-1">{trust.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-gold-500/5 rounded-full blur-3xl" />
        </div>
        <div className="container mx-auto text-center max-w-2xl relative z-10">
          <h2 className="text-2xl md:text-3xl font-bold mb-4 tracking-tight">
            Prêt à investir dans l'or ?
          </h2>
          <p className="text-slate-400 mb-8 leading-relaxed">
            Créez votre compte en moins de 2 minutes et commencez à investir dès aujourd'hui.
            Rejoignez des milliers de Burkinabè qui sécurisent leur avenir avec l'or.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register" className="btn-primary text-base px-8 py-4 gold-glow">
              Créer mon compte gratuitement
            </Link>
            <Link to="/login" className="btn-outline text-base px-8 py-4">
              J'ai déjà un compte
            </Link>
          </div>
          <p className="text-slate-600 text-xs mt-6 tracking-wide">
            Inscription gratuite — Pas de frais cachés — Retrait à tout moment
          </p>
        </div>
      </section>
    </div>
  );
}
