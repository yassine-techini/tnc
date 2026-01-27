import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../lib/api';

const typeLabels: Record<string, string> = { BUY: 'Achat', SELL: 'Vente', DEPOSIT: 'Depot', WITHDRAWAL: 'Retrait', FEE: 'Frais' };
const typeIcons: Record<string, { name: React.ComponentProps<typeof Ionicons>['name']; color: string; bg: string }> = {
  BUY: { name: 'cart', color: '#10B981', bg: 'rgba(16, 185, 129, 0.12)' },
  SELL: { name: 'swap-horizontal', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.12)' },
  DEPOSIT: { name: 'arrow-down', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.12)' },
  WITHDRAWAL: { name: 'arrow-up', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.12)' },
  FEE: { name: 'receipt', color: '#6B7280', bg: 'rgba(107, 114, 128, 0.12)' },
};

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const { tokens } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);

  const { data: walletData, isLoading, refetch: refetchWallet } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifie');
      return api.getWallet(tokens.accessToken);
    },
    enabled: !!tokens?.accessToken,
  });

  const { data: priceData, refetch: refetchPrice } = useQuery({
    queryKey: ['price'],
    queryFn: () => api.getPrice(),
  });

  const { data: txData, refetch: refetchTx } = useQuery({
    queryKey: ['transactions'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifie');
      return api.getTransactions(tokens.accessToken, 1, 10);
    },
    enabled: !!tokens?.accessToken,
  });

  const wallet = walletData?.data;
  const price = priceData?.data;
  const transactions = txData?.data?.items || [];

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchWallet(), refetchPrice(), refetchTx()]);
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top + 8 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4AF37" />}
    >
      {/* Title */}
      <Text style={styles.pageTitle}>Portefeuille</Text>

      {/* Gold Balance */}
      <View style={styles.goldCard}>
        <View style={styles.goldHeader}>
          <Ionicons name="diamond" size={20} color="#D4AF37" />
          <Text style={styles.goldLabel}>Solde Or</Text>
        </View>
        {isLoading ? <View style={styles.skeleton} /> : (
          <>
            <Text style={styles.goldValue}>{wallet?.tokenBalance?.toFixed(3) || '0.000'} g</Text>
            <Text style={styles.goldSubtext}>Valeur: {((wallet?.tokenBalance || 0) * (price?.sellPrice || 0)).toLocaleString()} XOF</Text>
          </>
        )}
      </View>

      {/* Cash Balance */}
      <View style={styles.cashCard}>
        <View style={styles.goldHeader}>
          <Ionicons name="cash" size={20} color="#10B981" />
          <Text style={styles.cashLabel}>Solde Disponible</Text>
        </View>
        {isLoading ? <View style={styles.skeleton} /> : (
          <Text style={styles.cashValue}>{(wallet?.cashBalance || 0).toLocaleString()} XOF</Text>
        )}
      </View>

      {/* Performance */}
      <View style={styles.performanceCard}>
        <Text style={styles.sectionTitle}>Performance</Text>
        <View style={styles.performanceGrid}>
          <View style={styles.performanceItem}>
            <Text style={styles.performanceLabel}>Prix moyen</Text>
            <Text style={styles.performanceValue}>{wallet?.averageBuyPrice?.toLocaleString() || '—'} XOF/g</Text>
          </View>
          <View style={styles.performanceItem}>
            <Text style={styles.performanceLabel}>Prix actuel</Text>
            <Text style={styles.performanceValue}>{price?.sellPrice?.toLocaleString() || '—'} XOF/g</Text>
          </View>
          <View style={styles.performanceItem}>
            <Text style={styles.performanceLabel}>Gain/Perte</Text>
            <Text style={[styles.performanceValue, { color: (wallet?.profitLoss || 0) >= 0 ? '#10B981' : '#EF4444' }]}>
              {(wallet?.profitLoss || 0) >= 0 ? '+' : ''}{(wallet?.profitLoss || 0).toLocaleString()} XOF
            </Text>
          </View>
          <View style={styles.performanceItem}>
            <Text style={styles.performanceLabel}>Rendement</Text>
            <Text style={[styles.performanceValue, { color: (wallet?.profitLossPercent || 0) >= 0 ? '#10B981' : '#EF4444' }]}>
              {(wallet?.profitLossPercent || 0) >= 0 ? '+' : ''}{(wallet?.profitLossPercent || 0).toFixed(2)}%
            </Text>
          </View>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actionsCard}>
        <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/(wallet)/deposit')} activeOpacity={0.7}>
          <View style={[styles.actionIconBg, { backgroundColor: 'rgba(16, 185, 129, 0.12)' }]}>
            <Ionicons name="arrow-down" size={20} color="#10B981" />
          </View>
          <Text style={styles.actionText}>Deposer</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/(wallet)/withdraw')} activeOpacity={0.7}>
          <View style={[styles.actionIconBg, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
            <Ionicons name="arrow-up" size={20} color="#EF4444" />
          </View>
          <Text style={styles.actionText}>Retirer</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/(wallet)/certificate')} activeOpacity={0.7}>
          <View style={[styles.actionIconBg, { backgroundColor: 'rgba(99, 102, 241, 0.12)' }]}>
            <Ionicons name="document-text" size={20} color="#6366F1" />
          </View>
          <Text style={styles.actionText}>Certificat</Text>
        </TouchableOpacity>
      </View>

      {/* Transactions */}
      <View style={styles.transactionsCard}>
        <Text style={styles.sectionTitle}>Transactions recentes</Text>
        {transactions.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={40} color="#374151" />
            <Text style={styles.emptyText}>Aucune transaction</Text>
          </View>
        ) : (
          transactions.map((tx: any) => {
            const icon = typeIcons[tx.type] || typeIcons.FEE;
            return (
              <View key={tx.id} style={styles.txItem}>
                <View style={styles.txLeft}>
                  <View style={[styles.txIcon, { backgroundColor: icon.bg }]}>
                    <Ionicons name={icon.name} size={16} color={icon.color} />
                  </View>
                  <View>
                    <Text style={styles.txType}>{typeLabels[tx.type]}</Text>
                    <Text style={styles.txDate}>{new Date(tx.createdAt).toLocaleDateString('fr-FR')}</Text>
                  </View>
                </View>
                <Text style={[styles.txAmount, { color: tx.type === 'BUY' || tx.type === 'DEPOSIT' ? '#10B981' : '#D1D5DB' }]}>
                  {tx.type === 'BUY' || tx.type === 'DEPOSIT' ? '+' : '-'}
                  {tx.tokenAmount ? `${tx.tokenAmount.toFixed(3)} g` : `${tx.cashAmount.toLocaleString()} XOF`}
                </Text>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A', padding: 16 },
  pageTitle: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 16, paddingTop: 8 },
  goldCard: { backgroundColor: '#1A1A2E', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: 'rgba(212, 175, 55, 0.2)', marginBottom: 10 },
  goldHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  goldLabel: { fontSize: 13, color: '#D4AF37', fontWeight: '600' },
  goldValue: { fontSize: 30, fontWeight: '800', color: '#D4AF37' },
  goldSubtext: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  cashCard: { backgroundColor: '#1A1A2E', borderRadius: 16, padding: 20, marginBottom: 16 },
  cashLabel: { fontSize: 13, color: '#10B981', fontWeight: '600' },
  cashValue: { fontSize: 26, fontWeight: '700', color: '#fff' },
  skeleton: { height: 36, backgroundColor: '#374151', borderRadius: 8, marginTop: 4 },
  performanceCard: { backgroundColor: '#1A1A2E', borderRadius: 14, padding: 16, marginBottom: 14 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 14 },
  performanceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  performanceItem: { width: '46%' },
  performanceLabel: { fontSize: 11, color: '#6B7280' },
  performanceValue: { fontSize: 15, fontWeight: '600', color: '#D1D5DB', marginTop: 3 },
  actionsCard: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  actionButton: { flex: 1, backgroundColor: '#1A1A2E', borderRadius: 12, padding: 14, alignItems: 'center', gap: 8 },
  actionIconBg: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 12, color: '#D1D5DB', fontWeight: '500' },
  transactionsCard: { backgroundColor: '#1A1A2E', borderRadius: 14, padding: 16, marginBottom: 32 },
  emptyState: { alignItems: 'center', padding: 28, gap: 10 },
  emptyText: { color: '#6B7280', fontSize: 14 },
  txItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.06)' },
  txLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  txIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  txType: { fontSize: 14, fontWeight: '500', color: '#D1D5DB' },
  txDate: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  txAmount: { fontSize: 14, fontWeight: '600' },
});
