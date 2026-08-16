/**
 * Répartition d'un lot réglé : vendre / louer / stocker.
 *
 * Le raffineur ne saisit que la vente et la location. **Le stockage est le
 * reste**, calculé et affiché mais jamais saisi : l'API exige que la somme
 * couvre exactement le lot, et cette contrainte devient ici structurelle plutôt
 * qu'un message d'erreur qu'on répète jusqu'à ce que l'utilisateur tombe juste.
 *
 * Les trois destinations n'ont pas le même effet et l'écran le dit : vendre
 * sort l'or définitivement, louer le prête, stocker le garde — et la garde est
 * facturée.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { type LotDisposition as LotDispositionRow } from '../../lib/api';
import { planDisposition, dispositionProceedsXof } from '@tnc-trading/shared';
import { formatCurrency, formatGrams } from '../../lib/formatters';
import { Button } from '../ui/Button';

const statusLabels: Record<string, string> = {
  EXECUTED: 'Exécutée',
  PARTIAL: 'Partiellement exécutée',
  FAILED: 'Échouée',
  PENDING: 'En cours',
};

const statusColor: Record<string, string> = {
  EXECUTED: 'text-emerald-400 bg-emerald-500/10',
  PARTIAL: 'text-amber-400 bg-amber-500/10',
  FAILED: 'text-red-400 bg-red-500/10',
  PENDING: 'text-slate-400 bg-slate-500/10',
};

export function LotDisposition({ consignmentId }: { consignmentId: string }) {
  const queryClient = useQueryClient();
  const [sellInput, setSellInput] = useState('');
  const [leaseInput, setLeaseInput] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['lot-disposition', consignmentId],
    queryFn: () => api.getLotDisposition(consignmentId),
  });

  const view = data?.data;

  const disposeMutation = useMutation({
    mutationFn: (split: { sellG: number; leaseG: number; storeG: number }) =>
      api.disposeLot(consignmentId, split),
    onSuccess: () => {
      setError('');
      setSellInput('');
      setLeaseInput('');
      queryClient.invalidateQueries({ queryKey: ['lot-disposition', consignmentId] });
      // La vente et la location ont bougé le portefeuille : il ne doit pas
      // continuer d'afficher des grammes qui viennent d'en sortir.
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['lease', 'positions'] });
    },
    onError: (e: Error) => setError(e.message || 'Répartition impossible'),
  });

  if (isLoading) return <div className="text-slate-500 text-sm">Chargement…</div>;
  if (!view) return null;

  if (view.disposition) {
    return <DispositionSummary disposition={view.disposition} />;
  }

  if (!view.settled) {
    return (
      <div className="text-sm text-slate-400">
        La répartition sera disponible une fois le lot réglé, après l'essai.
      </div>
    );
  }

  const plan = planDisposition({
    creditedG: view.creditedG,
    sellG: Number(sellInput.replace(',', '.')) || 0,
    leaseG: Number(leaseInput.replace(',', '.')) || 0,
  });

  const proceeds = dispositionProceedsXof(plan.sellG, view.sellPricePerGram ?? 0);
  const canSell = (view.sellPricePerGram ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-white">Que faire de ce lot ?</h3>
        <p className="text-sm text-slate-400 mt-1">
          {formatGrams(view.creditedG)} vous ont été crédités. Vous pouvez vendre, louer,
          stocker — ou combiner les trois.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-slate-400 mb-1" htmlFor="dispose-sell">
            Vendre (grammes)
          </label>
          <input
            id="dispose-sell"
            type="number"
            inputMode="decimal"
            min={0}
            max={view.creditedG}
            step="0.001"
            value={sellInput}
            onChange={(e) => {
              setSellInput(e.target.value);
              setError('');
            }}
            placeholder="0"
            className="input w-full"
            disabled={!canSell}
          />
          <p className="text-xs text-slate-500 mt-1">
            {canSell
              ? `Au cours actuel : ${formatCurrency(view.sellPricePerGram ?? 0)}/g`
              : 'Cours indisponible — la vente est momentanément impossible'}
          </p>
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-1" htmlFor="dispose-lease">
            Mettre en location (grammes)
          </label>
          <input
            id="dispose-lease"
            type="number"
            inputMode="decimal"
            min={0}
            max={view.creditedG}
            step="0.001"
            value={leaseInput}
            onChange={(e) => {
              setLeaseInput(e.target.value);
              setError('');
            }}
            placeholder="0"
            className="input w-full"
          />
          <p className="text-xs text-slate-500 mt-1">
            Votre or sera prêté et vous rapportera un rendement en FCFA.
          </p>
        </div>
      </div>

      {/* Le stockage n'est pas saisi : c'est le reste. La règle « la somme doit
          couvrir le lot » devient impossible à enfreindre. */}
      <div className="bg-slate-800/60 rounded-lg p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Vendu</span>
          <span className="text-slate-200">
            {formatGrams(plan.sellG)}
            {proceeds > 0 && (
              <span className="text-emerald-400 ml-2">≈ {formatCurrency(proceeds)}</span>
            )}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">En location</span>
          <span className="text-slate-200">{formatGrams(plan.leaseG)}</span>
        </div>
        <div className="flex justify-between text-sm border-t border-slate-700 pt-2">
          <span className="text-slate-400">Stocké à Dubaï (le reste)</span>
          <span className="font-semibold text-gold-400">{formatGrams(plan.storeG)}</span>
        </div>
      </div>

      {/* Verbatim de l'API : le raffineur doit savoir avant de choisir que la
          garde est facturée et que la location ne l'est pas. */}
      <p className="text-sm text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
        {view.storageNotice}
      </p>

      {plan.problem === 'OVER_ALLOCATED' && (
        <p className="text-sm text-red-400">
          La vente et la location dépassent le lot : {formatGrams(view.creditedG)} disponibles.
        </p>
      )}
      {plan.problem === 'LEASE_BELOW_MINIMUM' && (
        <p className="text-sm text-amber-400">
          La part en location est trop faible pour ouvrir une position.
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <Button
          onClick={() =>
            disposeMutation.mutate({
              sellG: plan.sellG,
              leaseG: plan.leaseG,
              storeG: plan.storeG,
            })
          }
          disabled={!plan.valid || disposeMutation.isPending}
          isLoading={disposeMutation.isPending}
          loadingText="Répartition…"
        >
          Répartir ce lot
        </Button>
        {/* Une répartition ne se fait qu'une fois : le dire avant, pas après. */}
        <span className="text-xs text-slate-500">
          Cette répartition est définitive et ne peut pas être refaite.
        </span>
      </div>
    </div>
  );
}

function DispositionSummary({ disposition }: { disposition: LotDispositionRow }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">Répartition du lot</h3>
        <span
          className={`px-2 py-1 rounded text-xs ${statusColor[disposition.status] || statusColor.PENDING}`}
        >
          {statusLabels[disposition.status] || disposition.status}
        </span>
      </div>

      <div className="bg-slate-800/60 rounded-lg p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-400">Vendu</span>
          <span className="text-slate-200">
            {formatGrams(disposition.sell_g)}
            {disposition.sell_proceeds_xof ? (
              <span className="text-emerald-400 ml-2">
                {formatCurrency(disposition.sell_proceeds_xof)}
              </span>
            ) : null}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">En location</span>
          <span className="text-slate-200">{formatGrams(disposition.lease_g)}</span>
        </div>
        <div className="flex justify-between border-t border-slate-700 pt-2">
          <span className="text-slate-400">Stocké à Dubaï</span>
          <span className="text-gold-400 font-semibold">{formatGrams(disposition.store_g)}</span>
        </div>
      </div>

      {/* Une exécution partielle est dite, jamais tue. */}
      {disposition.status === 'PARTIAL' && (
        <p className="text-sm text-amber-300 bg-amber-500/10 rounded-lg p-3">
          Une partie de la répartition n'a pas pu être exécutée
          {disposition.failure_reason ? ` (${disposition.failure_reason})` : ''}. Les opérations
          réussies ont bien eu lieu ; contactez le support en citant la référence du lot.
        </p>
      )}
      {disposition.status === 'FAILED' && (
        <p className="text-sm text-red-300 bg-red-500/10 rounded-lg p-3">
          La répartition n'a pas pu être exécutée
          {disposition.failure_reason ? ` (${disposition.failure_reason})` : ''}. Votre or est
          resté dans votre portefeuille.
        </p>
      )}
    </div>
  );
}
