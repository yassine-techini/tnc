import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

interface CertificateData {
  certificateId: string;
  verificationCode: string;
  holderName: string;
  tokenBalance: number;
  kycLevel: string;
  status: string;
  issuedAt: string;
  verificationCount: number;
}

export default function VerifyCertificate() {
  const { code } = useParams<{ code: string }>();
  const [manualCode, setManualCode] = useState(code || '');
  const [loading, setLoading] = useState(false);
  const [certificate, setCertificate] = useState<CertificateData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const verifyCertificate = async (verificationCode: string) => {
    if (!verificationCode.trim()) return;
    setLoading(true);
    setError(null);
    setCertificate(null);
    setSearched(true);

    try {
      const res = await fetch(`${API_URL}/api/v1/verify/${encodeURIComponent(verificationCode.trim())}`);
      const data = await res.json();

      if (data.success && data.data) {
        setCertificate(data.data);
      } else {
        setError(data.error?.message || 'Certificat non trouvé');
      }
    } catch {
      setError('Erreur de connexion au serveur');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (code) {
      verifyCertificate(code);
    }
  }, [code]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    verifyCertificate(manualCode);
  };

  const formattedDate = certificate
    ? new Date(certificate.issuedAt).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : '';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        {/* Title */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-emerald-500/10 text-emerald-400 px-4 py-2 rounded-full text-sm font-medium mb-4">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Vérification de certificat
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">
            Vérifier un certificat de propriété
          </h1>
          <p className="text-slate-400 text-sm">
            Entrez le code de vérification figurant sur le certificat pour vérifier son authenticité
          </p>
        </div>

        {/* Search form */}
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="flex gap-3">
            <input
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.toUpperCase())}
              placeholder="Ex: BF-ABCD-1234"
              className="flex-1 px-5 py-4 bg-slate-900/80 border border-slate-700/80 rounded-xl text-white
                placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-gold-500/50 focus:border-gold-500/50
                text-lg font-mono tracking-wider transition-all"
              maxLength={12}
            />
            <button
              type="submit"
              disabled={loading || !manualCode.trim()}
              className="px-6 py-4 bg-gradient-to-r from-gold-500 to-gold-600 text-slate-950 font-bold rounded-xl
                hover:from-gold-400 hover:to-gold-500 disabled:opacity-40 disabled:cursor-not-allowed
                transition-all shadow-lg shadow-gold-500/20"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-slate-900/30 border-t-slate-900 rounded-full animate-spin" />
              ) : (
                'Vérifier'
              )}
            </button>
          </div>
        </form>

        {/* Results */}
        {searched && !loading && (
          <div className="animate-fade-in">
            {certificate ? (
              <div className="bg-slate-900/60 backdrop-blur-md rounded-2xl border border-emerald-500/30 overflow-hidden">
                {/* Success header */}
                <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-6 py-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-emerald-400 font-bold text-lg">Certificat valide</h2>
                    <p className="text-emerald-400/60 text-xs">
                      Vérifié {certificate.verificationCount} fois
                    </p>
                  </div>
                </div>

                {/* Certificate details */}
                <div className="p-6 space-y-5">
                  {/* Certificate ID */}
                  <div>
                    <p className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-1">
                      Numéro de certificat
                    </p>
                    <p className="text-white font-mono text-lg font-bold tracking-wide">
                      {certificate.certificateId}
                    </p>
                  </div>

                  <div className="h-px bg-slate-800" />

                  {/* Holder */}
                  <div>
                    <p className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-1">
                      Titulaire
                    </p>
                    <p className="text-white text-lg font-semibold">{certificate.holderName}</p>
                    <p className="text-slate-400 text-sm">
                      Identité vérifiée — Niveau {certificate.kycLevel}
                    </p>
                  </div>

                  <div className="h-px bg-slate-800" />

                  {/* Gold amount */}
                  <div>
                    <p className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-1">
                      Or physique détenu
                    </p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-extrabold text-emerald-400">
                        {certificate.tokenBalance.toFixed(3)}
                      </span>
                      <span className="text-slate-400 text-lg">grammes</span>
                    </div>
                    <p className="text-gold-500 text-sm font-medium mt-1">
                      Or pur 999,9/1000 (24 carats)
                    </p>
                  </div>

                  <div className="h-px bg-slate-800" />

                  {/* Details grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-1">
                        Date d'émission
                      </p>
                      <p className="text-slate-300 text-sm font-medium">{formattedDate}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-1">
                        Statut
                      </p>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/15 text-emerald-400 rounded-lg text-xs font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        {certificate.status}
                      </span>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-1">
                        Émetteur
                      </p>
                      <p className="text-slate-300 text-sm font-medium">TNC Trading SA</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold mb-1">
                        Autorité
                      </p>
                      <p className="text-slate-300 text-sm font-medium">Min. des Mines — BF</p>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="bg-slate-800/40 border-t border-slate-800 px-6 py-4 text-center">
                  <p className="text-slate-500 text-xs">
                    Certificat émis conformément à la réglementation UEMOA — Burkina Faso
                  </p>
                </div>
              </div>
            ) : error ? (
              <div className="bg-slate-900/60 backdrop-blur-md rounded-2xl border border-red-500/30 overflow-hidden">
                <div className="bg-red-500/10 border-b border-red-500/20 px-6 py-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-red-400 font-bold text-lg">Certificat non trouvé</h2>
                    <p className="text-red-400/60 text-xs">{error}</p>
                  </div>
                </div>
                <div className="p-6">
                  <p className="text-slate-400 text-sm">
                    Veuillez vérifier que le code saisi correspond exactement au code figurant sur le certificat.
                    Le format attendu est : BF-XXXX-XXXX.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Info section */}
        <div className="mt-12 text-center">
          <p className="text-slate-600 text-xs">
            Programme National de Tokenisation de l'Or — Ministère des Mines et des Carrières — Burkina Faso
          </p>
        </div>
      </div>
    </div>
  );
}
