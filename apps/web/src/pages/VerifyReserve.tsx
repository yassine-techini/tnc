import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { verifyAttestation, type VerificationOutcome } from '../lib/verify-attestation';

interface ReservePayload {
  version: number;
  generatedAt: string;
  previousDigest: string | null;
  reserve: {
    totalAllocatedG: string;
    tokensIssuedG: string;
    freeStockG: string;
    invariantHolds: boolean;
  };
  lotsAuditedSincePrevious: Array<{
    reference: string;
    refinedWeightG: string;
    producerCreditedG: string;
    auditedAt: string;
  }>;
}

export default function VerifyReserve() {
  const [digest, setDigest] = useState<string | null>(null);

  const { data: keyData } = useQuery({
    queryKey: ['reserve-key'],
    queryFn: () => api.getReserveVerificationKey(),
    retry: false,
  });

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['reserve-attestations'],
    queryFn: () => api.getReserveAttestations(1, 20),
    retry: false,
  });

  const items = listData?.data?.items || [];
  const selected = digest ?? items[0]?.digest ?? null;

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Vérifier la réserve</h1>
        <p className="text-sm text-slate-400 mt-1">
          Chaque attestation déclare l'état de la réserve d'or et référence la précédente. Modifier
          une attestation ancienne casse la sienne et rompt la chaîne&nbsp;: l'historique est donc
          vérifiable, et non réécrivable.
        </p>
        <p className="text-xs text-slate-500 mt-2">
          Les vérifications ci-dessous s'exécutent <strong>dans votre navigateur</strong>, à partir
          du document publié et de la clé publique. Elles ne dépendent pas de notre réponse.
        </p>
      </div>

      {listLoading ? (
        <div className="text-slate-500 text-center py-8">Chargement…</div>
      ) : items.length === 0 ? (
        <div className="card text-slate-400 text-sm">
          Aucune attestation publiée pour le moment.
        </div>
      ) : (
        <>
          <div className="card space-y-2">
            <h2 className="text-xs uppercase tracking-wider text-slate-500">Attestations récentes</h2>
            <ul className="divide-y divide-slate-800">
              {items.map((a) => (
                <li key={a.digest}>
                  <button
                    onClick={() => setDigest(a.digest)}
                    className={`w-full text-left py-2 flex items-center justify-between gap-3 ${
                      a.digest === selected ? 'text-gold-400' : 'text-slate-300 hover:text-slate-100'
                    }`}
                  >
                    <span className="font-mono text-xs truncate">
                      #{a.sequence} · {a.digest.slice(0, 16)}…
                    </span>
                    <span className="text-xs text-slate-500 shrink-0">
                      {new Date(a.createdAt).toLocaleDateString('fr-FR')}
                      {a.anchorTxHash ? ' · ancrée' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {selected && <AttestationDetail digest={selected} publicJwk={keyData?.data?.jwk ?? null} />}
        </>
      )}
    </div>
  );
}

function AttestationDetail({ digest, publicJwk }: { digest: string; publicJwk: JsonWebKey | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reserve-attestation', digest],
    queryFn: () => api.getReserveAttestation(digest),
    retry: false,
  });

  const record = data?.data;
  const [outcome, setOutcome] = useState<VerificationOutcome | null>(null);

  useEffect(() => {
    let alive = true;
    setOutcome(null);
    if (!record) return;
    verifyAttestation(record, publicJwk).then((r) => {
      if (alive) setOutcome(r);
    });
    return () => {
      alive = false;
    };
  }, [record, publicJwk]);

  if (isLoading || !record) {
    return <div className="text-slate-500 text-center py-8">Chargement…</div>;
  }

  let payload: ReservePayload | null = null;
  try {
    payload = JSON.parse(record.payload) as ReservePayload;
  } catch {
    payload = null;
  }

  return (
    <div className="card space-y-5">
      <div className="space-y-2">
        <h2 className="text-xs uppercase tracking-wider text-slate-500">Contrôles</h2>
        <Check
          ok={outcome?.digestMatches}
          label="Le document correspond à son empreinte"
          detail="SHA-256 recalculé dans votre navigateur"
        />
        <Check
          ok={outcome?.signatureValid}
          label="Signature valide"
          detail={
            publicJwk
              ? 'ECDSA P-256 vérifiée avec la clé publique'
              : 'Aucune clé publique publiée — vérification impossible'
          }
        />
        <Check
          ok={record.anchoredAt ? true : null}
          label="Ancrée sur une chaîne publique"
          detail={
            record.anchorTxHash
              ? `${record.anchorChain} · ${record.anchorTxHash}`
              : 'Pas encore ancrée — la chaîne de hachage reste vérifiable'
          }
        />
      </div>

      {payload && (
        <>
          <div className="space-y-2">
            <h2 className="text-xs uppercase tracking-wider text-slate-500">
              Réserve au {new Date(payload.generatedAt).toLocaleString('fr-FR')}
            </h2>
            <dl className="divide-y divide-slate-800 text-sm">
              <Row label="Or alloué" value={`${payload.reserve.totalAllocatedG} g`} />
              <Row label="Tokens émis" value={`${payload.reserve.tokensIssuedG} g`} />
              <Row label="Stock libre" value={`${payload.reserve.freeStockG} g`} />
              <Row
                label="Tokens émis ≤ or alloué"
                value={payload.reserve.invariantHolds ? 'Oui' : 'NON'}
                alert={!payload.reserve.invariantHolds}
              />
            </dl>
          </div>

          {payload.lotsAuditedSincePrevious.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs uppercase tracking-wider text-slate-500">
                Lots audités depuis l'attestation précédente
              </h2>
              <ul className="space-y-1 text-sm">
                {payload.lotsAuditedSincePrevious.map((l) => (
                  <li key={l.reference} className="flex justify-between gap-3 text-slate-300">
                    <span className="font-mono text-xs">{l.reference}</span>
                    <span className="text-slate-400">
                      {l.refinedWeightG} g raffinés · {l.producerCreditedG} g au producteur
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer hover:text-slate-300">
          Document signé (à recalculer vous-même)
        </summary>
        <p className="mt-2">
          Empreinte attendue&nbsp;: <span className="font-mono break-all text-slate-400">{record.digest}</span>
        </p>
        {record.previousDigest && (
          <p className="mt-1">
            Attestation précédente&nbsp;:{' '}
            <span className="font-mono break-all text-slate-400">{record.previousDigest}</span>
          </p>
        )}
        <pre className="mt-2 p-2 bg-slate-900 rounded-lg overflow-x-auto text-[10px] text-slate-400 whitespace-pre-wrap break-all">
          {record.payload}
        </pre>
      </details>
    </div>
  );
}

function Check({ ok, label, detail }: { ok: boolean | null | undefined; label: string; detail: string }) {
  const icon = ok === true ? '✓' : ok === false ? '✕' : '•';
  const color = ok === true ? 'text-emerald-400' : ok === false ? 'text-red-400' : 'text-slate-500';
  return (
    <div className="flex gap-3 items-start">
      <span className={`${color} font-bold`}>{icon}</span>
      <div>
        <div className={`text-sm ${ok === false ? 'text-red-400' : 'text-slate-200'}`}>{label}</div>
        <div className="text-xs text-slate-500">{detail}</div>
      </div>
    </div>
  );
}

function Row({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="py-2 flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className={alert ? 'text-red-400 font-medium' : 'text-slate-200'}>{value}</dd>
    </div>
  );
}
