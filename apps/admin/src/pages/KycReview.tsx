import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminStore } from '../stores/auth';
import { adminApi } from '../lib/api';

interface KycSubmission {
  id: string;
  userId: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  documentType: string;
  documentNumber: string;
  frontImageUrl: string;
  backImageUrl: string | null;
  selfieUrl: string;
  submittedAt: string;
  kycLevel: string;
}

type ReviewModal = {
  type: 'approve' | 'reject' | 'view';
  submission: KycSubmission;
} | null;

export default function KycReview() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAdminStore();
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<ReviewModal>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [newLevel, setNewLevel] = useState<'STANDARD' | 'VERIFIED'>('STANDARD');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-pending-kyc', page],
    queryFn: () => adminApi.getPendingKyc(page),
    enabled: isAuthenticated,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ submissionId, action, data }: {
      submissionId: string;
      action: 'approve' | 'reject';
      data: { newLevel?: 'STANDARD' | 'VERIFIED'; rejectionReason?: string };
    }) => adminApi.reviewKyc(submissionId, action, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-pending-kyc'] });
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
      setModal(null);
      setRejectReason('');
    },
  });

  const handleApprove = (submission: KycSubmission) => {
    reviewMutation.mutate({
      submissionId: submission.id,
      action: 'approve',
      data: { newLevel },
    });
  };

  const handleReject = (submission: KycSubmission) => {
    if (!rejectReason.trim()) return;
    reviewMutation.mutate({
      submissionId: submission.id,
      action: 'reject',
      data: { rejectionReason: rejectReason },
    });
  };

  const submissions = data?.data.items || [];
  const total = data?.data.total || 0;
  const hasMore = data?.data.hasMore || false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Vérification KYC</h1>
          <p className="text-sm text-slate-500 mt-1">
            {total} demande{total > 1 ? 's' : ''} en attente de vérification
          </p>
        </div>
        {total > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-xs font-medium text-amber-400">{total} en attente</span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-3 border-gold-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-500">Chargement des demandes...</p>
          </div>
        </div>
      ) : error ? (
        <div className="card text-center py-12">
          <div className="w-14 h-14 rounded-xl bg-red-500/15 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p className="text-sm text-red-400 font-medium">Erreur lors du chargement</p>
          <p className="text-xs text-slate-500 mt-1">Veuillez rafraîchir la page</p>
        </div>
      ) : submissions.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-16 h-16 bg-emerald-500/15 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">Aucune demande en attente</h2>
          <p className="text-sm text-slate-500">Toutes les demandes KYC ont été traitées</p>
        </div>
      ) : (
        <>
          {/* KYC Queue */}
          <div className="grid gap-4">
            {submissions.map((submission) => (
              <div key={submission.id} className="card hover:border-slate-700/80 transition-all duration-200">
                <div className="flex flex-col md:flex-row md:items-start gap-5">
                  {/* Selfie */}
                  <div className="flex-shrink-0">
                    <img
                      src={submission.selfieUrl}
                      alt="Selfie"
                      className="w-20 h-20 rounded-xl object-cover cursor-pointer hover:opacity-80 transition-opacity ring-2 ring-slate-700/60"
                      onClick={() => setModal({ type: 'view', submission })}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="text-base font-semibold text-white">
                        {submission.firstName} {submission.lastName}
                      </h3>
                      <span className="badge badge-warning">{submission.kycLevel}</span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: 'Email', value: submission.email },
                        { label: 'Téléphone', value: submission.phone },
                        { label: 'Document', value: `${submission.documentType} - ${submission.documentNumber}` },
                        { label: 'Date de naissance', value: new Date(submission.dateOfBirth).toLocaleDateString('fr-FR') },
                      ].map((item) => (
                        <div key={item.label} className="p-2.5 rounded-xl bg-slate-800/40">
                          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{item.label}</p>
                          <p className="text-xs font-medium text-slate-300 mt-0.5 truncate">{item.value}</p>
                        </div>
                      ))}
                    </div>

                    <p className="text-[10px] text-slate-600 mt-3">
                      Soumis le {new Date(submission.submittedAt).toLocaleString('fr-FR')}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex md:flex-col gap-2 flex-shrink-0">
                    <button
                      onClick={() => setModal({ type: 'view', submission })}
                      className="btn-secondary text-xs"
                    >
                      <svg className="w-3.5 h-3.5 mr-1.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      Voir
                    </button>
                    <button
                      onClick={() => setModal({ type: 'approve', submission })}
                      className="btn-success text-xs"
                    >
                      Approuver
                    </button>
                    <button
                      onClick={() => setModal({ type: 'reject', submission })}
                      className="btn-danger text-xs"
                    >
                      Rejeter
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {(page > 1 || hasMore) && (
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Precedent
              </button>
              <span className="text-xs text-slate-500 px-3 py-1.5 bg-slate-800/60 rounded-lg">
                Page {page}
              </span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={!hasMore}
                className="btn-secondary flex items-center gap-1.5"
              >
                Suivant
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}

      {/* View Documents Modal */}
      {modal?.type === 'view' && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800/80 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto scrollbar-thin shadow-2xl">
            <div className="sticky top-0 bg-slate-900/95 backdrop-blur-xl border-b border-slate-800/60 p-5 flex items-center justify-between z-10">
              <h3 className="text-base font-semibold text-white">
                Documents - {modal.submission.firstName} {modal.submission.lastName}
              </h3>
              <button
                onClick={() => setModal(null)}
                className="p-2 hover:bg-slate-800 rounded-xl transition-colors"
              >
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Type de document', value: modal.submission.documentType },
                  { label: 'Numéro', value: modal.submission.documentNumber },
                  { label: 'Date de naissance', value: new Date(modal.submission.dateOfBirth).toLocaleDateString('fr-FR') },
                  { label: 'Soumis le', value: new Date(modal.submission.submittedAt).toLocaleString('fr-FR') },
                ].map((item) => (
                  <div key={item.label} className="p-3 rounded-xl bg-slate-800/40">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{item.label}</p>
                    <p className="text-sm font-medium text-white mt-0.5">{item.value}</p>
                  </div>
                ))}
              </div>

              {/* Documents */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Recto du document</h4>
                  <img src={modal.submission.frontImageUrl} alt="Recto" className="w-full rounded-xl border border-slate-700/60" />
                </div>
                {modal.submission.backImageUrl && (
                  <div>
                    <h4 className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Verso du document</h4>
                    <img src={modal.submission.backImageUrl} alt="Verso" className="w-full rounded-xl border border-slate-700/60" />
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Selfie</h4>
                <img src={modal.submission.selfieUrl} alt="Selfie" className="max-w-md rounded-xl border border-slate-700/60" />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t border-slate-800/60">
                <button
                  onClick={() => setModal({ type: 'approve', submission: modal.submission })}
                  className="btn-success flex-1"
                >
                  Approuver
                </button>
                <button
                  onClick={() => setModal({ type: 'reject', submission: modal.submission })}
                  className="btn-danger flex-1"
                >
                  Rejeter
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Approve Modal */}
      {modal?.type === 'approve' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="card max-w-md w-full">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Approuver le KYC</h3>
                <p className="text-xs text-slate-500">{modal.submission.firstName} {modal.submission.lastName}</p>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-2">
                Nouveau niveau KYC
              </label>
              <div className="space-y-2">
                {[
                  { value: 'STANDARD' as const, label: 'STANDARD', desc: '100g/jour, 500g/mois, Retrait 500K FCFA/jour' },
                  { value: 'VERIFIED' as const, label: 'VERIFIED', desc: '1000g/jour, 5000g/mois, Retrait 5M FCFA/jour' },
                ].map((level) => (
                  <label
                    key={level.value}
                    className={`flex items-center gap-3 p-3.5 rounded-xl cursor-pointer transition-all duration-200 border ${
                      newLevel === level.value
                        ? 'bg-gold-500/10 border-gold-500/30'
                        : 'bg-slate-800/40 border-slate-800/60 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="kycLevel"
                      value={level.value}
                      checked={newLevel === level.value}
                      onChange={() => setNewLevel(level.value)}
                      className="w-4 h-4 accent-gold-500"
                    />
                    <div>
                      <span className="text-sm font-semibold text-white">{level.label}</span>
                      <p className="text-[10px] text-slate-500 mt-0.5">{level.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setModal(null)} className="btn-secondary flex-1">Annuler</button>
              <button
                onClick={() => handleApprove(modal.submission)}
                disabled={reviewMutation.isPending}
                className="btn-success flex-1"
              >
                {reviewMutation.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Approbation...
                  </span>
                ) : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {modal?.type === 'reject' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="card max-w-md w-full">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Rejeter le KYC</h3>
                <p className="text-xs text-slate-500">{modal.submission.firstName} {modal.submission.lastName}</p>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
                Raison du rejet
              </label>
              <textarea
                className="input min-h-[100px]"
                placeholder="Document illisible, informations incorrectes..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <p className="text-[10px] text-slate-600 mt-1">
                Cette raison sera communiquée à l'utilisateur
              </p>
            </div>

            <div className="space-y-1.5 mb-6">
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Raisons prédéfinies</p>
              {[
                'Document illisible ou de mauvaise qualité',
                'Informations du document ne correspondent pas',
                'Selfie non conforme (visage non visible)',
                'Document expiré',
                'Document non accepté',
              ].map((reason) => (
                <button
                  key={reason}
                  onClick={() => setRejectReason(reason)}
                  className={`block w-full text-left text-xs p-2.5 rounded-xl transition-all duration-200 border ${
                    rejectReason === reason
                      ? 'bg-red-500/10 border-red-500/20 text-red-400'
                      : 'bg-slate-800/40 border-slate-800/60 text-slate-400 hover:bg-slate-800/60 hover:border-slate-700'
                  }`}
                >
                  {reason}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setModal(null); setRejectReason(''); }}
                className="btn-secondary flex-1"
              >
                Annuler
              </button>
              <button
                onClick={() => handleReject(modal.submission)}
                disabled={!rejectReason.trim() || reviewMutation.isPending}
                className="btn-danger flex-1"
              >
                {reviewMutation.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Rejet...
                  </span>
                ) : 'Confirmer le rejet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
