import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { type ProducerConsignment } from '../lib/api';

const statusLabels: Record<string, string> = {
  SUBMITTED: 'Soumis',
  FORWARDER_VALIDATED: 'Validé transitaire',
  IN_TRANSIT: 'En transit',
  ARRIVED_DUBAI: 'Arrivé à Dubaï',
  AUDIT_VALIDATED: 'Audit validé',
  REJECTED: 'Rejeté',
};
const statusColor: Record<string, string> = {
  SUBMITTED: 'text-amber-400 bg-amber-500/10',
  FORWARDER_VALIDATED: 'text-sky-400 bg-sky-500/10',
  IN_TRANSIT: 'text-sky-400 bg-sky-500/10',
  ARRIVED_DUBAI: 'text-sky-400 bg-sky-500/10',
  AUDIT_VALIDATED: 'text-emerald-400 bg-emerald-500/10',
  REJECTED: 'text-red-400 bg-red-500/10',
};
const goldTypeLabels: Record<string, string> = { nuggets: 'Pépites', powder: 'Poudre', bar: 'Barre' };
// Ordered steps for the tracker (REJECTED handled separately).
const STEPS = ['SUBMITTED', 'FORWARDER_VALIDATED', 'IN_TRANSIT', 'ARRIVED_DUBAI', 'AUDIT_VALIDATED'];

export default function ProducerConsignments() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['my-consignments'],
    queryFn: () => api.getMyConsignments(),
  });
  const items = data?.data?.items || [];

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Mes lots d'or</h1>
          <p className="text-sm text-slate-400 mt-1">Soumettez vos lots pour export et suivez leur validation jusqu'à Dubaï.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Fermer' : '+ Nouveau lot'}
        </button>
      </div>

      {showForm && <SubmitForm onDone={() => { setShowForm(false); queryClient.invalidateQueries({ queryKey: ['my-consignments'] }); }} />}

      {isLoading ? (
        <div className="text-slate-500 text-center py-8">Chargement…</div>
      ) : items.length === 0 ? (
        <div className="card text-center py-10 text-slate-500">Aucun lot soumis pour l'instant.</div>
      ) : (
        <div className="space-y-3">
          {items.map((c) => (
            <button key={c.id} onClick={() => setSelectedId(c.id)} className="card w-full text-left hover:border-gold-500/40 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-slate-200">{c.reference}</p>
                  <p className="text-sm text-slate-400">{c.weight_declared_g.toLocaleString('fr-FR')} g · {(c.purity_declared * 100).toFixed(1)}% · {goldTypeLabels[c.gold_type]}</p>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor[c.status]}`}>{statusLabels[c.status]}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedId && <DetailModal id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function SubmitForm({ onDone }: { onDone: () => void }) {
  const [weight, setWeight] = useState('');
  const [purityKarat, setPurityKarat] = useState('22');
  const [goldType, setGoldType] = useState<'nuggets' | 'powder' | 'bar'>('nuggets');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      // Upload photos first, collect their R2 keys.
      const photos: string[] = [];
      for (const f of files) {
        const { key } = await api.uploadConsignmentPhoto(f);
        photos.push(key);
      }
      return api.submitConsignment({
        weightGrams: Number(weight),
        purity: Number(purityKarat) / 24, // karats → fraction
        goldType,
        photos: photos.length ? photos : undefined,
      });
    },
    onSuccess: onDone,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="card space-y-4">
      <h2 className="font-semibold text-white">Soumettre un lot</h2>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs text-slate-400">Poids (grammes)</span>
          <input className="input mt-1" type="number" step="0.001" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="1000" />
        </label>
        <label className="block">
          <span className="text-xs text-slate-400">Pureté (carats)</span>
          <select className="input mt-1" value={purityKarat} onChange={(e) => setPurityKarat(e.target.value)}>
            <option value="18">18K</option>
            <option value="22">22K</option>
            <option value="24">24K</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-400">Type</span>
          <select className="input mt-1" value={goldType} onChange={(e) => setGoldType(e.target.value as 'nuggets' | 'powder' | 'bar')}>
            <option value="nuggets">Pépites</option>
            <option value="powder">Poudre</option>
            <option value="bar">Barre</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-slate-400">Photos du lot (JPEG/PNG/WebP)</span>
        <input
          className="input mt-1 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-1 file:text-slate-200"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 10))}
        />
      </label>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <img key={i} src={URL.createObjectURL(f)} alt="" className="w-16 h-16 object-cover rounded-lg border border-slate-700" />
          ))}
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className="btn-primary w-full" disabled={mut.isPending || !(Number(weight) > 0)} onClick={() => mut.mutate()}>
        {mut.isPending ? 'Envoi…' : 'Soumettre le lot'}
      </button>
    </div>
  );
}

function PhotoStrip({ consignmentId, photosJson }: { consignmentId: string; photosJson: string | null }) {
  let count = 0;
  try { count = photosJson ? (JSON.parse(photosJson) as string[]).length : 0; } catch { count = 0; }
  if (count === 0) return null;
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Photos</h3>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: count }).map((_, i) => (
          <AuthPhoto key={i} consignmentId={consignmentId} idx={i} />
        ))}
      </div>
    </div>
  );
}

function AuthPhoto({ consignmentId, idx }: { consignmentId: string; idx: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let obj: string | null = null;
    let alive = true;
    api.fetchConsignmentPhoto(consignmentId, idx).then((u) => { if (alive) { obj = u; setUrl(u); } }).catch(() => {});
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [consignmentId, idx]);
  return url
    ? <img src={url} alt="" className="w-20 h-20 object-cover rounded-lg border border-slate-700" />
    : <div className="w-20 h-20 rounded-lg bg-slate-800 animate-pulse" />;
}

function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['my-consignment', id], queryFn: () => api.getMyConsignment(id) });
  const c = data?.data?.consignment as ProducerConsignment | undefined;
  const events = data?.data?.events || [];
  const currentStep = c ? STEPS.indexOf(c.status) : -1;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-800 sticky top-0 bg-slate-900">
          <h2 className="font-semibold text-white">Lot {c?.reference ?? ''}</h2>
          <button className="text-slate-500 hover:text-white" onClick={onClose}>✕</button>
        </div>
        {isLoading || !c ? (
          <div className="p-8 text-center text-slate-500">Chargement…</div>
        ) : (
          <div className="p-4 space-y-5">
            <p className="text-sm text-slate-400">{c.weight_declared_g.toLocaleString('fr-FR')} g · {(c.purity_declared * 100).toFixed(1)}% · {goldTypeLabels[c.gold_type]}</p>

            {c.status === 'REJECTED' ? (
              <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                Lot rejeté{c.rejection_reason ? ` : ${c.rejection_reason}` : ''}
              </div>
            ) : (
              <ol className="space-y-3">
                {STEPS.map((s, i) => (
                  <li key={s} className="flex items-center gap-3">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${i <= currentStep ? 'bg-gold-500 text-black' : 'bg-slate-800 text-slate-500'}`}>{i < currentStep ? '✓' : i + 1}</span>
                    <span className={i <= currentStep ? 'text-slate-200 text-sm' : 'text-slate-500 text-sm'}>{statusLabels[s]}</span>
                  </li>
                ))}
              </ol>
            )}

            {c.refined_weight_g != null && (
              <div className="text-sm text-emerald-400">Raffiné &amp; alloué : {c.refined_weight_g.toLocaleString('fr-FR')} g</div>
            )}

            <PhotoStrip consignmentId={c.id} photosJson={c.photos} />

            <div>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">Historique</h3>
              <ul className="space-y-1.5">
                {events.map((ev) => (
                  <li key={ev.id} className="text-xs text-slate-400">
                    <span className="text-slate-300">{statusLabels[ev.to_status] || ev.to_status}</span> · {new Date(ev.created_at).toLocaleString('fr-FR')}
                    {ev.note ? ` — ${ev.note}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
