import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminStore } from '../stores/auth';
import { adminApi, type ProducerProfile } from '../lib/api';

const statusBadge: Record<string, string> = {
  SUBMITTED: 'badge-warning',
  PROCESSING: 'badge-warning',
  VERIFIED: 'badge-success',
  REJECTED: 'badge-error',
};

const statusLabels: Record<string, string> = {
  SUBMITTED: 'À examiner',
  PROCESSING: 'En cours',
  VERIFIED: 'Validé',
  REJECTED: 'Rejeté',
};

const entityLabels: Record<string, string> = {
  INDIVIDUAL: 'Orpailleur',
  COOPERATIVE: 'Coopérative',
  COMPANY: 'Société',
};

const FILTERS = ['', 'SUBMITTED', 'VERIFIED', 'REJECTED'];

export default function Producers() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAdminStore();
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<ProducerProfile | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['producer-profiles', status],
    queryFn: () => adminApi.getProducerProfiles(status || undefined),
  });
  const items = data?.data?.items || [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['producer-profiles'] });
    setSelected(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dossiers producteurs</h1>
        <p className="text-sm text-slate-500 mt-1">
          Valider un dossier accorde au producteur le niveau KYC qui lui permet de consigner un lot
          et d'en vendre les tokens.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            onClick={() => setStatus(f)}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              status === f ? 'bg-gold-500 text-black' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
            }`}
          >
            {f ? statusLabels[f] : 'Tous'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-slate-500 text-center py-8">Chargement…</div>
      ) : items.length === 0 ? (
        <div className="text-slate-500 text-center py-8">Aucun dossier</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 px-3">Raison sociale</th>
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3">RCCM</th>
                <th className="py-2 px-3">Représentant</th>
                <th className="py-2 px-3">Statut</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className="border-b border-slate-100 dark:border-slate-800/60 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <td className="py-2 px-3 text-slate-900 dark:text-slate-100">{p.legal_name}</td>
                  <td className="py-2 px-3 text-slate-500">{entityLabels[p.entity_type] ?? p.entity_type}</td>
                  <td className="py-2 px-3 font-mono text-xs text-slate-500">{p.registration_number || '—'}</td>
                  <td className="py-2 px-3 text-slate-500">{p.representative_name}</td>
                  <td className="py-2 px-3">
                    <span className={statusBadge[p.status]}>{statusLabels[p.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <ReviewPanel
          profile={selected}
          canApprove={hasPermission('kyc', 'approve')}
          canReject={hasPermission('kyc', 'reject')}
          onClose={() => setSelected(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}

function ReviewPanel({
  profile,
  canApprove,
  canReject,
  onClose,
  onDone,
}: {
  profile: ProducerProfile;
  canApprove: boolean;
  canReject: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const decided = profile.status === 'VERIFIED' || profile.status === 'REJECTED';

  const approve = useMutation({
    mutationFn: () => adminApi.approveProducerProfile(profile.id),
    onSuccess: onDone,
  });
  const reject = useMutation({
    mutationFn: () => adminApi.rejectProducerProfile(profile.id, reason.trim() || 'Dossier incomplet'),
    onSuccess: onDone,
  });

  let documentCount = 0;
  try {
    documentCount = profile.documents ? (JSON.parse(profile.documents) as string[]).length : 0;
  } catch {
    documentCount = 0;
  }

  const rows: Array<[string, string | null]> = [
    ['Type', entityLabels[profile.entity_type] ?? profile.entity_type],
    ['RCCM', profile.registration_number],
    ['Autorisation d\'exploitation', profile.mining_authorization],
    ['IFU', profile.tax_id],
    ['Représentant', profile.representative_name],
    ['Qualité', profile.representative_role],
    ['Téléphone', profile.representative_phone],
    ['Adresse', [profile.address, profile.city, profile.region].filter(Boolean).join(', ') || null],
    ['Compte utilisateur', profile.user_id],
    ['Pièces jointes', String(documentCount)],
  ];

  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{profile.legal_name}</h2>
          <span className={statusBadge[profile.status]}>{statusLabels[profile.status]}</span>
        </div>
        <button className="text-slate-400 hover:text-slate-200" onClick={onClose}>
          Fermer
        </button>
      </div>

      <dl className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map(([label, value]) => (
          <div key={label} className="py-2 flex justify-between gap-4 text-sm">
            <dt className="text-slate-500">{label}</dt>
            <dd className="text-slate-900 dark:text-slate-100 text-right break-all">
              {value || <span className="text-slate-400">—</span>}
            </dd>
          </div>
        ))}
      </dl>

      {documentCount > 0 && (
        <p className="text-xs text-slate-500">
          Les pièces sont chiffrées au repos et ne sont pas exposées par l'API. Consultation via la
          procédure de conformité.
        </p>
      )}

      {profile.status === 'REJECTED' && profile.rejection_reason && (
        <p className="text-sm text-red-500">Motif : {profile.rejection_reason}</p>
      )}

      {decided ? (
        <p className="text-sm text-slate-500">
          Dossier déjà traité. Le producteur doit renvoyer un dossier pour une nouvelle décision.
        </p>
      ) : (
        <div className="space-y-3">
          {(approve.isError || reject.isError) && (
            <p className="text-sm text-red-500">
              {((approve.error || reject.error) as Error)?.message || 'Opération impossible'}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary"
              disabled={!canApprove || approve.isPending}
              onClick={() => approve.mutate()}
            >
              {approve.isPending ? 'Validation…' : 'Valider le dossier'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              className="input flex-1 min-w-[200px]"
              placeholder="Motif du rejet"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button
              className="btn-secondary"
              disabled={!canReject || reject.isPending}
              onClick={() => reject.mutate()}
            >
              {reject.isPending ? 'Rejet…' : 'Rejeter'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
