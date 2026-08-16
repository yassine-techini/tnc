import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../stores/theme';
import { api, type ProducerProfile } from '../../lib/api';

const ENTITY_TYPES = [
  { value: 'COOPERATIVE' as const, label: 'Coopérative' },
  { value: 'COMPANY' as const, label: 'Société' },
  { value: 'INDIVIDUAL' as const, label: 'Individuel' },
];

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: "En cours d'examen",
  PROCESSING: "En cours d'examen",
  VERIFIED: 'Validé',
  REJECTED: 'Rejeté',
};

export default function ProducerProfileScreen() {
  const c = useThemeColors();
  const [profile, setProfile] = useState<ProducerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api
      .getProducerProfile()
      .then((res) => setProfile(res.data ?? null))
      .catch(() => setProfile(null)) // 404 simply means no dossier yet
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.gold} />
      </View>
    );
  }

  if (!profile || editing) {
    return (
      <ProfileForm
        existing={profile ?? undefined}
        onDone={(p) => {
          setProfile(p);
          setEditing(false);
        }}
      />
    );
  }

  const rows: Array<[string, string | null]> = [
    ['Type', ENTITY_TYPES.find((t) => t.value === profile.entity_type)?.label ?? profile.entity_type],
    ['Raison sociale', profile.legal_name],
    ['RCCM', profile.registration_number],
    ["Autorisation d'exploitation", profile.mining_authorization],
    ['Représentant', profile.representative_name],
    ['Téléphone', profile.representative_phone],
    ['Localité', [profile.city, profile.region].filter(Boolean).join(', ') || null],
  ];

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content}>
      <View
        style={[
          styles.statusBox,
          {
            backgroundColor:
              (profile.status === 'VERIFIED' ? c.success : profile.status === 'REJECTED' ? c.error : c.gold) +
              '20',
          },
        ]}
      >
        <Text
          style={{
            color: profile.status === 'VERIFIED' ? c.success : profile.status === 'REJECTED' ? c.error : c.gold,
            fontWeight: '700',
          }}
        >
          {STATUS_LABELS[profile.status] || profile.status}
        </Text>
        {profile.status === 'REJECTED' && profile.rejection_reason && (
          <Text style={{ color: c.textSecondary, marginTop: 4 }}>{profile.rejection_reason}</Text>
        )}
        {profile.status === 'VERIFIED' && (
          <Text style={{ color: c.textSecondary, marginTop: 4 }}>
            Vous pouvez déclarer vos lots d'or.
          </Text>
        )}
      </View>

      {rows.map(([label, value]) => (
        <View key={label} style={[styles.row, { borderColor: c.border }]}>
          <Text style={{ color: c.textTertiary, fontSize: 13 }}>{label}</Text>
          <Text style={{ color: c.text, fontSize: 13, flexShrink: 1, textAlign: 'right' }}>
            {value || '—'}
          </Text>
        </View>
      ))}

      {profile.status === 'REJECTED' && (
        <TouchableOpacity style={[styles.submit, { backgroundColor: c.gold }]} onPress={() => setEditing(true)}>
          <Text style={styles.submitText}>Corriger et renvoyer</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function ProfileForm({
  existing,
  onDone,
}: {
  existing?: ProducerProfile;
  onDone: (p: ProducerProfile) => void;
}) {
  const c = useThemeColors();
  const [entityType, setEntityType] = useState<'INDIVIDUAL' | 'COOPERATIVE' | 'COMPANY'>(
    existing?.entity_type ?? 'COOPERATIVE'
  );
  const [legalName, setLegalName] = useState(existing?.legal_name ?? '');
  const [registration, setRegistration] = useState(existing?.registration_number ?? '');
  const [authorization, setAuthorization] = useState(existing?.mining_authorization ?? '');
  const [repName, setRepName] = useState(existing?.representative_name ?? '');
  const [repPhone, setRepPhone] = useState(existing?.representative_phone ?? '');
  const [city, setCity] = useState(existing?.city ?? '');
  const [docs, setDocs] = useState<Array<{ uri: string; name: string; type: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEntity = entityType !== 'INDIVIDUAL';
  const canSubmit =
    legalName.trim().length >= 2 && repName.trim().length >= 2 && (!isEntity || registration.trim().length > 0);

  async function pickDocument() {
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsMultipleSelection: true });
    if (!result.canceled) {
      setDocs((prev) => [
        ...prev,
        ...result.assets.map((a, i) => ({
          uri: a.uri,
          name: `doc_${Date.now()}_${i}.jpg`,
          type: a.mimeType || 'image/jpeg',
        })),
      ]);
    }
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const keys: string[] = [];
      for (const d of docs) {
        const { key } = await api.uploadProducerDocument(d);
        keys.push(key);
      }
      const res = await api.submitProducerProfile({
        entityType,
        legalName: legalName.trim(),
        registrationNumber: registration.trim() || undefined,
        miningAuthorization: authorization.trim() || undefined,
        representativeName: repName.trim(),
        representativePhone: repPhone.trim() || undefined,
        city: city.trim() || undefined,
        documents: keys.length ? keys : undefined,
      });
      if (res.data) onDone(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Envoi impossible');
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: c.surface, borderColor: c.border, color: c.text },
  ];

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.label, { color: c.textSecondary }]}>Type</Text>
      <View style={styles.chips}>
        {ENTITY_TYPES.map((t) => (
          <TouchableOpacity
            key={t.value}
            onPress={() => setEntityType(t.value)}
            style={[
              styles.chip,
              { borderColor: c.border, backgroundColor: entityType === t.value ? c.gold : c.surface },
            ]}
          >
            <Text style={{ color: entityType === t.value ? '#000' : c.textSecondary, fontWeight: '600' }}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[styles.label, { color: c.textSecondary }]}>
        {isEntity ? 'Raison sociale' : 'Nom complet'}
      </Text>
      <TextInput style={inputStyle} value={legalName} onChangeText={setLegalName} placeholderTextColor={c.textTertiary} />

      {isEntity && (
        <>
          <Text style={[styles.label, { color: c.textSecondary }]}>Numéro RCCM</Text>
          <TextInput style={inputStyle} value={registration} onChangeText={setRegistration} placeholderTextColor={c.textTertiary} />

          <Text style={[styles.label, { color: c.textSecondary }]}>Autorisation d'exploitation</Text>
          <TextInput style={inputStyle} value={authorization} onChangeText={setAuthorization} placeholderTextColor={c.textTertiary} />
        </>
      )}

      <Text style={[styles.label, { color: c.textSecondary }]}>Représentant légal</Text>
      <TextInput style={inputStyle} value={repName} onChangeText={setRepName} placeholderTextColor={c.textTertiary} />

      <Text style={[styles.label, { color: c.textSecondary }]}>Téléphone</Text>
      <TextInput style={inputStyle} value={repPhone} onChangeText={setRepPhone} keyboardType="phone-pad" placeholderTextColor={c.textTertiary} />

      <Text style={[styles.label, { color: c.textSecondary }]}>Ville</Text>
      <TextInput style={inputStyle} value={city} onChangeText={setCity} placeholderTextColor={c.textTertiary} />

      <Text style={[styles.label, { color: c.textSecondary }]}>
        Pièces justificatives ({docs.length})
      </Text>
      <TouchableOpacity
        style={[styles.docButton, { backgroundColor: c.surface, borderColor: c.border }]}
        onPress={pickDocument}
      >
        <Ionicons name="document-attach-outline" size={20} color={c.gold} />
        <Text style={{ color: c.text, marginLeft: 8 }}>Ajouter une pièce</Text>
      </TouchableOpacity>

      {error && <Text style={{ color: c.error, marginTop: 16, fontSize: 13 }}>{error}</Text>}

      <TouchableOpacity
        style={[styles.submit, { backgroundColor: canSubmit && !submitting ? c.gold : c.border }]}
        onPress={submit}
        disabled={!canSubmit || submitting}
      >
        {submitting ? <ActivityIndicator color="#000" /> : <Text style={styles.submitText}>Envoyer le dossier</Text>}
      </TouchableOpacity>

      <Text style={{ color: c.textTertiary, fontSize: 12, marginTop: 16, lineHeight: 18 }}>
        Votre dossier doit être validé avant de pouvoir déclarer un lot.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13, marginBottom: 6, marginTop: 16 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  docButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  statusBox: { borderRadius: 14, padding: 14, marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, borderTopWidth: 1, paddingVertical: 11 },
  submit: { marginTop: 24, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  submitText: { color: '#000', fontWeight: '700', fontSize: 15 },
});
