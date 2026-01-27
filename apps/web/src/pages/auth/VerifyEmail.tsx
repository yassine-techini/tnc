import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';

type VerificationState = 'loading' | 'success' | 'error' | 'no-token';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<VerificationState>('loading');
  const [error, setError] = useState('');
  const [resendEmail, setResendEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setState('no-token');
      return;
    }

    const verifyEmail = async () => {
      try {
        await api.verifyEmail(token);
        setState('success');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur de vérification');
        setState('error');
      }
    };

    verifyEmail();
  }, [token]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    setResendLoading(true);
    setResendSuccess(false);

    try {
      await api.resendVerificationEmail(resendEmail);
      setResendSuccess(true);
    } catch {
      setError('Erreur lors de l\'envoi. Vérifiez votre email.');
    } finally {
      setResendLoading(false);
    }
  };

  if (state === 'loading') {
    return (
      <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gold-500 mx-auto mb-4"></div>
          <p className="text-slate-400">Vérification en cours...</p>
        </div>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="card text-center">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold mb-4">Email vérifié !</h1>
            <p className="text-slate-400 mb-6">
              Votre adresse email a été vérifiée avec succès. Vous pouvez maintenant accéder à toutes les fonctionnalités de TNC Trading.
            </p>
            <Link to="/login">
              <Button variant="primary">Se connecter</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'no-token') {
    return (
      <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="card">
            <h1 className="text-2xl font-bold text-center mb-4">Vérifier votre email</h1>
            <p className="text-slate-400 text-center mb-6">
              Entrez votre adresse email pour recevoir un nouveau lien de vérification.
            </p>

            {resendSuccess ? (
              <div className="p-4 bg-green-500/20 border border-green-500/50 rounded-lg text-green-400 text-center">
                Email envoyé ! Vérifiez votre boîte de réception.
              </div>
            ) : (
              <form onSubmit={handleResend} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    className="input"
                    placeholder="email@example.com"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    required
                  />
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  isLoading={resendLoading}
                  loadingText="Envoi..."
                >
                  Renvoyer le lien
                </Button>
              </form>
            )}

            <p className="mt-6 text-center text-sm text-slate-400">
              <Link to="/login" className="link">
                ← Retour à la connexion
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="card">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-center mb-4">Échec de la vérification</h1>
          <p className="text-slate-400 text-center mb-6">
            {error || 'Le lien de vérification est invalide ou a expiré.'}
          </p>

          <div className="space-y-3">
            <p className="text-sm text-slate-400 text-center">
              Besoin d'un nouveau lien ?
            </p>
            {resendSuccess ? (
              <div className="p-4 bg-green-500/20 border border-green-500/50 rounded-lg text-green-400 text-center text-sm">
                Email envoyé ! Vérifiez votre boîte de réception.
              </div>
            ) : (
              <form onSubmit={handleResend} className="space-y-3">
                <input
                  type="email"
                  className="input"
                  placeholder="Votre email"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  required
                />
                <Button
                  type="submit"
                  variant="secondary"
                  fullWidth
                  isLoading={resendLoading}
                  loadingText="Envoi..."
                >
                  Renvoyer le lien
                </Button>
              </form>
            )}
          </div>

          <p className="mt-6 text-center text-sm text-slate-400">
            <Link to="/login" className="link">
              ← Retour à la connexion
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
