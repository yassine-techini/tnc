import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { type ProducerProfile as Profile } from '../lib/api';

const statusLabels: Record<string, string> = {
  SUBMITTED: 'En cours d\'examen',
  PROCESSING: 'En cours d\'examen',
  VERIFIED: 'Validé',
  REJECTED: 'Rejeté',
};
const statusColor: Record<string, string> = {
  SUBMITTED: 'text-amber-400 bg-amber-500/10',
  PROCESSING: 'text-amber-400 bg-amber-500/10',
  VERIFIED: 'text-emerald-400 bg-emerald-500/10',
  REJECTED: 'text-red-400 bg-red-500/10',
};
const entityLabels: Record<string, string> = {
  INDIVIDUAL: 'Orpailleur individuel',
  COOPERATIVE: 'Coopérative',
  COMPANY: 'Société',
  REFINER: 'Raffineur',
};

export default function ProducerProfilePage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['producer-profile'],
    queryFn: () => api.getProducerProfile(),
    retry: false,
  });
  const profile = data?.data;
  // A 404 simply means no dossier has been submitted yet.
  const hasProfile = !!profile && !error;

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Dossier producteur</h1>
        <p className="text-sm text-slate-400 mt-1">
          Votre dossier doit être validé avant de pouvoir consigner un lot. Les lots validés sont
          payés en tokens, ce qui suppose un compte vérifié.
        </p>
      </div>

      {isLoading ? (
        <div className="text-slate-500 text-center py-8">Chargement…</div>
      ) : !hasProfile || editing ? (
        <ProfileForm
          existing={hasProfile ? profile : undefined}
          onDone={() => {
            setEditing(false);
            queryClient.invalidateQueries({ queryKey: ['producer-profile'] });
            queryClient.invalidateQueries({ queryKey: ['profile-role'] });
          }}
        />
      ) : (
        <ProfileSummary profile={profile} onEdit={() => setEditing(true)} />
      )}
    </div>
  );
}

function ProfileSummary({ profile, onEdit }: { profile: Profile; onEdit: () => void }) {
  let documentCount = 0;
  try {
    documentCount = profile.documents ? (JSON.parse(profile.documents) as string[]).length : 0;
  } catch {
    documentCount = 0;
  }

  const rows: Array<[string, string | null]> = [
    ['Type', entityLabels[profile.entity_type] ?? profile.entity_type],
    ['Raison sociale', profile.legal_name],
    ['RCCM', profile.registration_number],
    ['Autorisation d\'exploitation', profile.mining_authorization],
    ['IFU', profile.tax_id],
    ['Représentant', profile.representative_name],
    ['Qualité', profile.representative_role],
    ['Téléphone', profile.representative_phone],
    ['Adresse', [profile.address, profile.city, profile.region].filter(Boolean).join(', ') || null],
  ];

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <span className={`px-2 py-1 rounded-lg text-xs font-medium ${statusColor[profile.status]}`}>
          {statusLabels[profile.status]}
        </span>
        {profile.status === 'REJECTED' && (
          <button className="btn-primary" onClick={onEdit}>
            Corriger et renvoyer
          </button>
        )}
      </div>

      {profile.status === 'REJECTED' && profile.rejection_reason && (
        <p className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3">
          Motif du rejet : {profile.rejection_reason}
        </p>
      )}
      {profile.status === 'VERIFIED' && (
        <p className="text-sm text-emerald-400 bg-emerald-500/10 rounded-lg p-3">
          Dossier validé — vous pouvez consigner vos lots. Pour le modifier, contactez le support.
        </p>
      )}

      <dl className="divide-y divide-slate-800">
        {rows.map(([label, value]) => (
          <div key={label} className="py-2 flex justify-between gap-4 text-sm">
            <dt className="text-slate-500">{label}</dt>
            <dd className="text-slate-200 text-right">{value || <span className="text-slate-600">—</span>}</dd>
          </div>
        ))}
        <div className="py-2 flex justify-between gap-4 text-sm">
          <dt className="text-slate-500">Pièces jointes</dt>
          <dd className="text-slate-200">{documentCount}</dd>
        </div>
      </dl>
    </div>
  );
}

function ProfileForm({ existing, onDone }: { existing?: Profile; onDone: () => void }) {
  const [entityType, setEntityType] = useState<'INDIVIDUAL' | 'COOPERATIVE' | 'COMPANY' | 'REFINER'>(
    existing?.entity_type ?? 'COOPERATIVE'
  );
  const [legalName, setLegalName] = useState(existing?.legal_name ?? '');
  const [registrationNumber, setRegistrationNumber] = useState(existing?.registration_number ?? '');
  const [miningAuthorization, setMiningAuthorization] = useState(existing?.mining_authorization ?? '');
  const [taxId, setTaxId] = useState(existing?.tax_id ?? '');
  const [address, setAddress] = useState(existing?.address ?? '');
  const [city, setCity] = useState(existing?.city ?? '');
  const [region, setRegion] = useState(existing?.region ?? '');
  const [representativeName, setRepresentativeName] = useState(existing?.representative_name ?? '');
  const [representativeRole, setRepresentativeRole] = useState(existing?.representative_role ?? '');
  const [representativePhone, setRepresentativePhone] = useState(existing?.representative_phone ?? '');
  const [corridorOrigin, setCorridorOrigin] = useState(existing?.corridor_origin_country ?? '');
  const [corridorDestination, setCorridorDestination] = useState(
    existing?.corridor_destination_country ?? ''
  );
  const [files, setFiles] = useState<File[]>([]);

  const isEntity = entityType !== 'INDIVIDUAL';
  // Un raffineur ne fait pas le meme metier : il recoit et affine, et son
  // corridor dit d'ou vient le metal et ou il part.
  const isRefiner = entityType === 'REFINER';

  const mut = useMutation({
    mutationFn: async () => {
      // Upload the documents first and collect their keys.
      const documents: string[] = [];
      for (const f of files) {
        const { key } = await api.uploadProducerDocument(f);
        documents.push(key);
      }
      return api.submitProducerProfile({
        entityType,
        legalName: legalName.trim(),
        registrationNumber: registrationNumber.trim() || undefined,
        miningAuthorization: miningAuthorization.trim() || undefined,
        taxId: taxId.trim() || undefined,
        address: address.trim() || undefined,
        city: city.trim() || undefined,
        region: region.trim() || undefined,
        representativeName: representativeName.trim(),
        representativeRole: representativeRole.trim() || undefined,
        representativePhone: representativePhone.trim() || undefined,
        corridorOriginCountry: isRefiner ? corridorOrigin.trim().toUpperCase() : undefined,
        corridorDestinationCountry: isRefiner
          ? corridorDestination.trim().toUpperCase()
          : undefined,
        documents: documents.length ? documents : undefined,
      });
    },
    onSuccess: onDone,
  });

  const canSubmit =
    legalName.trim().length >= 2 &&
    representativeName.trim().length >= 2 &&
    (!isEntity || registrationNumber.trim().length > 0) &&
    // Le serveur refuse un raffineur sans corridor : le bouton le dit avant.
    (!isRefiner || (corridorOrigin.trim().length === 2 && corridorDestination.trim().length === 2));

  return (
    <form
      className="card space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) mut.mutate();
      }}
    >
      <Field label="Type d'entité">
        <select className="input" value={entityType} onChange={(e) => setEntityType(e.target.value as typeof entityType)}>
          <option value="COOPERATIVE">Coopérative</option>
          <option value="COMPANY">Société</option>
          <option value="REFINER">Raffineur</option>
          <option value="INDIVIDUAL">Orpailleur individuel</option>
        </select>
      </Field>

      <Field label={isEntity ? 'Raison sociale' : 'Nom complet'}>
        <input className="input" value={legalName} onChange={(e) => setLegalName(e.target.value)} required minLength={2} />
      </Field>

      {isRefiner && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Pays d'origine" hint="D'où vient le métal — code ISO à 2 lettres (BF, CI, ML…)">
            <input
              className="input"
              value={corridorOrigin}
              onChange={(e) => setCorridorOrigin(e.target.value.toUpperCase().slice(0, 2))}
              maxLength={2}
              required
            />
          </Field>
          <Field label="Pays de destination" hint="Où le métal est affiné (AE pour Dubaï)">
            <input
              className="input"
              value={corridorDestination}
              onChange={(e) => setCorridorDestination(e.target.value.toUpperCase().slice(0, 2))}
              maxLength={2}
              required
            />
          </Field>
        </div>
      )}

      {isEntity && (
        <>
          <Field label="Numéro RCCM" hint="Registre du commerce — obligatoire pour une coopérative ou une société">
            <input className="input" value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} required />
          </Field>
          <Field label="Autorisation d'exploitation">
            <input className="input" value={miningAuthorization} onChange={(e) => setMiningAuthorization(e.target.value)} />
          </Field>
          <Field label="IFU">
            <input className="input" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
          </Field>
        </>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Représentant légal">
          <input className="input" value={representativeName} onChange={(e) => setRepresentativeName(e.target.value)} required minLength={2} />
        </Field>
        <Field label="Qualité">
          <input className="input" placeholder="Gérant, Président…" value={representativeRole} onChange={(e) => setRepresentativeRole(e.target.value)} />
        </Field>
        <Field label="Téléphone">
          <input className="input" value={representativePhone} onChange={(e) => setRepresentativePhone(e.target.value)} />
        </Field>
        <Field label="Ville">
          <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field label="Région">
          <input className="input" value={region} onChange={(e) => setRegion(e.target.value)} />
        </Field>
        <Field label="Adresse">
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
      </div>

      <Field label="Pièces justificatives" hint="PDF ou image — RCCM, autorisation d'exploitation, statuts">
        <input
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="input"
          onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 10))}
        />
      </Field>
      {files.length > 0 && (
        <ul className="text-xs text-slate-400 space-y-1">
          {files.map((f) => (
            <li key={f.name}>• {f.name}</li>
          ))}
        </ul>
      )}

      {mut.isError && (
        <p className="text-sm text-red-400">{(mut.error as Error).message || 'Envoi impossible'}</p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={!canSubmit || mut.isPending}>
        {mut.isPending ? 'Envoi…' : existing ? 'Renvoyer le dossier' : 'Soumettre le dossier'}
      </button>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-slate-300">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
