/**
 * Lease positions.
 *
 * The list answers two questions at a glance: how much gold is lent out, and
 * how much yield it has produced. Grams and XOF are shown side by side but
 * never added together — the principal is gold, the yield is money.
 */
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../stores/theme';
import { api, type LeasePosition, type LeaseTerms } from '../../lib/api';
import { formatXof, formatGrams } from '../../lib/format';

export const STATUS_LABELS: Record<LeasePosition['status'], string> = {
  ACTIVE: 'En cours',
  EXITING: 'Sortie demandée',
  CLOSED: 'Clôturée',
};

export function statusColor(
  status: LeasePosition['status'],
  c: ReturnType<typeof useThemeColors>
): string {
  if (status === 'ACTIVE') return c.success;
  if (status === 'EXITING') return c.warning;
  return c.textTertiary;
}

export default function LeasePositionsScreen() {
  const c = useThemeColors();
  const [positions, setPositions] = useState<LeasePosition[]>([]);
  const [totals, setTotals] = useState({ totalPrincipalG: 0, totalAccruedXof: 0 });
  const [terms, setTerms] = useState<LeaseTerms | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [positionsRes, termsRes] = await Promise.all([
        api.getLeasePositions(),
        api.getLeaseTerms(),
      ]);
      setPositions(positionsRes.data?.positions || []);
      setTotals({
        totalPrincipalG: positionsRes.data?.totalPrincipalG || 0,
        totalAccruedXof: positionsRes.data?.totalAccruedXof || 0,
      });
      setTerms(termsRes.data || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload on focus: the daily accrual lands while the holder is away, and a
  // position may have settled since the last look.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator size="large" color={c.gold} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={c.gold}
        />
      }
    >
      {terms && (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.termsRow}>
            <View>
              <Text style={[styles.termLabel, { color: c.textTertiary }]}>Taux annuel</Text>
              <Text style={[styles.termValue, { color: c.gold }]}>
                {terms.annualRatePercent} %
              </Text>
            </View>
            <View>
              <Text style={[styles.termLabel, { color: c.textTertiary }]}>Délai de sortie</Text>
              <Text style={[styles.termValue, { color: c.text }]}>
                {terms.exitSettlementBusinessDays} j
              </Text>
            </View>
            <View>
              <Text style={[styles.termLabel, { color: c.textTertiary }]}>Minimum</Text>
              <Text style={[styles.termValue, { color: c.text }]}>{terms.minimumGrams} g</Text>
            </View>
          </View>

          {/* Verbatim from the API — a friendlier rewording here would be the
              one place a holder could be misled about what they agree to. */}
          <Text style={[styles.disclosure, { color: c.warning, borderColor: c.warning }]}>
            {terms.disclosure}
          </Text>
        </View>
      )}

      {totals.totalPrincipalG > 0 && (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.termLabel, { color: c.textTertiary }]}>En location</Text>
          <Text style={[styles.total, { color: c.text }]}>
            {formatGrams(totals.totalPrincipalG)}
          </Text>
          <Text style={[styles.totalYield, { color: c.success }]}>
            {formatXof(totals.totalAccruedXof)} de rendement accumulé
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.cta, { backgroundColor: c.gold }]}
        onPress={() => router.push('/(lease)/open')}
        activeOpacity={0.8}
      >
        <Ionicons name="add-circle-outline" size={18} color="#0F0F1A" />
        <Text style={styles.ctaText}>Placer de l'or en location</Text>
      </TouchableOpacity>

      {error && <Text style={[styles.error, { color: c.error }]}>{error}</Text>}

      {positions.length === 0 ? (
        <Text style={[styles.empty, { color: c.textTertiary }]}>
          Aucune position pour l'instant.
        </Text>
      ) : (
        positions.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
            onPress={() => router.push(`/(lease)/${p.id}`)}
            activeOpacity={0.7}
          >
            <View style={styles.cardHeader}>
              <Text style={[styles.principal, { color: c.text }]}>
                {formatGrams(p.principalG)}
              </Text>
              <Text style={[styles.status, { color: statusColor(p.status, c) }]}>
                {STATUS_LABELS[p.status]}
              </Text>
            </View>
            <Text style={[styles.meta, { color: c.textTertiary }]}>
              {Math.round(p.annualRate * 10000) / 100} %/an · ouverte le{' '}
              {p.openedAt.slice(0, 10)}
            </Text>
            <Text style={[styles.yield, { color: c.success }]}>
              {formatXof(p.accruedXof)} accumulés
            </Text>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 12 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 6 },
  termsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  termLabel: { fontSize: 11 },
  termValue: { fontSize: 22, fontWeight: '700' },
  disclosure: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  total: { fontSize: 26, fontWeight: '700' },
  totalYield: { fontSize: 14, fontWeight: '600' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
  },
  ctaText: { color: '#0F0F1A', fontWeight: '700', fontSize: 15 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  principal: { fontSize: 18, fontWeight: '700' },
  status: { fontSize: 12, fontWeight: '600' },
  meta: { fontSize: 12 },
  yield: { fontSize: 14, fontWeight: '600' },
  empty: { textAlign: 'center', paddingVertical: 32, fontSize: 14 },
  error: { fontSize: 13, textAlign: 'center' },
});
