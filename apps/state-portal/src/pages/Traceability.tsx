import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useStateStore } from '../stores/auth';
import { stateApi, type StateConsignment } from '../lib/api';

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Déclaré',
  FORWARDER_VALIDATED: 'Validé transitaire',
  IN_TRANSIT: 'En transit',
  ARRIVED_DUBAI: 'Arrivé à Dubaï',
  AUDIT_VALIDATED: 'Audité et alloué',
  REJECTED: 'Rejeté',
};

const GOLD_TYPES: Record<string, string> = { nuggets: 'Pépites', powder: 'Poudre', bar: 'Barre' };

const DOC_LABELS: Record<string, string> = {
  CERTIFICATE_OF_ORIGIN: "Certificat d'origine",
  MINING_DECLARATION: 'Déclaration minière',
  TRANSPORT_DOCUMENT: 'Document de transport',
  ASSAY_REPORT: "Rapport d'essai",
  OTHER: 'Autre',
};

const FILTERS = ['', 'SUBMITTED', 'IN_TRANSIT', 'ARRIVED_DUBAI', 'AUDIT_VALIDATED'];

export default function Traceability() {
  const { isAuthenticated } = useStateStore();
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['state-consignments', status],
    queryFn: () => stateApi.getConsignments(status || undefined),
    enabled: isAuthenticated,
  });

  const items = data?.data?.items || [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Traçabilité des lots</h1>
        <p className="text-slate-400 mt-1">
          Origine, parcours et pièces justificatives de chaque lot d'or entré dans la réserve.
        </p>
        <p className="text-slate-500 text-sm mt-2">
          L'identité des producteurs n'est pas exposée : cette vue porte sur le flux d'or, pas sur
          les personnes.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            onClick={() => setStatus(f)}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              status === f ? 'bg-gold-500 text-black' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {f ? STATUS_LABELS[f] : 'Tous'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-slate-500 text-center py-12">Chargement…</div>
      ) : items.length === 0 ? (
        <div className="text-slate-500 text-center py-12">Aucun lot</div>
      ) : (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-800">
                <th className="py-3 px-4">Référence</th>
                <th className="py-3 px-4">Origine</th>
                <th className="py-3 px-4">Déclaré</th>
                <th className="py-3 px-4">Raffiné</th>
                <th className="py-3 px-4">Pièces</th>
                <th className="py-3 px-4">Statut</th>
              </tr>
            </thead>
            <tbody>
              {items.map((lot) => (
                <tr
                  key={lot.id}
                  onClick={() => setSelected(lot.id)}
                  className="border-b border-slate-800/60 cursor-pointer hover:bg-slate-800/40"
                >
                  <td className="py-3 px-4 font-mono text-xs">{lot.reference}</td>
                  <td className="py-3 px-4">
                    <OriginCell lot={lot} />
                  </td>
                  <td className="py-3 px-4">{lot.weight_declared_g.toLocaleString('fr-FR')} g</td>
                  <td className="py-3 px-4 text-slate-400">
                    {lot.refined_weight_g != null ? `${lot.refined_weight_g.toLocaleString('fr-FR')} g` : '—'}
                  </td>
                  <td className="py-3 px-4 text-slate-400">{lot.document_count ?? 0}</td>
                  <td className="py-3 px-4 text-slate-300">{STATUS_LABELS[lot.status] || lot.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <LotDetail id={selected} onClose={() => setSelected(null)} />}

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
        <h2 className="font-semibold">Vérifier la réserve</h2>
        <p className="text-slate-400 text-sm mt-1">
          Les attestations de réserve sont signées, chaînées et publiées. Leur vérification est
          publique et s'exécute dans votre navigateur, sans dépendre de cette plateforme.
        </p>
        <a
          href="/reserve"
          target="_blank"
          rel="noreferrer"
          className="inline-block mt-3 text-gold-500 hover:underline text-sm"
        >
          Ouvrir la page de vérification publique →
        </a>
      </div>
    </div>
  );
}

/**
 * A device fix and a hand-typed zone are not the same evidence, so they are not
 * displayed the same way.
 */
function OriginCell({ lot }: { lot: StateConsignment }) {
  if (lot.origin_gps_lat != null && lot.origin_gps_lng != null) {
    return (
      <div>
        <span className="font-mono text-xs">
          {lot.origin_gps_lat.toFixed(4)}, {lot.origin_gps_lng.toFixed(4)}
        </span>
        <span className={`ml-2 text-xs ${lot.origin_verified ? 'text-emerald-400' : 'text-amber-400'}`}>
          {lot.origin_verified ? 'position relevée' : 'déclarée'}
        </span>
      </div>
    );
  }
  if (lot.origin_zone) {
    return (
      <div>
        <span>{lot.origin_zone}</span>
        <span className="ml-2 text-xs text-amber-400">déclarée</span>
      </div>
    );
  }
  return <span className="text-slate-600">non renseignée</span>;
}

function LotDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['state-consignment', id],
    queryFn: () => stateApi.getConsignment(id),
  });

  if (isLoading || !data?.data) {
    return <div className="text-slate-500 text-center py-8">Chargement…</div>;
  }

  const { consignment, events, documents } = data.data;

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold font-mono">{consignment.reference}</h2>
          <p className="text-slate-400 text-sm">
            {consignment.weight_declared_g.toLocaleString('fr-FR')} g déclarés ·{' '}
            {GOLD_TYPES[consignment.gold_type] || consignment.gold_type} ·{' '}
            {Math.round(consignment.purity_declared * 24)} carats
          </p>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-sm">
          Fermer
        </button>
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
          Pièces d'origine ({documents.length})
        </h3>
        {documents.length === 0 ? (
          <p className="text-amber-400 text-sm">
            Aucune pièce justificative n'est rattachée à ce lot.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {documents.map((d, i) => (
              <li key={i} className="flex justify-between gap-4 text-slate-300">
                <span>{DOC_LABELS[d.doc_type] || d.doc_type}</span>
                <span className="text-slate-500">
                  {[d.issuer, d.reference, d.issued_at].filter(Boolean).join(' · ') || '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-600 mt-2">
          Seules les références sont exposées ici. Les pièces elles-mêmes restent chiffrées.
        </p>
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Parcours</h3>
        <ol className="space-y-2">
          {events.map((e, i) => (
            <li key={i} className="text-sm text-slate-300">
              <span className="text-slate-100">{STATUS_LABELS[e.to_status] || e.to_status}</span>
              <span className="text-slate-500 text-xs ml-2">
                {new Date(e.created_at).toLocaleString('fr-FR')}
                {e.actor_role ? ` · ${e.actor_role}` : ''}
                {e.note ? ` — ${e.note}` : ''}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
