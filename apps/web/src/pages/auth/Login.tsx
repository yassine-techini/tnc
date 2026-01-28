import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';

type LoginStep = 'credentials' | '2fa_setup' | '2fa_verify';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<LoginStep>('credentials');
  const [formData, setFormData] = useState({
    identifier: '',
    password: '',
    totpCode: '',
  });
  const [setupData, setSetupData] = useState<{
    setupToken: string;
    secret: string;
    uri: string;
  } | null>(null);
  const [error, setError] = useState('');

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await api.login(formData.identifier, formData.password);

      if ('requires2FASetup' in response && response.requires2FASetup) {
        // 2FA not set up - get setup data
        const setupResponse = await api.setup2FA(response.setupToken!);
        setSetupData({
          setupToken: response.setupToken!,
          secret: setupResponse.data.secret,
          uri: setupResponse.data.uri,
        });
        setStep('2fa_setup');
      } else if ('requires2FA' in response && response.requires2FA) {
        // 2FA required - show input
        setStep('2fa_verify');
      } else if (response.success) {
        // Login successful
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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setIsLoading(false);
    }
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      if (step === '2fa_setup' && setupData) {
        // Complete 2FA setup
        const response = await api.complete2FASetup(setupData.setupToken, formData.totpCode);
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
            twoFactorEnabled: true,
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
      } else if (step === '2fa_verify') {
        // Login with 2FA code
        const response = await api.login(formData.identifier, formData.password, formData.totpCode);
        if (response.success) {
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
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code invalide');
    } finally {
      setIsLoading(false);
    }
  };

  const generateQRCodeUrl = (uri: string) => {
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(uri)}`;
  };

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="card">
          <h1 className="text-2xl font-bold text-center mb-2">
            {step === 'credentials' && 'Connexion'}
            {step === '2fa_setup' && 'Configuration 2FA'}
            {step === '2fa_verify' && 'Vérification 2FA'}
          </h1>
          <p className="text-slate-400 text-center mb-8 text-sm">
            {step === 'credentials' && 'Connectez-vous à votre compte'}
            {step === '2fa_setup' && 'Configuration obligatoire pour sécuriser votre compte'}
            {step === '2fa_verify' && 'Entrez le code de votre application'}
          </p>

          {error && (
            <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Step 1: Credentials */}
          {step === 'credentials' && (
            <form onSubmit={handleCredentialsSubmit} className="space-y-6">
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

              <p className="mt-6 text-center text-sm text-slate-400">
                Pas encore de compte ?{' '}
                <Link to="/register" className="link">
                  Créer un compte
                </Link>
              </p>
            </form>
          )}

          {/* Step 2: 2FA Setup */}
          {step === '2fa_setup' && setupData && (
            <form onSubmit={handle2FASubmit} className="space-y-5">
              <div className="text-center">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-full mb-4">
                  <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span className="text-xs text-amber-400 font-medium">Configuration obligatoire</span>
                </div>
                <p className="text-sm text-slate-400 mb-4">
                  Scannez ce QR code avec votre application d'authentification (Google Authenticator, Authy, etc.)
                </p>
                <div className="bg-white p-4 rounded-xl inline-block mb-4">
                  <img
                    src={generateQRCodeUrl(setupData.uri)}
                    alt="QR Code 2FA"
                    className="w-48 h-48"
                  />
                </div>
                <div className="bg-slate-800/50 p-3 rounded-lg mb-4">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Clé secrète (si QR code indisponible)</p>
                  <code className="text-sm text-gold-400 font-mono break-all">{setupData.secret}</code>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Code de vérification
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  className="input text-center text-2xl tracking-[0.5em] font-mono"
                  placeholder="000000"
                  value={formData.totpCode}
                  onChange={(e) => setFormData({ ...formData, totpCode: e.target.value.replace(/\D/g, '') })}
                  required
                  autoFocus
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                isLoading={isLoading}
                loadingText="Vérification..."
                disabled={formData.totpCode.length !== 6}
              >
                Activer 2FA et se connecter
              </Button>

              <button
                type="button"
                onClick={() => {
                  setStep('credentials');
                  setSetupData(null);
                  setFormData({ ...formData, totpCode: '' });
                }}
                className="w-full text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                Retour
              </button>
            </form>
          )}

          {/* Step 3: 2FA Verify */}
          {step === '2fa_verify' && (
            <form onSubmit={handle2FASubmit} className="space-y-5">
              <div className="text-center mb-4">
                <div className="w-16 h-16 rounded-full bg-gold-500/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <p className="text-sm text-slate-400">
                  Entrez le code à 6 chiffres de votre application d'authentification
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Code 2FA
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  className="input text-center text-2xl tracking-[0.5em] font-mono"
                  placeholder="000000"
                  value={formData.totpCode}
                  onChange={(e) => setFormData({ ...formData, totpCode: e.target.value.replace(/\D/g, '') })}
                  required
                  autoFocus
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                isLoading={isLoading}
                loadingText="Vérification..."
                disabled={formData.totpCode.length !== 6}
              >
                Vérifier et se connecter
              </Button>

              <button
                type="button"
                onClick={() => {
                  setStep('credentials');
                  setFormData({ ...formData, totpCode: '' });
                }}
                className="w-full text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                Retour
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
