import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatGrams } from '../lib/formatters';

type ActiveSection = 'none' | '2fa-setup' | '2fa-disable' | 'password' | 'price-alert' | 'delete-account';

interface TwoFactorData {
  secret: string;
  qrCodeUrl: string;
}

interface PriceAlert {
  id: string;
  alertType: 'ABOVE' | 'BELOW';
  targetPrice: number;
  currency: 'XOF' | 'USD';
  notificationMethod: 'PUSH' | 'EMAIL' | 'SMS' | 'ALL';
  isActive: boolean;
  triggered: boolean;
  triggeredAt: string | null;
  triggeredPrice: number | null;
  note: string | null;
  createdAt: string;
}

export default function Settings() {
  const { user, isAuthenticated, logout, updateUser } = useAuthStore();
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<ActiveSection>('none');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 2FA state
  const [twoFactorData, setTwoFactorData] = useState<TwoFactorData | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  // Password state
  const [passwordData, setPasswordData] = useState({
    current: '',
    new: '',
    confirm: '',
  });

  // Price alert state
  const [newAlert, setNewAlert] = useState({
    alertType: 'ABOVE' as 'ABOVE' | 'BELOW',
    targetPrice: '',
    notificationMethod: 'EMAIL' as 'PUSH' | 'EMAIL' | 'SMS' | 'ALL',
    note: '',
  });

  // Wallet query for delete account check
  const { data: walletData } = useQuery({
    queryKey: ['wallet'],
    queryFn: () => api.getWallet(),
    enabled: isAuthenticated,
  });

  const wallet = walletData?.data;
  const canDeleteAccount = (wallet?.tokenBalance || 0) === 0 && (wallet?.cashBalance || 0) === 0;

  // Notifications query
  const { data: notificationPrefs, isLoading: notifLoading } = useQuery({
    queryKey: ['notificationPreferences'],
    queryFn: async () => {
      const response = await api.getNotificationPreferences();
      return response.data;
    },
    enabled: isAuthenticated,
  });

  // Notifications mutation
  const updateNotificationsMutation = useMutation({
    mutationFn: (prefs: { email?: boolean; sms?: boolean; priceAlerts?: boolean; transactionAlerts?: boolean; marketingEmails?: boolean }) =>
      api.updateNotificationPreferences(prefs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationPreferences'] });
    },
  });

  // Price alerts query
  const { data: priceAlertsData, isLoading: alertsLoading } = useQuery({
    queryKey: ['priceAlerts'],
    queryFn: async () => {
      const response = await api.getPriceAlerts(true);
      return response.data;
    },
    enabled: isAuthenticated,
  });

  // Price alerts mutations
  const createAlertMutation = useMutation({
    mutationFn: (data: { alertType: 'ABOVE' | 'BELOW'; targetPrice: number; notificationMethod?: 'PUSH' | 'EMAIL' | 'SMS' | 'ALL'; note?: string }) =>
      api.createPriceAlert(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['priceAlerts'] });
      closeSection();
      setSuccess('Alerte de prix créée avec succès');
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const toggleAlertMutation = useMutation({
    mutationFn: ({ alertId, isActive }: { alertId: string; isActive: boolean }) =>
      api.updatePriceAlert(alertId, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['priceAlerts'] });
    },
  });

  const deleteAlertMutation = useMutation({
    mutationFn: (alertId: string) => api.deletePriceAlert(alertId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['priceAlerts'] });
      setSuccess('Alerte supprimée');
    },
  });

  // Delete account mutation
  const deleteAccountMutation = useMutation({
    mutationFn: (password: string) => api.deleteAccount(password),
    onSuccess: () => {
      logout();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Delete account state
  const [deletePassword, setDeletePassword] = useState('');

  // Local notifications state (synced with server)
  const [notifications, setNotifications] = useState({
    email: true,
    sms: true,
    priceAlerts: false,
    transactionAlerts: true,
    marketingEmails: false,
  });

  // Sync local state with server data
  useEffect(() => {
    if (notificationPrefs) {
      setNotifications({
        email: notificationPrefs.email,
        sms: notificationPrefs.sms,
        priceAlerts: notificationPrefs.priceAlerts,
        transactionAlerts: notificationPrefs.transactionAlerts ?? true,
        marketingEmails: notificationPrefs.marketingEmails ?? false,
      });
    }
  }, [notificationPrefs]);

  // Handle notification toggle
  const handleNotificationChange = async (key: 'email' | 'sms' | 'priceAlerts' | 'transactionAlerts' | 'marketingEmails', value: boolean) => {
    const newPrefs = { ...notifications, [key]: value };
    setNotifications(newPrefs);

    try {
      await updateNotificationsMutation.mutateAsync({ [key]: value });
    } catch {
      // Revert on error
      setNotifications(notifications);
    }
  };

  const handleSetup2FA = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await api.setup2FAProfile();
      setTwoFactorData(response.data);
      setActiveSection('2fa-setup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la configuration');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await api.verify2FA(totpCode);
      setBackupCodes(response.data.backupCodes);
      updateUser({ twoFactorEnabled: true });
      setSuccess('2FA activé avec succès !');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code invalide');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      await api.disable2FA(totpCode);
      updateUser({ twoFactorEnabled: false });
      closeSection();
      setSuccess('2FA désactivé avec succès');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code invalide');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (passwordData.new !== passwordData.confirm) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    if (passwordData.new.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await api.changePassword(passwordData.current, passwordData.new);
      closeSection();
      setSuccess('Mot de passe modifié avec succès');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la modification');
    } finally {
      setIsLoading(false);
    }
  };

  const closeSection = () => {
    setActiveSection('none');
    setError('');
    setTotpCode('');
    setBackupCodes([]);
    setTwoFactorData(null);
    setPasswordData({ current: '', new: '', confirm: '' });
    setNewAlert({ alertType: 'ABOVE', targetPrice: '', notificationMethod: 'EMAIL', note: '' });
    setDeletePassword('');
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canDeleteAccount) return;
    deleteAccountMutation.mutate(deletePassword);
  };

  const handleCreatePriceAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const targetPrice = parseFloat(newAlert.targetPrice);
    if (isNaN(targetPrice) || targetPrice <= 0) {
      setError('Veuillez entrer un prix valide');
      return;
    }

    createAlertMutation.mutate({
      alertType: newAlert.alertType,
      targetPrice,
      notificationMethod: newAlert.notificationMethod,
      note: newAlert.note || undefined,
    });
  };

  const priceAlerts: PriceAlert[] = priceAlertsData?.items || [];

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-white tracking-tight">Paramètres</h1>

      {success && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm">
          {success}
        </div>
      )}

      {/* 2FA Setup Section */}
      {activeSection === '2fa-setup' && (
        <div className="card border-2 border-gold-500/30">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">Configuration 2FA</h2>
            <button
              onClick={closeSection}
              className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {backupCodes.length > 0 ? (
            <div className="space-y-4">
              <div className="p-4 bg-yellow-500/20 border border-yellow-500/50 rounded-lg">
                <p className="text-yellow-400 text-sm font-medium mb-2">
                  Sauvegardez ces codes de secours !
                </p>
                <p className="text-yellow-400/80 text-xs">
                  Ces codes vous permettront d'accéder à votre compte si vous perdez votre application d'authentification.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 p-4 bg-slate-900 rounded-lg font-mono text-sm">
                {backupCodes.map((code, i) => (
                  <div key={i} className="text-center py-1">{code}</div>
                ))}
              </div>
              <Button variant="primary" fullWidth onClick={closeSection}>
                J'ai sauvegardé mes codes
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-400">
                Scannez ce QR code avec votre application d'authentification (Google Authenticator, Authy, etc.)
              </p>

              {twoFactorData && (
                <div className="flex justify-center p-4 bg-white rounded-lg">
                  <img
                    src={twoFactorData.qrCodeUrl}
                    alt="QR Code 2FA"
                    className="w-48 h-48"
                  />
                </div>
              )}

              <div className="p-3 bg-slate-900 rounded-lg">
                <p className="text-xs text-slate-400 mb-1">Clé secrète (si vous ne pouvez pas scanner) :</p>
                <code className="text-xs font-mono text-amber-400 break-all">
                  {twoFactorData?.secret}
                </code>
              </div>

              {error && (
                <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleVerify2FA} className="space-y-4">
                <div>
                  <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                    Code de vérification
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    className="input text-center text-2xl tracking-widest"
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    required
                  />
                </div>
                <div className="flex gap-3">
                  <Button variant="secondary" className="flex-1" type="button" onClick={closeSection}>
                    Annuler
                  </Button>
                  <Button
                    variant="primary"
                    className="flex-1"
                    type="submit"
                    disabled={totpCode.length !== 6}
                    isLoading={isLoading}
                    loadingText="Vérification..."
                  >
                    Verifier
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* 2FA Disable Section */}
      {activeSection === '2fa-disable' && (
        <div className="card border-2 border-red-500/30">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-red-400">Désactiver 2FA</h2>
            <button
              onClick={closeSection}
              className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-sm text-slate-400 mb-4">
            Pour désactiver l'authentification à deux facteurs, entrez un code de votre application.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleDisable2FA} className="space-y-4">
            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                Code 2FA
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                className="input text-center text-2xl tracking-widest"
                placeholder="000000"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                required
              />
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" type="button" onClick={closeSection}>
                Annuler
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                type="submit"
                disabled={totpCode.length !== 6}
                isLoading={isLoading}
                loadingText="Désactivation..."
              >
                Desactiver
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Password Change Section */}
      {activeSection === 'password' && (
        <div className="card border-2 border-gold-500/30">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">Modifier le mot de passe</h2>
            <button
              onClick={closeSection}
              className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                Mot de passe actuel
              </label>
              <input
                type="password"
                className="input"
                value={passwordData.current}
                onChange={(e) => setPasswordData({ ...passwordData, current: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                Nouveau mot de passe
              </label>
              <input
                type="password"
                className="input"
                placeholder="Min. 8 caractères"
                value={passwordData.new}
                onChange={(e) => setPasswordData({ ...passwordData, new: e.target.value })}
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                Confirmer le mot de passe
              </label>
              <input
                type="password"
                className="input"
                value={passwordData.confirm}
                onChange={(e) => setPasswordData({ ...passwordData, confirm: e.target.value })}
                required
              />
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" type="button" onClick={closeSection}>
                Annuler
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                type="submit"
                isLoading={isLoading}
                loadingText="Modification..."
              >
                Modifier
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Price Alert Section */}
      {activeSection === 'price-alert' && (
        <div className="card border-2 border-gold-500/30">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">Nouvelle alerte de prix</h2>
            <button
              onClick={closeSection}
              className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-sm text-slate-400 mb-4">
            Configurez une alerte pour être notifié quand le prix de l'or atteint un certain seuil.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleCreatePriceAlert} className="space-y-4">
            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                Type d'alerte
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setNewAlert({ ...newAlert, alertType: 'ABOVE' })}
                  className={`p-3 rounded-lg border-2 transition-colors ${
                    newAlert.alertType === 'ABOVE'
                      ? 'border-green-500 bg-emerald-500/10 text-emerald-400'
                      : 'border-slate-600 hover:border-slate-500'
                  }`}
                >
                  <div className="text-lg mb-1">↑</div>
                  <div className="text-sm font-medium">Au-dessus de</div>
                </button>
                <button
                  type="button"
                  onClick={() => setNewAlert({ ...newAlert, alertType: 'BELOW' })}
                  className={`p-3 rounded-lg border-2 transition-colors ${
                    newAlert.alertType === 'BELOW'
                      ? 'border-red-500 bg-red-500/10 text-red-400'
                      : 'border-slate-600 hover:border-slate-500'
                  }`}
                >
                  <div className="text-lg mb-1">↓</div>
                  <div className="text-sm font-medium">En-dessous de</div>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                Prix cible (FCFA/g)
              </label>
              <input
                type="number"
                className="input"
                placeholder="Ex: 45000"
                value={newAlert.targetPrice}
                onChange={(e) => setNewAlert({ ...newAlert, targetPrice: e.target.value })}
                required
                min="1"
                step="100"
              />
              <p className="text-xs text-slate-500 mt-1">
                Prix actuel: ~{priceAlertsData?.currentPrice?.buyPrice?.toLocaleString() || '...'} FCFA/g
              </p>
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                Mode de notification
              </label>
              <select
                className="input"
                value={newAlert.notificationMethod}
                onChange={(e) => setNewAlert({ ...newAlert, notificationMethod: e.target.value as 'PUSH' | 'EMAIL' | 'SMS' | 'ALL' })}
              >
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
                <option value="PUSH">Push</option>
                <option value="ALL">Tous</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                Note (optionnel)
              </label>
              <input
                type="text"
                className="input"
                placeholder="Ex: Acheter si le prix baisse"
                value={newAlert.note}
                onChange={(e) => setNewAlert({ ...newAlert, note: e.target.value })}
                maxLength={200}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="secondary" className="flex-1" type="button" onClick={closeSection}>
                Annuler
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                type="submit"
                disabled={!newAlert.targetPrice}
                isLoading={createAlertMutation.isPending}
                loadingText="Création..."
              >
                Créer l'alerte
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Account Section */}
      {activeSection === 'delete-account' && (
        <div className="card border-2 border-red-500/50">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-red-400">Supprimer le compte</h2>
            <button
              onClick={closeSection}
              className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-4 bg-red-500/20 border border-red-500/50 rounded-lg mb-4">
            <p className="text-red-400 text-sm font-medium mb-2">
              Attention : Cette action est irréversible !
            </p>
            <p className="text-red-400/80 text-xs">
              Toutes vos données seront définitivement supprimées. Vous ne pourrez pas récupérer votre compte.
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleDeleteAccount} className="space-y-4">
            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                Confirmez avec votre mot de passe
              </label>
              <input
                type="password"
                className="input"
                placeholder="Votre mot de passe"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                required
              />
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" type="button" onClick={closeSection}>
                Annuler
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                type="submit"
                disabled={!deletePassword}
                isLoading={deleteAccountMutation.isPending}
                loadingText="Suppression..."
              >
                Supprimer definitivement
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Security Section */}
      {activeSection === 'none' && (
        <>
          <div className="card">
            <h2 className="text-sm font-semibold text-white mb-6">Sécurité</h2>
            <div className="space-y-4">
              {/* 2FA */}
              <div className="flex items-center justify-between p-3 bg-slate-800/40 rounded-xl">
                <div>
                  <p className="font-medium">Authentification 2FA</p>
                  <p className="text-sm text-slate-400">Sécurisez votre compte avec un code à usage unique</p>
                  {user?.twoFactorEnabled && (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-400 mt-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Active
                    </span>
                  )}
                </div>
                <Button
                  variant={user?.twoFactorEnabled ? 'danger' : 'primary'}
                  onClick={user?.twoFactorEnabled ? () => setActiveSection('2fa-disable') : handleSetup2FA}
                  isLoading={isLoading}
                  loadingText="Chargement..."
                >
                  {user?.twoFactorEnabled ? 'Désactiver' : 'Activer'}
                </Button>
              </div>

              {/* Password */}
              <div className="flex items-center justify-between p-3 bg-slate-800/40 rounded-xl">
                <div>
                  <p className="font-medium">Mot de passe</p>
                  <p className="text-sm text-slate-400">Modifiez votre mot de passe</p>
                </div>
                <Button variant="secondary" onClick={() => setActiveSection('password')}>
                  Modifier
                </Button>
              </div>
            </div>
          </div>

          {/* Verification Status */}
          <div className="card">
            <h2 className="text-sm font-semibold text-white mb-6">Vérification</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-slate-800/40 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${user?.emailVerified ? 'bg-emerald-500' : 'bg-yellow-500'}`} />
                  <div>
                    <p className="font-medium">Email</p>
                    <p className="text-sm text-slate-400">{user?.email}</p>
                  </div>
                </div>
                <span className={`text-sm ${user?.emailVerified ? 'text-emerald-400' : 'text-yellow-400'}`}>
                  {user?.emailVerified ? 'Vérifié' : 'Non vérifié'}
                </span>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-800/40 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${user?.phoneVerified ? 'bg-emerald-500' : 'bg-yellow-500'}`} />
                  <div>
                    <p className="font-medium">Téléphone</p>
                    <p className="text-sm text-slate-400">{user?.phone}</p>
                  </div>
                </div>
                <span className={`text-sm ${user?.phoneVerified ? 'text-emerald-400' : 'text-yellow-400'}`}>
                  {user?.phoneVerified ? 'Vérifié' : 'Non vérifié'}
                </span>
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="card">
            <h2 className="text-sm font-semibold text-white mb-6">Notifications</h2>
            {notifLoading ? (
              <div className="flex justify-center py-4">
                <div className="w-6 h-6 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="space-y-4">
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <span>Notifications par email</span>
                    {updateNotificationsMutation.isPending && (
                      <div className="w-4 h-4 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={notifications.email}
                    onChange={(e) => handleNotificationChange('email', e.target.checked)}
                    disabled={updateNotificationsMutation.isPending}
                    className="w-5 h-5 accent-gold-500 disabled:opacity-50"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <span>Notifications SMS</span>
                    {updateNotificationsMutation.isPending && (
                      <div className="w-4 h-4 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={notifications.sms}
                    onChange={(e) => handleNotificationChange('sms', e.target.checked)}
                    disabled={updateNotificationsMutation.isPending}
                    className="w-5 h-5 accent-gold-500 disabled:opacity-50"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <span>Alertes de prix</span>
                    {updateNotificationsMutation.isPending && (
                      <div className="w-4 h-4 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={notifications.priceAlerts}
                    onChange={(e) => handleNotificationChange('priceAlerts', e.target.checked)}
                    disabled={updateNotificationsMutation.isPending}
                    className="w-5 h-5 accent-gold-500 disabled:opacity-50"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <span>Alertes de transactions</span>
                    {updateNotificationsMutation.isPending && (
                      <div className="w-4 h-4 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={notifications.transactionAlerts}
                    onChange={(e) => handleNotificationChange('transactionAlerts', e.target.checked)}
                    disabled={updateNotificationsMutation.isPending}
                    className="w-5 h-5 accent-gold-500 disabled:opacity-50"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <span>Emails marketing</span>
                    {updateNotificationsMutation.isPending && (
                      <div className="w-4 h-4 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={notifications.marketingEmails}
                    onChange={(e) => handleNotificationChange('marketingEmails', e.target.checked)}
                    disabled={updateNotificationsMutation.isPending}
                    className="w-5 h-5 accent-gold-500 disabled:opacity-50"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Price Alerts */}
          <div className="card">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-sm font-semibold text-white">Alertes de prix</h2>
                <p className="text-sm text-slate-400">Recevez une notification quand le prix atteint un seuil</p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setActiveSection('price-alert')}
              >
                + Nouvelle alerte
              </Button>
            </div>

            {alertsLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-8 h-8 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : priceAlerts.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-xl bg-slate-800/60 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </div>
                <p className="text-sm text-slate-500">Aucune alerte de prix configurée</p>
                <p className="text-sm text-slate-500 mt-1">Créez une alerte pour être notifié des variations de prix</p>
              </div>
            ) : (
              <div className="space-y-3">
                {priceAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`flex items-center justify-between p-4 rounded-lg ${
                      alert.triggered
                        ? 'bg-gold-500/10 border border-gold-500/30'
                        : alert.isActive
                        ? 'bg-slate-900/50'
                        : 'bg-slate-900/30 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        alert.alertType === 'ABOVE' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                      }`}>
                        {alert.alertType === 'ABOVE' ? '↑' : '↓'}
                      </div>
                      <div>
                        <p className="font-medium">
                          {alert.alertType === 'ABOVE' ? 'Au-dessus de' : 'En-dessous de'}{' '}
                          <span className="text-gold-400">{alert.targetPrice.toLocaleString()} {alert.currency}</span>
                        </p>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span>Notification: {alert.notificationMethod === 'ALL' ? 'Toutes' : alert.notificationMethod}</span>
                          {alert.note && <span>- {alert.note}</span>}
                        </div>
                        {alert.triggered && (
                          <p className="text-xs text-gold-400 mt-1">
                            Déclenchée le {new Date(alert.triggeredAt!).toLocaleDateString('fr-FR')} à {alert.triggeredPrice?.toLocaleString()} FCFA
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!alert.triggered && (
                        <button
                          onClick={() => toggleAlertMutation.mutate({ alertId: alert.id, isActive: !alert.isActive })}
                          disabled={toggleAlertMutation.isPending}
                          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                            alert.isActive
                              ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                              : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                          }`}
                        >
                          {alert.isActive ? 'Active' : 'Inactive'}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (confirm('Supprimer cette alerte ?')) {
                            deleteAlertMutation.mutate(alert.id);
                          }
                        }}
                        disabled={deleteAlertMutation.isPending}
                        className="p-2 text-slate-400 hover:text-red-400 transition-colors"
                        title="Supprimer"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Danger Zone */}
          <div className="card border-red-500/30">
            <h2 className="text-sm font-semibold text-red-400 mb-4">Zone de danger</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-slate-800/40 rounded-xl">
                <div>
                  <p className="font-medium">Déconnexion</p>
                  <p className="text-sm text-slate-400">Se déconnecter de votre compte</p>
                </div>
                <Button variant="danger" onClick={() => logout()}>
                  Deconnexion
                </Button>
              </div>

              <div className="flex items-center justify-between p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                <div>
                  <p className="font-medium text-red-400">Supprimer le compte</p>
                  <p className="text-sm text-slate-400">
                    {canDeleteAccount
                      ? 'Supprimez définitivement votre compte et toutes vos données'
                      : 'Vous devez d\'abord solder votre compte (retirer tous vos FCFA et vendre tous vos tokens)'}
                  </p>
                  {!canDeleteAccount && (
                    <div className="mt-2 text-xs space-y-1">
                      {(wallet?.tokenBalance || 0) > 0 && (
                        <p className="text-yellow-400">Solde or: {formatGrams(wallet?.tokenBalance || 0)}</p>
                      )}
                      {(wallet?.cashBalance || 0) > 0 && (
                        <p className="text-yellow-400">Solde FCFA: {formatCurrency(wallet?.cashBalance || 0, 'XOF')}</p>
                      )}
                    </div>
                  )}
                </div>
                <Button
                  variant="danger"
                  onClick={() => setActiveSection('delete-account')}
                  disabled={!canDeleteAccount}
                >
                  Supprimer
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
