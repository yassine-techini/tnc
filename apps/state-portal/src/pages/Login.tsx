import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStateStore } from '../stores/auth';
import { stateApi } from '../lib/api';

// Demo accounts (staging/dev only — hidden in production)
const IS_STAGING = import.meta.env.VITE_APP_ENV === 'staging' || import.meta.env.VITE_APP_ENV === 'development' || import.meta.env.DEV;
const DEMO_ACCOUNTS = IS_STAGING ? [
  { label: 'Ministère des Mines', email: 'etat@mines.gov.bf', password: 'StateDemo2024!', ministry: 'MINES' },
  { label: 'Ministère des Finances', email: 'etat@finances.gov.bf', password: 'StateDemo2024!', ministry: 'FINANCES' },
] : [];

type LoginStep = 'credentials' | '2fa_setup' | '2fa_verify';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useStateStore();
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<LoginStep>('credentials');
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    totpCode: '',
  });
  const [setupData, setSetupData] = useState<{
    setupToken: string;
    secret: string;
    uri: string;
  } | null>(null);
  const [error, setError] = useState('');

  const fillDemoAccount = (account: typeof DEMO_ACCOUNTS[0]) => {
    setFormData({ ...formData, email: account.email, password: account.password });
    setError('');
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await stateApi.stateLogin(formData.email, formData.password);

      if ('requires2FASetup' in response && response.requires2FASetup) {
        // 2FA not set up - get setup data
        const setupResponse = await stateApi.state2FASetup(response.setupToken!);
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
            ministry: response.data.user.ministry,
          },
          {
            accessToken: response.data.tokens.accessToken,
            refreshToken: response.data.tokens.refreshToken,
            expiresIn: response.data.tokens.expiresIn,
          }
        );
        navigate('/');
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
        // Verify and complete 2FA setup
        const response = await stateApi.state2FAVerify(setupData.setupToken, formData.totpCode);
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
      } else if (step === '2fa_verify') {
        // Login with 2FA code
        const response = await stateApi.stateLogin(formData.email, formData.password, formData.totpCode);
        if (response.success) {
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
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="card">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-state-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🏛️</span>
            </div>
            <h1 className="text-2xl font-bold">Portail État</h1>
            <p className="text-slate-400 mt-2">
              {step === 'credentials' && 'Accès réservé aux agents de l\'État'}
              {step === '2fa_setup' && 'Configuration 2FA obligatoire'}
              {step === '2fa_verify' && 'Vérification 2FA'}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Step 1: Credentials */}
          {step === 'credentials' && (
            <>
              <form onSubmit={handleCredentialsSubmit} className="space-y-6">
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
              {DEMO_ACCOUNTS.length > 0 && (
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
              )}
            </>
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
                  <code className="text-sm text-state-400 font-mono break-all">{setupData.secret}</code>
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

              <button
                type="submit"
                disabled={isLoading || formData.totpCode.length !== 6}
                className="w-full btn-primary py-3"
              >
                {isLoading ? 'Vérification...' : 'Activer 2FA et se connecter'}
              </button>

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
                <div className="w-16 h-16 rounded-full bg-state-500/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-state-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

              <button
                type="submit"
                disabled={isLoading || formData.totpCode.length !== 6}
                className="w-full btn-primary py-3"
              >
                {isLoading ? 'Vérification...' : 'Vérifier et se connecter'}
              </button>

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
