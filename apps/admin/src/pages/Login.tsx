import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminStore } from '../stores/auth';
import { adminApi } from '../lib/api';

// Demo account (staging/dev only — hidden in production)
const IS_STAGING = import.meta.env.VITE_APP_ENV === 'staging' || import.meta.env.VITE_APP_ENV === 'development' || import.meta.env.DEV;
const DEMO_ACCOUNT = IS_STAGING ? {
  label: 'Admin Demo',
  email: 'admin@tnc.trading',
  password: 'AdminDemo2024!',
  role: 'SUPER_ADMIN',
} : null;

type LoginStep = 'credentials' | '2fa_setup' | '2fa_verify';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAdminStore();
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

  const fillDemoAccount = () => {
    if (!DEMO_ACCOUNT) return;
    setFormData({ ...formData, email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password });
    setError('');
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await adminApi.adminLogin(formData.email, formData.password);

      if ('requires2FASetup' in response && response.requires2FASetup) {
        // 2FA not set up - get setup data
        const setupResponse = await adminApi.admin2FASetup(response.setupToken!);
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
        // Login successful - tokens are now set as httpOnly cookies by the server
        login(
          {
            id: response.data.user.id,
            email: response.data.user.email,
            name: response.data.user.name,
            role: response.data.user.role,
          },
          response.data.user.permissions
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
        // Verify and complete 2FA setup - tokens are now set as httpOnly cookies by the server
        const response = await adminApi.admin2FAVerify(setupData.setupToken, formData.totpCode);
        login(
          {
            id: response.data.user.id,
            email: response.data.user.email,
            name: response.data.user.name,
            role: response.data.user.role,
          },
          response.data.user.permissions
        );
        navigate('/');
      } else if (step === '2fa_verify') {
        // Login with 2FA code - tokens are now set as httpOnly cookies by the server
        const response = await adminApi.adminLogin(formData.email, formData.password, formData.totpCode);
        if (response.success) {
          login(
            {
              id: response.data.user.id,
              email: response.data.user.email,
              name: response.data.user.name,
              role: response.data.user.role,
            },
            response.data.user.permissions
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-gold-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-gold-600/5 rounded-full blur-3xl" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold-500/20 to-transparent" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo section */}
        <div className="text-center mb-8 animate-fade-in">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gold-500 to-gold-700 flex items-center justify-center mx-auto shadow-xl shadow-gold-500/20 animate-glow-pulse">
            <span className="text-white font-extrabold text-2xl">T</span>
          </div>
          <h1 className="text-2xl font-bold text-white mt-4 tracking-tight">TNC Admin</h1>
          <p className="text-slate-500 mt-1 text-sm">
            {step === 'credentials' && 'Connexion au back-office'}
            {step === '2fa_setup' && 'Configuration 2FA obligatoire'}
            {step === '2fa_verify' && 'Vérification 2FA'}
          </p>
        </div>

        <div className="card animate-slide-up">
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-center gap-3">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              {error}
            </div>
          )}

          {/* Step 1: Credentials */}
          {step === 'credentials' && (
            <form onSubmit={handleCredentialsSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Email administrateur
                </label>
                <div className="relative">
                  <input
                    type="email"
                    className="input pl-11"
                    placeholder="admin@tnc-trading.bf"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
                  <svg className="w-[18px] h-[18px] absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Mot de passe
                </label>
                <div className="relative">
                  <input
                    type="password"
                    className="input pl-11"
                    placeholder="********"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    required
                  />
                  <svg className="w-[18px] h-[18px] absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full btn-primary py-3.5 text-sm relative overflow-hidden group"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                    Connexion...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Se connecter
                    <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </span>
                )}
              </button>

              <p className="mt-6 text-center text-[11px] text-slate-600 uppercase tracking-widest">
                Accès réservé aux administrateurs
              </p>

              {/* Demo Account Section — dev only */}
              {DEMO_ACCOUNT && (
                <div className="mt-6 pt-5 border-t border-slate-800/60">
                  <p className="text-xs font-medium text-slate-500 text-center mb-3">
                    Compte de démonstration
                  </p>
                  <button
                    type="button"
                    onClick={fillDemoAccount}
                    className="w-full px-4 py-3 text-sm bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-gold-500/30 rounded-xl transition-all duration-200 flex items-center justify-center gap-3 group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gold-500 to-gold-700 flex items-center justify-center flex-shrink-0">
                      <span className="text-white font-bold text-xs">A</span>
                    </div>
                    <span className="text-slate-300 font-medium group-hover:text-white transition-colors">{DEMO_ACCOUNT.label}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-gold-500/15 text-gold-400 ring-1 ring-gold-500/20 font-semibold">
                      {DEMO_ACCOUNT.role}
                    </span>
                  </button>
                  <p className="text-[11px] text-slate-600 text-center mt-2.5">
                    Cliquez pour auto-remplir les identifiants
                  </p>
                </div>
              )}
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
                  Ajoutez ce compte a votre application d'authentification (Google Authenticator, Authy, etc.).
                </p>
                {/* Pas d'image de QR : la faire dessiner par un service externe
                    enverrait la graine TOTP a un tiers, ce qui revient a lui
                    confier le second facteur. Le lien otpauth:// enrole
                    directement quand une application est installee, et la cle
                    ci-dessous couvre les autres cas. */}
                <a
                  href={setupData.uri}
                  className="block text-center px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 mb-4"
                >
                  Ouvrir dans mon application d'authentification
                </a>
                <div className="bg-slate-800/50 p-3 rounded-lg mb-4">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Clé secrète (si vous ne pouvez pas ouvrir le lien)</p>
                  <code className="text-sm text-gold-400 font-mono break-all">{setupData.secret}</code>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
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
                className="w-full btn-primary py-3.5 text-sm"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                    Vérification...
                  </span>
                ) : (
                  'Activer 2FA et se connecter'
                )}
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
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
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
                className="w-full btn-primary py-3.5 text-sm"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                    Vérification...
                  </span>
                ) : (
                  'Vérifier et se connecter'
                )}
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

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-[11px] text-slate-700">
            &copy; {new Date().getFullYear()} TNC Trading - Burkina Faso
          </p>
        </div>
      </div>
    </div>
  );
}
