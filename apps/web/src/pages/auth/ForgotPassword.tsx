import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';

export default function ForgotPassword() {
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Erreur lors de l\'envoi');
      }

      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'envoi');
    } finally {
      setIsLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="card text-center">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">✉️</span>
            </div>
            <h1 className="text-2xl font-bold mb-4">Email envoyé</h1>
            <p className="text-slate-400 mb-6">
              Si un compte existe avec l'adresse {email}, vous recevrez un email avec les instructions pour réinitialiser votre mot de passe.
            </p>
            <Link to="/login">
              <Button variant="primary" fullWidth>Retour à la connexion</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="card">
          <h1 className="text-2xl font-bold text-center mb-2">Mot de passe oublié ?</h1>
          <p className="text-slate-400 text-center mb-8">
            Entrez votre email pour recevoir un lien de réinitialisation.
          </p>
          
          {error && (
            <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Email
              </label>
              <input
                type="email"
                className="input"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            
            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              isLoading={isLoading}
              loadingText="Envoi..."
            >
              Envoyer le lien
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
