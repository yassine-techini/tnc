/**
 * Gold lease — put grams to work at the published rate.
 *
 * The screen has one job beyond the mechanics: make sure nobody opens a
 * position without understanding what they are agreeing to. Leased gold is lent
 * out — it leaves the vault, it cannot be sold while lent, and getting it back
 * takes the recall period. The disclosure comes from the API and is displayed
 * verbatim; it is never paraphrased into something friendlier.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth';
import api, { type LeasePosition } from '../lib/api';
import { queryKeys, staleTimes } from '../lib/query-keys';
import { formatCurrency, formatGrams, formatDate } from '../lib/formatters';
import { checkLeaseAmount, projectAnnualLeaseYieldXof } from '@tnc-trading/shared';
import { Button } from '../components/ui/Button';

const statusLabels: Record<LeasePosition['status'], string> = {
  ACTIVE: 'En cours',
  EXITING: 'Sortie demandée',
  CLOSED: 'Clôturée',
};

const statusColor: Record<LeasePosition['status'], string> = {
  ACTIVE: 'text-emerald-400 bg-emerald-500/10',
  EXITING: 'text-amber-400 bg-amber-500/10',
  CLOSED: 'text-slate-400 bg-slate-500/10',
};

export default function Lease() {
  const { isAuthenticated } = useAuthStore();
  const queryClient = useQueryClient();

  const [grams, setGrams] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: termsData } = useQuery({
    queryKey: queryKeys.leaseTerms,
    queryFn: () => api.getLeaseTerms(),
    staleTime: staleTimes.leaseTerms,
    enabled: isAuthenticated,
  });
  const terms = termsData?.data;

  const { data: positionsData, isLoading } = useQuery({
    queryKey: queryKeys.leasePositions,
    queryFn: () => api.getLeasePositions(),
    staleTime: staleTimes.leasePositions,
    enabled: isAuthenticated,
  });
  const positions = positionsData?.data?.positions || [];

  const { data: walletData } = useQuery({
    queryKey: ['wallet'],
    queryFn: () => api.getWallet(),
    enabled: isAuthenticated,
  });

  const { data: priceData } = useQuery({
    queryKey: queryKeys.price,
    queryFn: () => api.getPrice(),
    staleTime: staleTimes.price,
  });
  const available = walletData?.data?.tokenBalance ?? 0;

  // The rules live in @tnc-trading/shared so web and mobile cannot drift apart,
  // and so they are tested somewhere other than by clicking.
  const check = checkLeaseAmount({
    raw: grams,
    minimumG: terms?.minimumGrams ?? 1,
    availableG: available,
    acknowledged,
  });
  const amount = check.grams ?? 0;
  const belowMinimum = check.problem === 'BELOW_MINIMUM';
  const overBalance = check.problem === 'OVER_BALANCE';

  const openMutation = useMutation({
    mutationFn: () => api.openLeasePosition(amount),
    onSuccess: (res) => {
      setOpenedId(res.data.id);
      setGrams('');
      setAcknowledged(false);
      setError('');
      queryClient.invalidateQueries({ queryKey: queryKeys.leasePositions });
      // The balance dropped by the principal — the wallet must not keep showing
      // grams that have just left it.
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (e: Error) => setError(e.message || 'Ouverture impossible'),
  });

  const exitMutation = useMutation({
    mutationFn: (positionId: string) => api.requestLeaseExit(positionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.leasePositions });
    },
    onError: (e: Error) => setError(e.message || 'Sortie impossible'),
  });

  // Yearly yield on the amount being typed, at the current spot value. Spot, not
  // either side of the spread: the daily accrual values the principal at spot,
  // so a projection built on the buy or sell price would not match what gets
  // booked. Shown as an order of magnitude, not a promise — each day is computed
  // on that day's price, which nobody knows in advance.
  const projectedYearlyXof = projectAnnualLeaseYieldXof({
    grams: amount,
    spotPerGramXof: priceData?.data?.priceXof ?? 0,
    annualRate: terms?.annualRate ?? 0,
  });

  const totals = positionsData?.data;

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Location d'or</h1>
        <p className="text-sm text-slate-400 mt-1">
          Placez vos grammes au taux publié. Le rendement est versé en FCFA, votre or reste
          compté en grammes.
        </p>
      </div>

      {terms && (
        <div className="card space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-slate-500">Taux annuel</p>
              <p className="text-2xl font-bold text-gold-400">{terms.annualRatePercent} %</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Délai de sortie</p>
              <p className="text-2xl font-bold text-slate-200">
                {terms.exitSettlementBusinessDays} j
              </p>
              <p className="text-[11px] text-slate-500">jours ouvrés</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Minimum</p>
              <p className="text-2xl font-bold text-slate-200">{terms.minimumGrams} g</p>
            </div>
          </div>

          {/* Verbatim from the API. A friendlier rewording here would be the one
              place a user could be misled about what they are agreeing to. */}
          <p className="text-sm text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            {terms.disclosure}
          </p>
        </div>
      )}

      {/* Open a position */}
      <div className="card space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold text-white">Placer de l'or en location</h2>
          <p className="text-xs text-slate-500">
            Disponible : <span className="text-slate-300">{formatGrams(available)}</span>
          </p>
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-1" htmlFor="lease-grams">
            Quantité (grammes)
          </label>
          <input
            id="lease-grams"
            type="number"
            inputMode="decimal"
            min={terms?.minimumGrams ?? 1}
            max={available}
            step="0.001"
            value={grams}
            onChange={(e) => {
              setGrams(e.target.value);
              setError('');
              setOpenedId(null);
            }}
            placeholder={terms ? `${terms.minimumGrams}` : '1'}
            className="input w-full"
          />
          {belowMinimum && (
            <p className="text-xs text-amber-400 mt-1">
              Le minimum est de {terms?.minimumGrams} g.
            </p>
          )}
          {overBalance && (
            <p className="text-xs text-red-400 mt-1">
              Vous ne disposez que de {formatGrams(available)}.
            </p>
          )}
        </div>

        {check.grams !== null && !belowMinimum && !overBalance && projectedYearlyXof > 0 && (
          <p className="text-sm text-slate-400">
            À titre indicatif, {formatGrams(amount)} rapporteraient environ{' '}
            <span className="text-slate-200">{formatCurrency(projectedYearlyXof)}</span> sur un an
            au cours actuel. Le rendement est calculé chaque jour sur le cours du jour : ce
            montant n'est pas garanti.
          </p>
        )}

        <label className="flex items-start gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-1"
          />
          <span>
            Je comprends que mon or sera prêté à une contrepartie, qu'il ne sera pas vendable
            tant que la position est ouverte, et que sa restitution prend{' '}
            {terms?.exitSettlementBusinessDays ?? 3} jours ouvrés après ma demande.
          </span>
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {openedId && (
          <p className="text-sm text-emerald-400">
            Position ouverte. Vos grammes ont quitté votre portefeuille et commencent à
            produire dès demain.
          </p>
        )}

        <Button
          onClick={() => openMutation.mutate()}
          disabled={!check.valid || openMutation.isPending}
          isLoading={openMutation.isPending}
          loadingText="Ouverture…"
        >
          Placer en location
        </Button>
      </div>

      {/* Positions */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold text-white">Mes positions</h2>
          {totals && totals.totalPrincipalG > 0 && (
            <p className="text-xs text-slate-500">
              {formatGrams(totals.totalPrincipalG)} en location ·{' '}
              <span className="text-emerald-400">
                {formatCurrency(totals.totalAccruedXof)} accumulés
              </span>
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="text-slate-500 text-center py-8">Chargement…</div>
        ) : positions.length === 0 ? (
          <div className="card text-center py-10 text-slate-500">
            Aucune position pour l'instant.
          </div>
        ) : (
          positions.map((p) => (
            <PositionCard
              key={p.id}
              position={p}
              expanded={expandedId === p.id}
              onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
              onExit={() => exitMutation.mutate(p.id)}
              exiting={exitMutation.isPending && exitMutation.variables === p.id}
              settlementDays={terms?.exitSettlementBusinessDays ?? 3}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PositionCard({
  position,
  expanded,
  onToggle,
  onExit,
  exiting,
  settlementDays,
}: {
  position: LeasePosition;
  expanded: boolean;
  onToggle: () => void;
  onExit: () => void;
  exiting: boolean;
  settlementDays: number;
}) {
  const [confirmExit, setConfirmExit] = useState(false);

  const { data: accrualsData } = useQuery({
    queryKey: queryKeys.leaseAccruals(position.id),
    queryFn: () => api.getLeaseAccruals(position.id),
    enabled: expanded,
  });
  const accruals = accrualsData?.data?.accruals || [];

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-lg font-semibold text-white">{formatGrams(position.principalG)}</p>
          <p className="text-xs text-slate-500">
            Ouverte le {formatDate(position.openedAt)} · {Math.round(position.annualRate * 10000) / 100} %/an
          </p>
        </div>
        <span
          className={`px-2 py-1 rounded text-xs whitespace-nowrap ${statusColor[position.status]}`}
        >
          {statusLabels[position.status]}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-slate-700/50 pt-3">
        <div>
          <p className="text-xs text-slate-500">Rendement accumulé</p>
          <p className="text-emerald-400 font-semibold">{formatCurrency(position.accruedXof)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Valeur du principal</p>
          <p className="text-slate-200">{formatCurrency(position.principalValueXof)}</p>
        </div>
      </div>

      {position.status === 'EXITING' && (
        <p className="text-sm text-amber-300 bg-amber-500/10 rounded-lg p-3">
          Sortie demandée. Vos grammes reviendront dans votre portefeuille sous{' '}
          {settlementDays} jours ouvrés, avec le rendement accumulé. La position ne produit plus
          depuis la demande.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={onToggle}>
          {expanded ? 'Masquer le détail' : 'Détail jour par jour'}
        </Button>

        {position.status === 'ACTIVE' &&
          (confirmExit ? (
            <>
              <Button variant="danger" size="sm" onClick={onExit} isLoading={exiting}>
                Confirmer la sortie
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmExit(false)}>
                Annuler
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfirmExit(true)}>
              Récupérer mon or
            </Button>
          ))}
      </div>

      {confirmExit && position.status === 'ACTIVE' && (
        <p className="text-xs text-slate-400">
          La sortie vous rend vos {formatGrams(position.principalG)} et le rendement accumulé.
          Elle ne vend pas votre or : vous pourrez le vendre une fois revenu dans votre
          portefeuille. Le rendement s'arrête dès la demande.
        </p>
      )}

      {expanded && (
        <div className="border-t border-slate-700/50 pt-3">
          {accruals.length === 0 ? (
            <p className="text-sm text-slate-500">
              Aucun jour comptabilisé pour l'instant. Le premier calcul a lieu le lendemain de
              l'ouverture.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 text-left">
                    <th className="pb-2">Jour</th>
                    <th className="pb-2">Cours retenu</th>
                    <th className="pb-2 text-right">Rendement</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {accruals.map((a) => (
                    <tr key={a.date} className="border-t border-slate-800">
                      <td className="py-1.5">{a.date}</td>
                      <td className="py-1.5 text-slate-400">
                        {formatCurrency(a.pricePerGram)}/g
                      </td>
                      <td className="py-1.5 text-right text-emerald-400">
                        {formatCurrency(a.amountXof)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* The running total is recomputed from the lines rather than
                  trusted, so a mismatch is visible instead of hidden. */}
              <p className="text-xs text-slate-500 mt-2">
                {accruals.length} jour{accruals.length > 1 ? 's' : ''} comptabilisé
                {accruals.length > 1 ? 's' : ''} ·{' '}
                {formatCurrency(accruals.reduce((sum, a) => sum + a.amountXof, 0))}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
