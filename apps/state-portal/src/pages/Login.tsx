import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStateStore } from '../stores/auth';
import { stateApi } from '../lib/api';

// Demo accounts for state portal testing
const DEMO_ACCOUNTS = [
  { label: 'Ministère des Mines', email: 'etat@mines.gov.bf', password: 'StatePass2024', ministry: 'MINES' },
  { label: 'Ministère des Finances', email: 'etat@finances.gov.bf', password: 'StatePass2024', ministry: 'FINANCES' },
];

export default function Login() {
  const navigate = useNavigate();
  const { login } = useStateStore();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [error, setError] = useState('');

  const fillDemoAccount = (account: typeof DEMO_ACCOUNTS[0]) => {
    setFormData({ email: account.email, password: account.password });
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await stateApi.stateLogin(formData.email, formData.password);

      login(
        {
          id: response.data.user.id,
          email: response.data.user.email,
          ministry: response.data.user.ministry,
        },
        {
          accessToken: response.data.tokens.accessToken,
          refreshToken: response.data.tokens.refreshToken,
          expiresIn: response.data.tokens.expiresIn,
        }
      );

      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="card">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-state-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🏛️</span>
            </div>
            <h1 className="text-2xl font-bold">Portail État</h1>
            <p className="text-slate-400 mt-2">Accès réservé aux agents de l'État</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Email institutionnel
              </label>
              <input
                type="email"
                className="input"
                placeholder="agent@finances.gov.bf"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Mot de passe
              </label>
              <input
                type="password"
                className="input"
                placeholder="********"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full btn-primary py-3"
            >
              {isLoading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>

          <div className="mt-8 p-4 bg-slate-900/50 rounded-lg">
            <p className="text-xs text-slate-500 text-center">
              Ce portail est réservé aux agents autorisés du Ministère des Mines
              et du Ministère des Finances du Burkina Faso.
              L'accès non autorisé est strictement interdit.
            </p>
          </div>

          {/* Demo Accounts Section */}
          <div className="mt-6 pt-4 border-t border-slate-700">
            <p className="text-sm text-slate-400 text-center mb-3">
              Comptes de démonstration
            </p>
            <div className="space-y-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => fillDemoAccount(account)}
                  className="w-full px-4 py-2 text-sm bg-state-500/10 hover:bg-state-500/20 border border-state-500/30 rounded-lg transition-colors flex items-center justify-between"
                >
                  <span className="text-slate-300">{account.label}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-state-500/20 text-state-400">
                    {account.ministry}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 text-center mt-2">
              Cliquez pour auto-remplir les identifiants
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
