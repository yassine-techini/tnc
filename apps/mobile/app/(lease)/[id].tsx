/**
 * A lease position, day by day.
 *
 * The accrual trail is here so the accumulated total can be checked line by
 * line rather than taken on trust — the same reason the API keeps one row per
 * position per day instead of only a running sum.
 */
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect, router } from 'expo-router';
import InlineMessage from '../../components/InlineMessage';
import { useThemeColors } from '../../stores/theme';
import { api, type LeasePosition, type LeaseAccrual, type LeaseTerms } from '../../lib/api';
import { formatXof, formatGrams } from '../../lib/format';
import { STATUS_LABELS, statusColor } from './index';

export default function LeasePositionScreen() {
  const c = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [position, setPosition] = useState<LeasePosition | null>(null);
  const [accruals, setAccruals] = useState<LeaseAccrual[]>([]);
  const [terms, setTerms] = useState<LeaseTerms | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmExit, setConfirmExit] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [positionsRes, accrualsRes, termsRes] = await Promise.all([
        api.getLeasePositions(),
        api.getLeaseAccruals(id),
        api.getLeaseTerms(),
      ]);
      setPosition(positionsRes.data?.positions.find((p) => p.id === id) || null);
      setAccruals(accrualsRes.data?.accruals || []);
      setTerms(termsRes.data || null);
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Chargement impossible' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function requestExit() {
    if (!id) return;
    setExiting(true);
    setMessage(null);
    try {
      const res = await api.requestLeaseExit(id);
      setMessage({
        type: 'success',
        text: res.data?.message || 'Sortie demandée.',
      });
      setConfirmExit(false);
      await load();
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Sortie impossible' });
    } finally {
      setExiting(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator size="large" color={c.gold} />
      </View>
    );
  }

  if (!position) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <Text style={{ color: c.textSecondary }}>Position introuvable.</Text>
        <TouchableOpacity onPress={() => router.replace('/(lease)')} style={{ marginTop: 12 }}>
          <Text style={{ color: c.gold }}>Retour à mes positions</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Recomputed from the lines rather than trusted, so a mismatch with the
  // stored total is visible instead of hidden.
  const accrualSum = accruals.reduce((sum, a) => sum + a.amountXof, 0);

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content}>
      {message && (
        <InlineMessage
          type={message.type}
          message={message.text}
          onDismiss={() => setMessage(null)}
        />
      )}

      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.principal, { color: c.text }]}>
            {formatGrams(position.principalG)}
          </Text>
          <Text style={[styles.status, { color: statusColor(position.status, c) }]}>
            {STATUS_LABELS[position.status]}
          </Text>
        </View>
        <Text style={[styles.meta, { color: c.textTertiary }]}>
          {Math.round(position.annualRate * 10000) / 100} %/an · ouverte le{' '}
          {position.openedAt.slice(0, 10)}
        </Text>

        <View style={[styles.split, { borderColor: c.border }]}>
          <View style={styles.splitCell}>
            <Text style={[styles.label, { color: c.textTertiary }]}>Rendement accumulé</Text>
            <Text style={[styles.figure, { color: c.success }]}>
              {formatXof(position.accruedXof)}
            </Text>
          </View>
          <View style={styles.splitCell}>
            <Text style={[styles.label, { color: c.textTertiary }]}>Valeur du principal</Text>
            <Text style={[styles.figure, { color: c.text }]}>
              {formatXof(position.principalValueXof)}
            </Text>
          </View>
        </View>
      </View>

      {position.status === 'EXITING' && (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.warning }]}>
          <Text style={[styles.notice, { color: c.warning }]}>
            Sortie demandée. Vos grammes reviendront dans votre portefeuille sous{' '}
            {terms?.exitSettlementBusinessDays ?? 3} jours ouvrés, avec le rendement accumulé.
            La position ne produit plus depuis la demande.
          </Text>
        </View>
      )}

      {position.status === 'ACTIVE' &&
        (confirmExit ? (
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.warning }]}>
            <Text style={[styles.notice, { color: c.textSecondary }]}>
              La sortie vous rend vos {formatGrams(position.principalG)} et le rendement
              accumulé. Elle ne vend pas votre or : vous pourrez le vendre une fois revenu dans
              votre portefeuille. Le rendement s'arrête dès la demande.
            </Text>
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.cta, { backgroundColor: c.gold }]}
                onPress={requestExit}
                disabled={exiting}
                activeOpacity={0.8}
              >
                {exiting ? (
                  <ActivityIndicator color="#0F0F1A" />
                ) : (
                  <Text style={styles.ctaText}>Confirmer la sortie</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ctaGhost, { borderColor: c.border }]}
                onPress={() => setConfirmExit(false)}
                activeOpacity={0.7}
              >
                <Text style={{ color: c.textSecondary, fontWeight: '600' }}>Annuler</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.ctaGhost, { borderColor: c.gold }]}
            onPress={() => setConfirmExit(true)}
            activeOpacity={0.7}
          >
            <Text style={{ color: c.gold, fontWeight: '700' }}>Récupérer mon or</Text>
          </TouchableOpacity>
        ))}

      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>Détail jour par jour</Text>

        {accruals.length === 0 ? (
          <Text style={[styles.meta, { color: c.textTertiary }]}>
            Aucun jour comptabilisé pour l'instant. Le premier calcul a lieu le lendemain de
            l'ouverture.
          </Text>
        ) : (
          <>
            {accruals.map((a) => (
              <View key={a.date} style={[styles.accrualRow, { borderColor: c.border }]}>
                <Text style={[styles.accrualDate, { color: c.textSecondary }]}>{a.date}</Text>
                <Text style={[styles.accrualPrice, { color: c.textTertiary }]}>
                  {formatXof(a.pricePerGram)}/g
                </Text>
                <Text style={[styles.accrualAmount, { color: c.success }]}>
                  {formatXof(a.amountXof)}
                </Text>
              </View>
            ))}
            <Text style={[styles.meta, { color: c.textTertiary }]}>
              {accruals.length} jour{accruals.length > 1 ? 's' : ''} · {formatXof(accrualSum)}
            </Text>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 12 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 8 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  principal: { fontSize: 22, fontWeight: '700' },
  status: { fontSize: 12, fontWeight: '600' },
  meta: { fontSize: 12, lineHeight: 18 },
  split: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, marginTop: 6 },
  splitCell: { flex: 1, gap: 2 },
  label: { fontSize: 11 },
  figure: { fontSize: 16, fontWeight: '700' },
  notice: { fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  cta: { flex: 1, alignItems: 'center', borderRadius: 10, paddingVertical: 12 },
  ctaText: { color: '#0F0F1A', fontWeight: '700', fontSize: 14 },
  ctaGhost: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  accrualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  accrualDate: { fontSize: 12, flex: 1 },
  accrualPrice: { fontSize: 11, flex: 1, textAlign: 'center' },
  accrualAmount: { fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' },
});
