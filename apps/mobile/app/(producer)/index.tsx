import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../stores/theme';
import { api, type Consignment } from '../../lib/api';

export const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Soumis',
  FORWARDER_VALIDATED: 'Validé transitaire',
  IN_TRANSIT: 'En transit',
  ARRIVED_DUBAI: 'Arrivé à Dubaï',
  AUDIT_VALIDATED: 'Validé et payé',
  REJECTED: 'Rejeté',
};

export const GOLD_TYPE_LABELS: Record<string, string> = {
  nuggets: 'Pépites',
  powder: 'Poudre',
  bar: 'Barre',
};

export function statusColor(status: string, c: ReturnType<typeof useThemeColors>): string {
  if (status === 'AUDIT_VALIDATED') return c.success;
  if (status === 'REJECTED') return c.error;
  if (status === 'SUBMITTED') return c.gold;
  return c.textSecondary;
}

export default function ProducerConsignmentsScreen() {
  const c = useThemeColors();
  const [items, setItems] = useState<Consignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.getMyConsignments();
      setItems(res.data?.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement impossible');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload on focus: a lot's status changes while the producer is away.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.gold} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
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
        ListHeaderComponent={
          error ? (
            <View style={[styles.errorBox, { backgroundColor: c.error + '20' }]}>
              <Text style={{ color: c.error }}>{error}</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="cube-outline" size={48} color={c.textTertiary} />
            <Text style={[styles.emptyTitle, { color: c.text }]}>Aucun lot déclaré</Text>
            <Text style={[styles.emptyText, { color: c.textSecondary }]}>
              Déclarez un lot d'or pour l'envoyer à l'export. Vous serez payé en tokens à la
              validation de l'audit.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
            onPress={() => router.push(`/(producer)/${item.id}`)}
          >
            <View style={styles.cardHeader}>
              <Text style={[styles.reference, { color: c.text }]}>{item.reference}</Text>
              <Text style={[styles.status, { color: statusColor(item.status, c) }]}>
                {STATUS_LABELS[item.status] || item.status}
              </Text>
            </View>
            <Text style={[styles.detail, { color: c.textSecondary }]}>
              {item.weight_declared_g.toLocaleString('fr-FR')} g ·{' '}
              {GOLD_TYPE_LABELS[item.gold_type] || item.gold_type} ·{' '}
              {Math.round(item.purity_declared * 24)} carats
            </Text>
            {item.producer_tokens_credited != null && (
              <Text style={[styles.credited, { color: c.success }]}>
                {item.producer_tokens_credited.toLocaleString('fr-FR')} g crédités en tokens
              </Text>
            )}
          </TouchableOpacity>
        )}
      />

      <TouchableOpacity
        style={[styles.fab, { backgroundColor: c.gold }]}
        onPress={() => router.push('/(producer)/new')}
      >
        <Ionicons name="add" size={28} color="#000" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, paddingBottom: 96 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reference: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  status: { fontSize: 12, fontWeight: '600' },
  detail: { fontSize: 13, marginTop: 6 },
  credited: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  empty: { alignItems: 'center', paddingTop: 64, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '600', marginTop: 12 },
  emptyText: { fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  errorBox: { borderRadius: 12, padding: 12, marginBottom: 12 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
});
