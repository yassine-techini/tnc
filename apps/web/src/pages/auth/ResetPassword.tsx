import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';

type ResetState = 'form' | 'success' | 'invalid-token';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<ResetState>('form');
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setState('invalid-token');
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    if (formData.password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }

    if (!token) {
      setError('Token de réinitialisation manquant');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await api.resetPassword(token, formData.password);
      setState('success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la reinitialisation';
      if (message.includes('expired') || message.includes('invalid')) {
        setState('invalid-token');
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

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
            <h1 className="text-2xl font-bold mb-4">Mot de passe réinitialisé</h1>
            <p className="text-slate-400 mb-6">
              Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.
            </p>
            <Button
              variant="primary"
              fullWidth
              onClick={() => navigate('/login')}
            >
              Se connecter
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'invalid-token') {
    return (
      <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="card text-center">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold mb-4">Lien invalide ou expiré</h1>
            <p className="text-slate-400 mb-6">
              Ce lien de réinitialisation n'est plus valide. Les liens expirent après 1 heure pour des raisons de sécurité.
            </p>
            <Link to="/forgot-password">
              <Button variant="primary">Demander un nouveau lien</Button>
            </Link>
            <p className="mt-4 text-sm text-slate-400">
              <Link to="/login" className="link">
                ← Retour à la connexion
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="card">
          <h1 className="text-2xl font-bold text-center mb-2">Nouveau mot de passe</h1>
          <p className="text-slate-400 text-center mb-8">
            Choisissez un mot de passe sécurisé pour votre compte.
          </p>

          {error && (
            <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Nouveau mot de passe
              </label>
              <input
                type="password"
                className="input"
                placeholder="Min. 8 caractères"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                minLength={8}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Confirmer le mot de passe
              </label>
              <input
                type="password"
                className="input"
                placeholder="Répétez le mot de passe"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                required
              />
            </div>

            <div className="text-sm text-slate-400 space-y-1">
              <p>Le mot de passe doit contenir :</p>
              <ul className="list-disc list-inside space-y-1">
                <li className={formData.password.length >= 8 ? 'text-green-400' : ''}>
                  Au moins 8 caractères
                </li>
                <li className={/[A-Z]/.test(formData.password) ? 'text-green-400' : ''}>
                  Une lettre majuscule
                </li>
                <li className={/[a-z]/.test(formData.password) ? 'text-green-400' : ''}>
                  Une lettre minuscule
                </li>
                <li className={/\d/.test(formData.password) ? 'text-green-400' : ''}>
                  Un chiffre
                </li>
              </ul>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              isLoading={isLoading}
              loadingText="Réinitialisation..."
            >
              Réinitialiser le mot de passe
            </Button>
          </form>

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
