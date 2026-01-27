import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminStore } from '../stores/auth';
import { adminApi } from '../lib/api';

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { tokens } = useAdminStore();
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-user', id],
    queryFn: async () => {
      if (!tokens?.accessToken || !id) throw new Error('Non authentifié');
      return adminApi.getUser(tokens.accessToken, id);
    },
    enabled: !!tokens?.accessToken && !!id,
  });

  const kycMutation = useMutation({
    mutationFn: async ({ action, reason }: { action: 'approve' | 'reject'; reason?: string }) => {
      if (!tokens?.accessToken || !id) throw new Error('Non authentifié');
      return adminApi.updateUserKyc(tokens.accessToken, id, action, reason);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-user', id] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setShowRejectModal(false);
    },
  });

  const user = data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-gold-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Chargement du profil...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-14 h-14 rounded-xl bg-slate-800/60 flex items-center justify-center mb-4">
          <svg className="w-7 h-7 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <p className="text-sm text-slate-500 mb-4">Utilisateur non trouvé</p>
        <button onClick={() => navigate('/users')} className="btn-secondary text-xs">
          Retour à la liste
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/users')}
          className="p-2 rounded-xl hover:bg-slate-800 transition-colors text-slate-400 hover:text-white"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-gold-500 to-gold-700 flex items-center justify-center shadow-lg shadow-gold-500/15">
            <span className="text-white font-bold text-lg">{user.email?.charAt(0).toUpperCase()}</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Détail utilisateur</h1>
            <p className="text-sm text-slate-500">{user.email}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* User Info */}
        <div className="card">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Informations
          </h2>
          <div className="space-y-3">
            {[
              { label: 'Email', value: user.email },
              { label: 'Téléphone', value: user.phone },
              { label: 'Pays', value: user.country },
              { label: 'Inscription', value: new Date(user.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between p-3 rounded-xl bg-slate-800/40">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">{item.label}</span>
                <span className="text-sm font-medium text-white">{item.value}</span>
              </div>
            ))}
            <div className="flex gap-3 pt-2">
              <div className="flex-1 p-3 rounded-xl bg-slate-800/40 text-center">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Email vérifié</p>
                <span className={`badge ${user.emailVerified ? 'badge-success' : 'badge-warning'}`}>
                  {user.emailVerified ? 'Oui' : 'Non'}
                </span>
              </div>
              <div className="flex-1 p-3 rounded-xl bg-slate-800/40 text-center">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">2FA</p>
                <span className={`badge ${user.twoFactorEnabled ? 'badge-success' : 'badge-warning'}`}>
                  {user.twoFactorEnabled ? 'Actif' : 'Inactif'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Wallet */}
        <div className="card">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            Portefeuille
          </h2>
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-gradient-to-br from-gold-500/10 via-gold-500/5 to-transparent border border-gold-500/20 relative overflow-hidden">
              <div className="absolute -top-4 -right-4 w-16 h-16 bg-gold-500/10 rounded-full blur-xl" />
              <div className="relative">
                <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Solde Or</p>
                <p className="text-3xl font-bold text-gold-500 mt-1">
                  {user.wallet.tokenBalance.toFixed(3)} <span className="text-lg">g</span>
                </p>
              </div>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/40">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Solde FCFA</p>
              <p className="text-2xl font-bold text-white mt-1">
                {user.wallet.cashBalance.toLocaleString()} <span className="text-sm text-slate-400">FCFA</span>
              </p>
            </div>
          </div>
        </div>

        {/* KYC */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Vérification KYC
            </h2>
            <div className="flex items-center gap-2">
              <span className={`badge ${
                user.kycLevel === 'VERIFIED' ? 'badge-success' :
                user.kycLevel === 'STANDARD' ? 'badge-info' : 'badge-warning'
              }`}>
                {user.kycLevel}
              </span>
              <span className={`badge ${
                user.kycStatus === 'APPROVED' ? 'badge-success' :
                user.kycStatus === 'REJECTED' ? 'badge-error' : 'badge-warning'
              }`}>
                {user.kycStatus}
              </span>
            </div>
          </div>

          {user.kycDocuments?.length > 0 ? (
            <div className="space-y-3">
              {user.kycDocuments.map((doc: any) => (
                <div key={doc.id} className="flex items-center justify-between p-4 rounded-xl bg-slate-800/40 hover:bg-slate-800/60 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-700/60 flex items-center justify-center">
                      <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{doc.documentType}</p>
                      <p className="text-[10px] text-slate-500">
                        Soumis le {new Date(doc.createdAt).toLocaleDateString('fr-FR')}
                      </p>
                    </div>
                  </div>
                  <span className={`badge ${
                    doc.verificationStatus === 'VERIFIED' ? 'badge-success' :
                    doc.verificationStatus === 'REJECTED' ? 'badge-error' : 'badge-warning'
                  }`}>
                    {doc.verificationStatus}
                  </span>
                </div>
              ))}

              {user.kycStatus === 'SUBMITTED' && (
                <div className="flex gap-3 mt-4 pt-4 border-t border-slate-800/60">
                  <button
                    onClick={() => kycMutation.mutate({ action: 'approve' })}
                    disabled={kycMutation.isPending}
                    className="btn-success flex-1"
                  >
                    {kycMutation.isPending ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        En cours...
                      </span>
                    ) : 'Approuver KYC'}
                  </button>
                  <button
                    onClick={() => setShowRejectModal(true)}
                    disabled={kycMutation.isPending}
                    className="btn-danger flex-1"
                  >
                    Rejeter KYC
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 py-6">
              <div className="w-10 h-10 rounded-xl bg-slate-800/60 flex items-center justify-center">
                <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-sm text-slate-500">Aucun document KYC soumis</p>
            </div>
          )}
        </div>
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="card w-full max-w-md">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Rejeter le KYC</h3>
                <p className="text-xs text-slate-500">{user.email}</p>
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                Raison du rejet
              </label>
              <textarea
                className="input min-h-[100px]"
                placeholder="Raison du rejet..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowRejectModal(false)} className="btn-secondary flex-1">
                Annuler
              </button>
              <button
                onClick={() => kycMutation.mutate({ action: 'reject', reason: rejectReason })}
                disabled={!rejectReason || kycMutation.isPending}
                className="btn-danger flex-1"
              >
                {kycMutation.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    En cours...
                  </span>
                ) : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
