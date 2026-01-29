import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';

type LoginStep = 'credentials' | '2fa_setup' | '2fa_verify' | 'passwordless_request' | 'passwordless_verify' | 'passwordless_2fa';
type LoginMode = 'password' | 'passwordless';

// Demo accounts (staging/dev only — hidden in production)
const IS_STAGING = import.meta.env.VITE_APP_ENV === 'staging' || import.meta.env.VITE_APP_ENV === 'development' || import.meta.env.DEV;
const DEMO_ACCOUNTS = IS_STAGING ? [
  { label: 'Compte Standard', email: 'demo@tnc.trading', password: 'Demo2024!', level: 'STANDARD' },
  { label: 'Compte Vérifié', email: 'verified@tnc.trading', password: 'Demo2024!', level: 'VERIFIED' },
] : [];

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [loginMode, setLoginMode] = useState<LoginMode>('password');
  const [step, setStep] = useState<LoginStep>('credentials');
  const [formData, setFormData] = useState({
    identifier: '',
    password: '',
    totpCode: '',
    otpCode: '',
  });
  const [setupData, setSetupData] = useState<{
    setupToken: string;
    secret: string;
    uri: string;
  } | null>(null);
  const [passwordlessMethod, setPasswordlessMethod] = useState<'email' | 'sms'>('email');
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');

  const fillDemoAccount = (account: typeof DEMO_ACCOUNTS[0]) => {
    setFormData({ ...formData, identifier: account.email, password: account.password });
    setError('');
  };

  const handleLoginUser = (userData: any) => {
    // Tokens are now set as httpOnly cookies by the server
    // We only store user info in the auth store
    login({
      id: userData.id,
      email: userData.email,
      phone: userData.phone,
      country: userData.country,
      kycLevel: userData.kycLevel,
      kycStatus: userData.kycStatus as 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED',
      emailVerified: userData.emailVerified,
      phoneVerified: userData.phoneVerified,
      twoFactorEnabled: userData.twoFactorEnabled,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    navigate('/dashboard');
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await api.login(formData.identifier, formData.password);

      if ('requires2FASetup' in response && response.requires2FASetup) {
        const setupResponse = await api.setup2FA(response.setupToken!);
        setSetupData({
          setupToken: response.setupToken!,
          secret: setupResponse.data.secret,
          uri: setupResponse.data.uri,
        });
        setStep('2fa_setup');
      } else if ('requires2FA' in response && response.requires2FA) {
        setStep('2fa_verify');
      } else if (response.success) {
        handleLoginUser(response.data.user);
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
        const response = await api.complete2FASetup(setupData.setupToken, formData.totpCode);
        handleLoginUser({ ...response.data.user, twoFactorEnabled: true });
      } else if (step === '2fa_verify') {
        const response = await api.login(formData.identifier, formData.password, formData.totpCode);
        if (response.success) {
          handleLoginUser(response.data.user);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code invalide');
    } finally {
      setIsLoading(false);
    }
  };

  // Passwordless handlers
  const handlePasswordlessRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      await api.requestPasswordlessCode(formData.identifier, passwordlessMethod);
      setStep('passwordless_verify');
      // Start countdown for resend
      setCountdown(60);
      const interval = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'envoi du code');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordlessVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await api.verifyPasswordlessCode(
        formData.identifier,
        formData.otpCode,
        step === 'passwordless_2fa' ? formData.totpCode : undefined
      );

      if ('requires2FA' in response && response.requires2FA) {
        setStep('passwordless_2fa');
      } else if (response.success) {
        handleLoginUser(response.data.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code invalide');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (countdown > 0) return;
    setIsLoading(true);
    setError('');

    try {
      await api.requestPasswordlessCode(formData.identifier, passwordlessMethod);
      setCountdown(60);
      const interval = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du renvoi');
    } finally {
      setIsLoading(false);
    }
  };

  const switchLoginMode = () => {
    setLoginMode(loginMode === 'password' ? 'passwordless' : 'password');
    setStep(loginMode === 'password' ? 'passwordless_request' : 'credentials');
    setError('');
    setFormData({ ...formData, password: '', totpCode: '', otpCode: '' });
  };

  const generateQRCodeUrl = (uri: string) => {
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(uri)}`;
  };

  const getTitle = () => {
    switch (step) {
      case 'credentials': return 'Connexion';
      case '2fa_setup': return 'Configuration 2FA';
      case '2fa_verify': return 'Vérification 2FA';
      case 'passwordless_request': return 'Connexion sans mot de passe';
      case 'passwordless_verify': return 'Vérification du code';
      case 'passwordless_2fa': return 'Vérification 2FA';
      default: return 'Connexion';
    }
  };

  const getSubtitle = () => {
    switch (step) {
      case 'credentials': return 'Connectez-vous à votre compte';
      case '2fa_setup': return 'Configuration obligatoire pour sécuriser votre compte';
      case '2fa_verify': return 'Entrez le code de votre application';
      case 'passwordless_request': return 'Recevez un code par email ou SMS';
      case 'passwordless_verify': return `Code envoyé par ${passwordlessMethod === 'email' ? 'email' : 'SMS'}`;
      case 'passwordless_2fa': return 'Entrez le code de votre application 2FA';
      default: return '';
    }
  };

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="card">
          <h1 className="text-2xl font-bold text-center mb-2">{getTitle()}</h1>
          <p className="text-slate-400 text-center mb-8 text-sm">{getSubtitle()}</p>

          {error && (
            <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Password Login */}
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

              {/* Passwordless toggle */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-700"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-slate-800 text-slate-500">ou</span>
                </div>
              </div>

              <button
                type="button"
                onClick={switchLoginMode}
                className="w-full px-4 py-3 text-sm border border-gold-500/30 rounded-lg hover:bg-gold-500/10 transition-colors flex items-center justify-center gap-2 text-gold-400"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Connexion par code (email/SMS)
              </button>

              <p className="mt-6 text-center text-sm text-slate-400">
                Pas encore de compte ?{' '}
                <Link to="/register" className="link">
                  Créer un compte
                </Link>
              </p>

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
                        className="w-full px-4 py-2 text-sm bg-gold-500/10 hover:bg-gold-500/20 border border-gold-500/30 rounded-lg transition-colors flex items-center justify-between"
                      >
                        <span className="text-slate-300">{account.label}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-gold-500/20 text-gold-400">
                          {account.level}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 text-center mt-2">
                    Cliquez pour auto-remplir les identifiants
                  </p>
                </div>
              )}
            </form>
          )}

          {/* Passwordless Request */}
          {step === 'passwordless_request' && (
            <form onSubmit={handlePasswordlessRequest} className="space-y-6">
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
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Recevoir le code par
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPasswordlessMethod('email')}
                    className={`px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                      passwordlessMethod === 'email'
                        ? 'border-gold-500 bg-gold-500/10 text-gold-400'
                        : 'border-slate-600 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    <svg className="w-5 h-5 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => setPasswordlessMethod('sms')}
                    className={`px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                      passwordlessMethod === 'sms'
                        ? 'border-gold-500 bg-gold-500/10 text-gold-400'
                        : 'border-slate-600 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    <svg className="w-5 h-5 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    SMS
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                isLoading={isLoading}
                loadingText="Envoi du code..."
              >
                Envoyer le code
              </Button>

              <button
                type="button"
                onClick={switchLoginMode}
                className="w-full text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                Utiliser mon mot de passe
              </button>
            </form>
          )}

          {/* Passwordless Verify */}
          {step === 'passwordless_verify' && (
            <form onSubmit={handlePasswordlessVerify} className="space-y-6">
              <div className="text-center mb-4">
                <div className="w-16 h-16 rounded-full bg-gold-500/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {passwordlessMethod === 'email' ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    )}
                  </svg>
                </div>
                <p className="text-sm text-slate-400">
                  Entrez le code à 6 chiffres envoyé à<br />
                  <span className="text-gold-400 font-medium">{formData.identifier}</span>
                </p>
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
                  value={formData.otpCode}
                  onChange={(e) => setFormData({ ...formData, otpCode: e.target.value.replace(/\D/g, '') })}
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
                disabled={formData.otpCode.length !== 6}
              >
                Vérifier et se connecter
              </Button>

              <div className="text-center">
                {countdown > 0 ? (
                  <p className="text-sm text-slate-500">
                    Renvoyer le code dans {countdown}s
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={handleResendCode}
                    disabled={isLoading}
                    className="text-sm text-gold-400 hover:text-gold-300 transition-colors"
                  >
                    Renvoyer le code
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setStep('passwordless_request');
                  setFormData({ ...formData, otpCode: '' });
                }}
                className="w-full text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                Changer d'identifiant
              </button>
            </form>
          )}

          {/* Passwordless 2FA */}
          {step === 'passwordless_2fa' && (
            <form onSubmit={handlePasswordlessVerify} className="space-y-5">
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
                  setStep('passwordless_verify');
                  setFormData({ ...formData, totpCode: '' });
                }}
                className="w-full text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                Retour
              </button>
            </form>
          )}

          {/* 2FA Setup */}
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

          {/* 2FA Verify (password login) */}
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
