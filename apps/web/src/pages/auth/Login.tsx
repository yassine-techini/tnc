import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    identifier: '',
    password: '',
    totpCode: '',
  });
  const [error, setError] = useState('');
  const [showTOTP, setShowTOTP] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await api.login(
        formData.identifier,
        formData.password,
        formData.totpCode || undefined
      );

      login(
        {
          id: response.data.user.id,
          email: response.data.user.email,
          phone: response.data.user.phone,
          country: response.data.user.country,
          kycLevel: response.data.user.kycLevel,
          kycStatus: response.data.user.kycStatus as 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED',
          emailVerified: response.data.user.emailVerified,
          phoneVerified: response.data.user.phoneVerified,
          twoFactorEnabled: response.data.user.twoFactorEnabled,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          accessToken: response.data.accessToken,
          refreshToken: response.data.refreshToken,
          expiresIn: response.data.expiresIn,
        }
      );

      navigate('/dashboard');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur de connexion';
      if (message.includes('2FA')) {
        setShowTOTP(true);
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="card">
          <h1 className="text-2xl font-bold text-center mb-8">Connexion</h1>

          {error && (
            <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Email ou téléphone
              </label>
              <input
                type="text"
                className="input"
                placeholder="email@example.com ou 22670..."
                value={formData.identifier}
                onChange={(e) => setFormData({ ...formData, identifier: e.target.value })}
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

            {showTOTP && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Code 2FA
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="123456"
                  maxLength={6}
                  value={formData.totpCode}
                  onChange={(e) => setFormData({ ...formData, totpCode: e.target.value })}
                  required
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <Link to="/forgot-password" className="text-sm link">
                Mot de passe oublié ?
              </Link>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              isLoading={isLoading}
              loadingText="Connexion..."
            >
              Se connecter
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-400">
            Pas encore de compte ?{' '}
            <Link to="/register" className="link">
              Créer un compte
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
