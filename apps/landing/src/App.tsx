const COUNTRIES = [
  {
    code: 'bf',
    name: 'Burkina Faso',
    flag: '🇧🇫',
    url: 'https://bf.tnc.trading',
    status: 'active' as const,
  },
  {
    code: 'ml',
    name: 'Mali',
    flag: '🇲🇱',
    url: '#',
    status: 'coming' as const,
  },
  {
    code: 'ne',
    name: 'Niger',
    flag: '🇳🇪',
    url: '#',
    status: 'coming' as const,
  },
  {
    code: 'sn',
    name: 'Senegal',
    flag: '🇸🇳',
    url: '#',
    status: 'coming' as const,
  },
  {
    code: 'ci',
    name: "Cote d'Ivoire",
    flag: '🇨🇮',
    url: '#',
    status: 'coming' as const,
  },
];

function App() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800/50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-gold-400 to-gold-600 rounded-xl flex items-center justify-center shadow-lg shadow-gold-500/20">
              <span className="text-slate-900 font-bold text-2xl">T</span>
            </div>
            <div>
              <span className="text-xl font-bold">TNC Trading</span>
              <p className="text-xs text-slate-400">Tokenisation d'Or Souveraine</p>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#countries" className="text-slate-300 hover:text-white transition-colors">
              Pays
            </a>
            <a href="#about" className="text-slate-300 hover:text-white transition-colors">
              A propos
            </a>
            <a href="#contact" className="text-slate-300 hover:text-white transition-colors">
              Contact
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="py-20 md:py-32">
        <div className="container mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 bg-gold-500/10 text-gold-400 px-4 py-2 rounded-full text-sm font-medium mb-6">
            <span className="w-2 h-2 bg-gold-400 rounded-full animate-pulse" />
            Plateforme active au Burkina Faso
          </div>
          <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
            L'or africain,<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-gold-400 to-gold-600">
              tokenise pour tous
            </span>
          </h1>
          <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10">
            TNC Trading permet aux citoyens africains d'investir dans l'or national
            via des tokens numeriques. 1 token = 1 gramme d'or physique stocke par l'Etat.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="https://bf.tnc.trading"
              className="px-8 py-4 bg-gradient-to-r from-gold-500 to-gold-600 text-slate-900 font-bold rounded-xl hover:from-gold-400 hover:to-gold-500 transition-all shadow-lg shadow-gold-500/25"
            >
              Acceder a TNC Burkina Faso
            </a>
            <a
              href="#countries"
              className="px-8 py-4 bg-slate-800 text-white font-semibold rounded-xl hover:bg-slate-700 transition-colors border border-slate-700"
            >
              Voir tous les pays
            </a>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 border-y border-slate-800/50">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <p className="text-3xl md:text-4xl font-bold text-gold-400">1</p>
              <p className="text-slate-400 mt-1">Pays actif</p>
            </div>
            <div>
              <p className="text-3xl md:text-4xl font-bold text-gold-400">4</p>
              <p className="text-slate-400 mt-1">Pays a venir</p>
            </div>
            <div>
              <p className="text-3xl md:text-4xl font-bold text-gold-400">100%</p>
              <p className="text-slate-400 mt-1">Garanti par l'or</p>
            </div>
            <div>
              <p className="text-3xl md:text-4xl font-bold text-gold-400">24K</p>
              <p className="text-slate-400 mt-1">Or pur 999.9</p>
            </div>
          </div>
        </div>
      </section>

      {/* Countries */}
      <section id="countries" className="py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Choisissez votre pays</h2>
            <p className="text-slate-400 max-w-xl mx-auto">
              TNC Trading s'etend progressivement dans toute l'Afrique de l'Ouest.
              Selectionnez votre pays pour acceder a la plateforme.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {COUNTRIES.map((country) => (
              <a
                key={country.code}
                href={country.url}
                className={`
                  p-6 rounded-2xl border transition-all
                  ${country.status === 'active'
                    ? 'bg-slate-800/50 border-gold-500/30 hover:border-gold-500 hover:shadow-lg hover:shadow-gold-500/10'
                    : 'bg-slate-900/50 border-slate-800 opacity-60 cursor-not-allowed'
                  }
                `}
                onClick={(e) => country.status === 'coming' && e.preventDefault()}
              >
                <div className="flex items-center gap-4">
                  <span className="text-4xl">{country.flag}</span>
                  <div>
                    <h3 className="text-lg font-semibold">{country.name}</h3>
                    {country.status === 'active' ? (
                      <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                        Disponible
                      </span>
                    ) : (
                      <span className="text-sm text-slate-500">Bientot disponible</span>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* About */}
      <section id="about" className="py-20 bg-slate-900/50">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">A propos de TNC Trading</h2>
            <p className="text-slate-400 text-lg mb-8">
              TNC Trading est une initiative panafricaine visant a democratiser l'acces a l'or
              pour tous les citoyens. En partenariat avec les gouvernements, nous permettons
              d'investir dans l'or national de maniere securisee, transparente et accessible.
            </p>
            <div className="grid md:grid-cols-3 gap-6 text-left">
              <div className="p-6 bg-slate-800/50 rounded-xl">
                <div className="w-12 h-12 bg-gold-500/10 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <h3 className="font-semibold mb-2">Securise</h3>
                <p className="text-slate-400 text-sm">
                  Or physique stocke par l'Etat, verification KYC stricte, transactions cryptees.
                </p>
              </div>
              <div className="p-6 bg-slate-800/50 rounded-xl">
                <div className="w-12 h-12 bg-gold-500/10 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                  </svg>
                </div>
                <h3 className="font-semibold mb-2">Transparent</h3>
                <p className="text-slate-400 text-sm">
                  Preuve de reserve publique, prix LBMA en temps reel, audits reguliers.
                </p>
              </div>
              <div className="p-6 bg-slate-800/50 rounded-xl">
                <div className="w-12 h-12 bg-gold-500/10 rounded-lg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <h3 className="font-semibold mb-2">Accessible</h3>
                <p className="text-slate-400 text-sm">
                  Paiement mobile money, achat des 1g d'or, interface simple et intuitive.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="py-20">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Contactez-nous</h2>
          <p className="text-slate-400 mb-8">
            Vous etes un gouvernement interesse par le deploiement de TNC Trading dans votre pays?
          </p>
          <a
            href="mailto:contact@tnc.trading"
            className="inline-flex items-center gap-2 px-8 py-4 bg-slate-800 text-white font-semibold rounded-xl hover:bg-slate-700 transition-colors border border-slate-700"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            contact@tnc.trading
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gold-500 rounded-lg flex items-center justify-center">
                <span className="text-slate-900 font-bold">T</span>
              </div>
              <span className="font-semibold">TNC Trading</span>
            </div>
            <p className="text-slate-500 text-sm">
              2025 TNC Trading. Tokenisation d'or souveraine en Afrique.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
