import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { SessionList } from '../components/security/SessionCard';

type ActiveSection = 'none' | 'password' | '2fa' | 'phone-verify';

export default function Profile() {
  const { user, tokens, setUser } = useAuthStore();
  const queryClient = useQueryClient();

  // Active section state (replaces modal states)
  const [activeSection, setActiveSection] = useState<ActiveSection>('none');

  // Edit states
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verificationCode, setVerificationCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Sessions query
  const { data: sessionsData } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return api.getSessions(tokens.accessToken);
    },
    enabled: !!tokens?.accessToken,
  });

  const sessions = sessionsData?.data?.sessions || [];

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      if (newPassword !== confirmPassword) {
        throw new Error('Les mots de passe ne correspondent pas');
      }
      if (newPassword.length < 8) {
        throw new Error('Le mot de passe doit contenir au moins 8 caractères');
      }
      return api.changePassword(currentPassword, newPassword, tokens.accessToken);
    },
    onSuccess: () => {
      closeSection();
      setSuccess('Mot de passe modifié avec succès');
      setTimeout(() => setSuccess(''), 3000);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Setup 2FA mutation
  const setup2FAMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return api.setup2FAProfile(tokens.accessToken);
    },
    onSuccess: (data) => {
      setQrCodeUrl(data.data.qrCodeUrl);
      setSecret(data.data.secret);
      setActiveSection('2fa');
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Verify 2FA mutation
  const verify2FAMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return api.verify2FA(totpCode, tokens.accessToken);
    },
    onSuccess: (data) => {
      setBackupCodes(data.data.backupCodes);
      if (user) {
        setUser({ ...user, twoFactorEnabled: true });
      }
      setSuccess('2FA activé avec succès');
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Disable 2FA mutation
  const disable2FAMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return api.disable2FA(totpCode, tokens.accessToken);
    },
    onSuccess: () => {
      if (user) {
        setUser({ ...user, twoFactorEnabled: false });
      }
      closeSection();
      setSuccess('2FA désactivé avec succès');
      setTimeout(() => setSuccess(''), 3000);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Revoke session mutation
  const revokeSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return api.revokeSession(sessionId, tokens.accessToken);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setSuccess('Session révoquée');
      setTimeout(() => setSuccess(''), 3000);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Revoke all sessions mutation
  const revokeAllSessionsMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return api.revokeAllSessions(tokens.accessToken);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setSuccess('Toutes les sessions ont été révoquées');
      setTimeout(() => setSuccess(''), 3000);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Update phone mutation
  const updatePhoneMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      const fullPhone = newPhone.startsWith('+') ? newPhone : `+226${newPhone}`;
      return api.updateProfile({ phone: fullPhone }, tokens.accessToken);
    },
    onSuccess: () => {
      if (user) {
        const fullPhone = newPhone.startsWith('+') ? newPhone : `+226${newPhone}`;
        setUser({ ...user, phone: fullPhone, phoneVerified: false });
      }
      setIsEditingPhone(false);
      setNewPhone('');
      setSuccess('Numéro de téléphone mis à jour. Veuillez le vérifier.');
      setTimeout(() => setSuccess(''), 5000);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Send phone verification code mutation
  const sendPhoneCodeMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      if (!user?.phone) throw new Error('Numéro de téléphone non défini');
      return api.sendPhoneVerification(user.phone, tokens.accessToken);
    },
    onSuccess: () => {
      setActiveSection('phone-verify');
      setSuccess('Code envoyé par SMS');
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Verify phone mutation
  const verifyPhoneMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return api.verifyPhone(verificationCode, tokens.accessToken);
    },
    onSuccess: () => {
      if (user) {
        setUser({ ...user, phoneVerified: true });
      }
      closeSection();
      setSuccess('Numéro de téléphone vérifié avec succès');
      setTimeout(() => setSuccess(''), 5000);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const closeSection = () => {
    setActiveSection('none');
    setError('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setTotpCode('');
    setQrCodeUrl('');
    setSecret('');
    setBackupCodes([]);
    setVerificationCode('');
  };

  const kycLevelLabels: Record<string, { label: string; description: string }> = {
    BASIC: { label: 'Basique', description: 'Consultation uniquement' },
    STANDARD: { label: 'Standard', description: 'Limite: 100g/jour, 500g/mois' },
    VERIFIED: { label: 'Vérifié', description: 'Limite: 1000g/jour, 5000g/mois' },
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-white tracking-tight">Mon Profil</h1>

      {/* Success/Error alerts */}
      {success && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
          {success}
        </div>
      )}
      {error && activeSection === 'none' && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}>×</button>
        </div>
      )}

      {/* Personal Information */}
      <div className="card">
        <h2 className="text-sm font-semibold text-white mb-6">Informations personnelles</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Email</label>
            <div className="flex items-center justify-between">
              <p className="text-lg">{user?.email}</p>
              <span className={`badge ${user?.emailVerified ? 'badge-success' : 'badge-warning'}`}>
                {user?.emailVerified ? 'Vérifié' : 'Non vérifié'}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Téléphone</label>
            {isEditingPhone ? (
              <div className="flex gap-2">
                <div className="flex flex-1">
                  <span className="px-3 py-2 bg-slate-700 border border-r-0 border-slate-600 rounded-l-lg text-slate-400">
                    +226
                  </span>
                  <input
                    type="tel"
                    className="input rounded-l-none flex-1"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="70 00 00 00"
                    maxLength={8}
                  />
                </div>
                <Button
                  variant="primary"
                  onClick={() => updatePhoneMutation.mutate()}
                  disabled={newPhone.length < 8}
                  isLoading={updatePhoneMutation.isPending}
                  loadingText="..."
                >
                  Enregistrer
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setIsEditingPhone(false);
                    setNewPhone('');
                  }}
                >
                  Annuler
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-lg">{user?.phone}</p>
                <div className="flex items-center gap-2">
                  <span className={`badge ${user?.phoneVerified ? 'badge-success' : 'badge-warning'}`}>
                    {user?.phoneVerified ? 'Vérifié' : 'Non vérifié'}
                  </span>
                  {!user?.phoneVerified && user?.phone && (
                    <button
                      className="text-sm text-amber-500 hover:text-amber-400 font-medium"
                      onClick={() => sendPhoneCodeMutation.mutate()}
                      disabled={sendPhoneCodeMutation.isPending}
                    >
                      {sendPhoneCodeMutation.isPending ? '...' : 'Vérifier'}
                    </button>
                  )}
                  <button
                    className="text-sm text-gold-500 hover:text-gold-400"
                    onClick={() => {
                      setIsEditingPhone(true);
                      setNewPhone(user?.phone?.replace('+226', '') || '');
                    }}
                  >
                    Modifier
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Pays</label>
            <p className="text-lg">{user?.country === 'BF' ? 'Burkina Faso' : user?.country}</p>
          </div>
        </div>
      </div>

      {/* Phone Verification Section */}
      {activeSection === 'phone-verify' && (
        <div className="card border-2 border-amber-500/30">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">Vérification du téléphone</h2>
            <button
              onClick={closeSection}
              className="text-slate-400 hover:text-white p-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-slate-400 mb-4">
            Entrez le code à 6 chiffres envoyé à {user?.phone}
          </p>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm mb-4">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <input
              type="text"
              className="input w-full text-center text-2xl tracking-widest"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
              maxLength={6}
              placeholder="000000"
            />

            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={closeSection}
              >
                Annuler
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => verifyPhoneMutation.mutate()}
                disabled={verificationCode.length !== 6}
                isLoading={verifyPhoneMutation.isPending}
                loadingText="Vérification..."
              >
                Vérifier
              </Button>
            </div>

            <button
              className="text-sm text-amber-500 hover:text-amber-400 w-full text-center"
              onClick={() => sendPhoneCodeMutation.mutate()}
              disabled={sendPhoneCodeMutation.isPending}
            >
              Renvoyer le code
            </button>
          </div>
        </div>
      )}

      {/* Account Status */}
      <div className="card">
        <h2 className="text-sm font-semibold text-white mb-6">Statut du compte</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Niveau KYC</label>
            <div className="flex items-center gap-3">
              <span className={`badge ${
                user?.kycLevel === 'VERIFIED' ? 'badge-success' :
                user?.kycLevel === 'STANDARD' ? 'badge-info' : 'badge-warning'
              }`}>
                {kycLevelLabels[user?.kycLevel || 'BASIC']?.label}
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              {kycLevelLabels[user?.kycLevel || 'BASIC']?.description}
            </p>
            {user?.kycLevel !== 'VERIFIED' && (
              <a href="/kyc" className="btn-secondary mt-3 inline-block text-sm">
                Améliorer mon niveau →
              </a>
            )}
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Statut KYC</label>
            <span className={`badge ${
              user?.kycStatus === 'APPROVED' ? 'badge-success' :
              user?.kycStatus === 'SUBMITTED' ? 'badge-info' :
              user?.kycStatus === 'REJECTED' ? 'badge-error' : 'badge-warning'
            }`}>
              {user?.kycStatus === 'APPROVED' ? 'Approuvé' :
               user?.kycStatus === 'SUBMITTED' ? 'En cours de vérification' :
               user?.kycStatus === 'REJECTED' ? 'Rejeté' : 'En attente'}
            </span>
          </div>
        </div>
      </div>

      {/* Security */}
      <div className="card">
        <h2 className="text-sm font-semibold text-white mb-6">Sécurité</h2>
        <div className="space-y-4">
          {/* Password */}
          <div className="flex items-center justify-between p-3 bg-slate-800/40 rounded-xl">
            <div>
              <p className="font-medium">Mot de passe</p>
              <p className="text-sm text-slate-400">Dernière modification: inconnue</p>
            </div>
            <Button
              variant={activeSection === 'password' ? 'primary' : 'secondary'}
              onClick={() => activeSection === 'password' ? closeSection() : setActiveSection('password')}
            >
              {activeSection === 'password' ? 'Fermer' : 'Modifier'}
            </Button>
          </div>

          {/* 2FA */}
          <div className="flex items-center justify-between p-3 bg-slate-800/40 rounded-xl">
            <div>
              <p className="font-medium">Authentification à deux facteurs (2FA)</p>
              <p className="text-sm text-slate-400">
                {user?.twoFactorEnabled
                  ? "Protégé par une application d'authentification"
                  : 'Non activé - recommandé pour plus de sécurité'}
              </p>
            </div>
            {user?.twoFactorEnabled ? (
              <Button
                variant={activeSection === '2fa' ? 'primary' : 'danger'}
                onClick={() => activeSection === '2fa' ? closeSection() : setActiveSection('2fa')}
              >
                {activeSection === '2fa' ? 'Fermer' : 'Désactiver'}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => setup2FAMutation.mutate()}
                isLoading={setup2FAMutation.isPending}
                loadingText="Chargement..."
              >
                Activer
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Password Section */}
      {activeSection === 'password' && (
        <div className="card border-2 border-gold-500/30">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">Modifier le mot de passe</h2>
            <button
              onClick={closeSection}
              className="text-slate-400 hover:text-white p-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm mb-4">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Mot de passe actuel</label>
              <input
                type="password"
                className="input w-full"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Nouveau mot de passe</label>
              <input
                type="password"
                className="input w-full"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Confirmer le mot de passe</label>
              <input
                type="password"
                className="input w-full"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={closeSection}
              >
                Annuler
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => changePasswordMutation.mutate()}
                disabled={!currentPassword || !newPassword}
                isLoading={changePasswordMutation.isPending}
                loadingText="Modification..."
              >
                Modifier
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 2FA Section */}
      {activeSection === '2fa' && (
        <div className="card border-2 border-gold-500/30">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">
              {user?.twoFactorEnabled ? 'Désactiver 2FA' : 'Activer 2FA'}
            </h2>
            <button
              onClick={closeSection}
              className="text-slate-400 hover:text-white p-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm mb-4">
              {error}
            </div>
          )}

          {!user?.twoFactorEnabled && qrCodeUrl && !backupCodes.length && (
            <div className="space-y-4 mb-6">
              <p className="text-sm text-slate-400">
                Scannez ce QR code avec votre application d'authentification (Google Authenticator, Authy, etc.)
              </p>
              <div className="flex justify-center">
                <img src={qrCodeUrl} alt="QR Code 2FA" className="w-48 h-48 bg-white p-2 rounded" />
              </div>
              <div className="p-3 bg-slate-800 rounded-lg">
                <p className="text-xs text-slate-400 mb-1">Code secret (si impossible de scanner)</p>
                <p className="font-mono text-sm break-all text-amber-400">{secret}</p>
              </div>
            </div>
          )}

          {backupCodes.length > 0 && (
            <div className="space-y-4">
              <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                <p className="text-green-400 font-medium mb-2">2FA activé avec succès !</p>
                <p className="text-sm text-slate-400">
                  Sauvegardez ces codes de secours dans un endroit sûr.
                  Ils vous permettront de vous connecter si vous perdez votre téléphone.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {backupCodes.map((code, index) => (
                  <div key={index} className="p-2 bg-slate-800 rounded font-mono text-sm text-center">
                    {code}
                  </div>
                ))}
              </div>
              <Button
                variant="primary"
                fullWidth
                onClick={closeSection}
              >
                J'ai sauvegardé mes codes
              </Button>
            </div>
          )}

          {!backupCodes.length && (
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                  {user?.twoFactorEnabled
                    ? 'Entrez votre code 2FA pour confirmer la désactivation'
                    : "Entrez le code généré par votre application"}
                </label>
                <input
                  type="text"
                  className="input w-full text-center text-2xl tracking-widest"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  maxLength={6}
                  placeholder="000000"
                />
              </div>

              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={closeSection}
                >
                  Annuler
                </Button>
                <Button
                  variant={user?.twoFactorEnabled ? 'danger' : 'primary'}
                  className="flex-1"
                  onClick={() => {
                    if (user?.twoFactorEnabled) {
                      disable2FAMutation.mutate();
                    } else {
                      verify2FAMutation.mutate();
                    }
                  }}
                  disabled={totpCode.length !== 6}
                  isLoading={verify2FAMutation.isPending || disable2FAMutation.isPending}
                  loadingText="Vérification..."
                >
                  {user?.twoFactorEnabled ? 'Désactiver' : 'Vérifier'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sessions */}
      <div className="card">
        <SessionList
          sessions={sessions}
          onRevoke={(sessionId) => revokeSessionMutation.mutate(sessionId)}
          onRevokeAll={() => revokeAllSessionsMutation.mutate()}
          isRevoking={revokeSessionMutation.isPending}
          isRevokingAll={revokeAllSessionsMutation.isPending}
        />
      </div>

      {/* Account Actions */}
      <div className="card border-red-500/30">
        <h2 className="text-sm font-semibold text-red-400 mb-4">Zone de danger</h2>
        <p className="text-sm text-slate-400 mb-4">
          La suppression de votre compte est irréversible. Toutes vos données seront perdues.
        </p>
        <button className="btn-outline text-red-400 border-red-400 hover:bg-red-500/10" disabled>
          Supprimer mon compte
        </button>
      </div>
    </div>
  );
}
