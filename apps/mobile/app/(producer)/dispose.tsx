/**
 * Répartir un lot réglé : vendre / louer / stocker.
 *
 * Le raffineur ne saisit que la vente et la location. **Le stockage est le
 * reste** — calculé et affiché, jamais saisi. L'API exige que la somme couvre
 * exactement le lot ; ici cette règle est structurelle plutôt qu'un message
 * d'erreur répété jusqu'à ce que l'utilisateur tombe juste.
 */
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import InlineMessage from '../../components/InlineMessage';
import { useThemeColors } from '../../stores/theme';
import { api, type LotDispositionView } from '../../lib/api';
import { formatXof, formatGrams } from '../../lib/format';
import { planDisposition, dispositionProceedsXof } from '@tnc-trading/shared';

export default function DisposeLotScreen() {
  const c = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [view, setView] = useState<LotDispositionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [sellInput, setSellInput] = useState('');
  const [leaseInput, setLeaseInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      if (!id) return;
      try {
        const res = await api.getLotDisposition(id);
        setView(res.data || null);
      } catch (e) {
        setMessage({
          type: 'error',
          text: e instanceof Error ? e.message : 'Chargement impossible',
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const plan = planDisposition({
    creditedG: view?.creditedG ?? 0,
    // La virgule est ce qu'un clavier français propose en premier.
    sellG: Number(sellInput.replace(',', '.')) || 0,
    leaseG: Number(leaseInput.replace(',', '.')) || 0,
  });

  const canSell = (view?.sellPricePerGram ?? 0) > 0;
  const proceeds = dispositionProceedsXof(plan.sellG, view?.sellPricePerGram ?? 0);

  async function submit() {
    if (!id || !plan.valid || submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await api.disposeLot(id, {
        sellG: plan.sellG,
        leaseG: plan.leaseG,
        storeG: plan.storeG,
      });
      if (res.data?.status === 'PARTIAL' || res.data?.status === 'FAILED') {
        // Une exécution partielle est dite, jamais tue.
        setMessage({
          type: 'error',
          text: `Répartition incomplète : ${res.data.failureReason || 'une opération a échoué'}. Les opérations réussies ont bien eu lieu.`,
        });
        setSubmitting(false);
        return;
      }
      router.back();
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Répartition impossible',
      });
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator size="large" color={c.gold} />
      </View>
    );
  }

  if (!view) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <Text style={{ color: c.textSecondary }}>Lot introuvable.</Text>
      </View>
    );
  }

  if (view.disposition) {
    const d = view.disposition;
    return (
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.title, { color: c.text }]}>Lot déjà réparti</Text>
          <Row label="Vendu" value={formatGrams(d.sell_g)} c={c} />
          {d.sell_proceeds_xof ? (
            <Row label="Produit de la vente" value={formatXof(d.sell_proceeds_xof)} c={c} />
          ) : null}
          <Row label="En location" value={formatGrams(d.lease_g)} c={c} />
          <Row label="Stocké à Dubaï" value={formatGrams(d.store_g)} c={c} highlight />
          {d.status !== 'EXECUTED' && (
            <Text style={[styles.notice, { color: c.warning }]}>
              Répartition incomplète{d.failure_reason ? ` : ${d.failure_reason}` : ''}. Les
              opérations réussies ont bien eu lieu.
            </Text>
          )}
        </View>
      </ScrollView>
    );
  }

  if (!view.settled) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <Text style={{ color: c.textSecondary, textAlign: 'center', paddingHorizontal: 32 }}>
          La répartition sera disponible une fois le lot réglé, après l'essai.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {message && (
        <InlineMessage
          type={message.type}
          message={message.text}
          onDismiss={() => setMessage(null)}
        />
      )}

      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.title, { color: c.text }]}>{formatGrams(view.creditedG)} crédités</Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          Lot {view.reference} — vendez, louez, stockez, ou combinez les trois.
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.label, { color: c.textSecondary }]}>Vendre (grammes)</Text>
        <TextInput
          value={sellInput}
          onChangeText={(v) => {
            setSellInput(v);
            setMessage(null);
          }}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={c.textTertiary}
          editable={canSell}
          style={[styles.input, { color: c.text, borderColor: c.border }]}
        />
        <Text style={[styles.hint, { color: c.textTertiary }]}>
          {canSell
            ? `Au cours actuel : ${formatXof(view.sellPricePerGram ?? 0)}/g`
            : 'Cours indisponible — la vente est momentanément impossible'}
        </Text>

        <Text style={[styles.label, { color: c.textSecondary, marginTop: 14 }]}>
          Mettre en location (grammes)
        </Text>
        <TextInput
          value={leaseInput}
          onChangeText={(v) => {
            setLeaseInput(v);
            setMessage(null);
          }}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={c.textTertiary}
          style={[styles.input, { color: c.text, borderColor: c.border }]}
        />
        <Text style={[styles.hint, { color: c.textTertiary }]}>
          Votre or sera prêté et vous rapportera un rendement en FCFA.
        </Text>
      </View>

      {/* Le stockage n'est pas saisi : c'est le reste. */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Row label="Vendu" value={formatGrams(plan.sellG)} c={c} />
        {proceeds > 0 && <Row label="Produit estimé" value={formatXof(proceeds)} c={c} />}
        <Row label="En location" value={formatGrams(plan.leaseG)} c={c} />
        <Row label="Stocké à Dubaï (le reste)" value={formatGrams(plan.storeG)} c={c} highlight />
      </View>

      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.warning }]}>
        {/* Verbatim de l'API, jamais reformulé. */}
        <Text style={[styles.notice, { color: c.warning }]}>{view.storageNotice}</Text>
      </View>

      {plan.problem === 'OVER_ALLOCATED' && (
        <Text style={[styles.hint, { color: c.error }]}>
          La vente et la location dépassent le lot : {formatGrams(view.creditedG)} disponibles.
        </Text>
      )}
      {plan.problem === 'LEASE_BELOW_MINIMUM' && (
        <Text style={[styles.hint, { color: c.warning }]}>
          La part en location est trop faible pour ouvrir une position.
        </Text>
      )}

      <TouchableOpacity
        style={[styles.cta, { backgroundColor: plan.valid && !submitting ? c.gold : c.border }]}
        onPress={submit}
        disabled={!plan.valid || submitting}
        activeOpacity={0.8}
      >
        {submitting ? (
          <ActivityIndicator color="#0F0F1A" />
        ) : (
          <>
            <Ionicons
              name="git-branch-outline"
              size={18}
              color={plan.valid ? '#0F0F1A' : c.textTertiary}
            />
            <Text style={[styles.ctaText, { color: plan.valid ? '#0F0F1A' : c.textTertiary }]}>
              Répartir ce lot
            </Text>
          </>
        )}
      </TouchableOpacity>

      {/* Dit avant l'action, pas après. */}
      <Text style={[styles.hint, { color: c.textTertiary, textAlign: 'center' }]}>
        Cette répartition est définitive et ne peut pas être refaite.
      </Text>
    </ScrollView>
  );
}

function Row({
  label,
  value,
  c,
  highlight,
}: {
  label: string;
  value: string;
  c: ReturnType<typeof useThemeColors>;
  highlight?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: c.textSecondary }]}>{label}</Text>
      <Text style={[styles.value, { color: highlight ? c.gold : c.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 12 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 8 },
  title: { fontSize: 18, fontWeight: '700' },
  subtitle: { fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13 },
  value: { fontSize: 15, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    fontWeight: '600',
  },
  hint: { fontSize: 12, lineHeight: 18 },
  notice: { fontSize: 12, lineHeight: 18 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 15,
  },
  ctaText: { fontWeight: '700', fontSize: 15 },
});
