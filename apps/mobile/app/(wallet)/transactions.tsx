import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/auth';
import { useThemeColors } from '../../stores/theme';
import { api } from '../../lib/api';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const TYPE_LABELS: Record<string, string> = {
  BUY: 'Achat',
  SELL: 'Vente',
  DEPOSIT: 'Depot',
  WITHDRAWAL: 'Retrait',
  FEE: 'Frais',
  CONSIGNMENT: 'Lot consigne',
};

const TYPE_ICONS: Record<string, { name: IoniconsName; color: string; bg: string }> = {
  BUY: { name: 'cart', color: '#10B981', bg: 'rgba(16, 185, 129, 0.12)' },
  SELL: { name: 'swap-horizontal', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.12)' },
  DEPOSIT: { name: 'arrow-down', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.12)' },
  WITHDRAWAL: { name: 'arrow-up', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.12)' },
  FEE: { name: 'receipt', color: '#6B7280', bg: 'rgba(107, 114, 128, 0.12)' },
  CONSIGNMENT: { name: 'cube', color: '#10B981', bg: 'rgba(16, 185, 129, 0.12)' },
};

/** Types that ADD to the balance — see the note in the wallet tab. */
const CREDIT_TYPES = ['BUY', 'DEPOSIT', 'CONSIGNMENT'];

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'En attente',
  PROCESSING: 'En cours',
  COMPLETED: 'Complétée',
  FAILED: 'Échouée',
  CANCELLED: 'Annulée',
};

const FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Tous' },
  { value: 'BUY', label: 'Achats' },
  { value: 'SELL', label: 'Ventes' },
  { value: 'CONSIGNMENT', label: 'Lots' },
  { value: 'WITHDRAWAL', label: 'Retraits' },
];

interface Tx {
  id: string;
  type: string;
  status: string;
  tokenAmount: number | null;
  cashAmount: number;
  createdAt: string;
}

export default function TransactionsScreen() {
  const c = useThemeColors();
  const { tokens } = useAuthStore();
  const [items, setItems] = useState<Tx[]>([]);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (targetPage: number, replace: boolean) => {
      if (!tokens?.accessToken) return;
      try {
        setError(null);
        const res = await api.getTransactions(tokens.accessToken, targetPage, 20);
        const fetched = (res.data?.items || []) as Tx[];
        setItems((prev) => (replace ? fetched : [...prev, ...fetched]));
        setHasMore(Boolean(res.data?.hasMore));
        setPage(targetPage);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Chargement impossible');
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [tokens?.accessToken]
  );

  useEffect(() => {
    load(1, true);
  }, [load]);

  // Filtering is client-side on purpose: the API paginates without a type
  // filter, so filtering server-side here would silently hide pages.
  const visible = filter ? items.filter((t) => t.type === filter) : items;

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.gold} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.value || 'all'}
            onPress={() => setFilter(f.value)}
            style={[
              styles.chip,
              { borderColor: c.border, backgroundColor: filter === f.value ? c.gold : c.surface },
            ]}
          >
            <Text style={{ color: filter === f.value ? '#000' : c.textSecondary, fontSize: 13, fontWeight: '600' }}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load(1, true);
            }}
            tintColor={c.gold}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          // Only paginate on the unfiltered list: a filtered view can look empty
          // while more pages exist, and chasing that would loop.
          if (hasMore && !loadingMore && !filter) {
            setLoadingMore(true);
            load(page + 1, false);
          }
        }}
        ListHeaderComponent={
          error ? (
            <View style={[styles.errorBox, { backgroundColor: c.error + '20' }]}>
              <Text style={{ color: c.error }}>{error}</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={44} color={c.textTertiary} />
            <Text style={{ color: c.textSecondary, marginTop: 10 }}>
              {filter ? 'Aucune transaction de ce type' : 'Aucune transaction'}
            </Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? <ActivityIndicator color={c.gold} style={{ marginVertical: 16 }} /> : null
        }
        renderItem={({ item }) => {
          const icon = TYPE_ICONS[item.type] || TYPE_ICONS.FEE;
          const credit = CREDIT_TYPES.includes(item.type);
          return (
            <View style={[styles.row, { borderBottomColor: c.border }]}>
              <View style={[styles.icon, { backgroundColor: icon.bg }]}>
                <Ionicons name={icon.name} size={16} color={icon.color} />
              </View>
              <View style={styles.rowText}>
                <Text style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>
                  {TYPE_LABELS[item.type] || item.type}
                </Text>
                <Text style={{ color: c.textTertiary, fontSize: 12, marginTop: 2 }}>
                  {new Date(item.createdAt).toLocaleDateString('fr-FR')}
                  {item.status !== 'COMPLETED' ? ` · ${STATUS_LABELS[item.status] || item.status}` : ''}
                </Text>
              </View>
              <Text style={{ color: credit ? '#10B981' : c.text, fontSize: 14, fontWeight: '700' }}>
                {credit ? '+' : '-'}
                {item.tokenAmount != null
                  ? `${item.tokenAmount.toFixed(3)} g`
                  : `${item.cashAmount.toLocaleString('fr-FR')} XOF`}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  filters: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', padding: 16, paddingBottom: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  empty: { alignItems: 'center', paddingTop: 56 },
  errorBox: { borderRadius: 12, padding: 12, marginBottom: 12 },
});
