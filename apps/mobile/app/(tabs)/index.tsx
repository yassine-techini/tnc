import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../lib/api';
import { useState } from 'react';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, tokens } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);

  const { data: priceData, isLoading: priceLoading, refetch: refetchPrice } = useQuery({
    queryKey: ['price'],
    queryFn: () => api.getPrice(),
    refetchInterval: 60000,
  });

  const { data: walletData, isLoading: walletLoading, refetch: refetchWallet } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifie');
      return api.getWallet(tokens.accessToken);
    },
    enabled: !!tokens?.accessToken,
  });

  const price = priceData?.data;
  const wallet = walletData?.data;

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchPrice(), refetchWallet()]);
    setRefreshing(false);
  };

  const portfolioValue = (wallet?.tokenBalance || 0) * (price?.sellPrice || 0) + (wallet?.cashBalance || 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: insets.top }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4AF37" />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.greeting}>Bonjour {user?.email?.split('@')[0] || ''}</Text>
          <Text style={styles.subtitle}>Bienvenue sur TNC Trading</Text>
        </View>
        <TouchableOpacity
          style={styles.avatarButton}
          onPress={() => router.push('/(tabs)/profile')}
        >
          <Text style={styles.avatarText}>{user?.email?.charAt(0).toUpperCase() || '?'}</Text>
        </TouchableOpacity>
      </View>

      {/* KYC Alert */}
      {user?.kycLevel === 'BASIC' && (
        <TouchableOpacity style={styles.kycAlert} onPress={() => router.push('/(kyc)')}>
          <View style={styles.kycAlertLeft}>
            <Ionicons name="shield-checkmark-outline" size={20} color="#F59E0B" />
            <View style={styles.kycAlertContent}>
              <Text style={styles.kycAlertTitle}>Verification requise</Text>
              <Text style={styles.kycAlertText}>
                Completez votre KYC pour acheter et vendre de l'or
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#F59E0B" />
        </TouchableOpacity>
      )}

      {/* Portfolio Card */}
      <View style={styles.portfolioCard}>
        <Text style={styles.portfolioLabel}>Valeur du portefeuille</Text>
        {walletLoading ? (
          <View style={styles.skeleton} />
        ) : (
          <>
            <Text style={styles.portfolioValue}>{portfolioValue.toLocaleString()} XOF</Text>
            {wallet && (wallet.profitLossPercent || 0) !== 0 && (
              <View style={[
                styles.performanceBadge,
                { backgroundColor: (wallet.profitLossPercent || 0) >= 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)' }
              ]}>
                <Ionicons
                  name={(wallet.profitLossPercent || 0) >= 0 ? 'trending-up' : 'trending-down'}
                  size={14}
                  color={(wallet.profitLossPercent || 0) >= 0 ? '#10B981' : '#EF4444'}
                />
                <Text style={[
                  styles.performanceText,
                  { color: (wallet.profitLossPercent || 0) >= 0 ? '#10B981' : '#EF4444' }
                ]}>
                  {(wallet.profitLossPercent || 0) >= 0 ? '+' : ''}{(wallet.profitLossPercent || 0).toFixed(2)}%
                </Text>
              </View>
            )}
          </>
        )}
      </View>

      {/* Balance Cards */}
      <View style={styles.balanceContainer}>
        <View style={[styles.balanceCard, styles.goldCard]}>
          <View style={styles.balanceHeader}>
            <Ionicons name="diamond-outline" size={16} color="#D4AF37" />
            <Text style={styles.balanceLabelGold}>Solde Or</Text>
          </View>
          {walletLoading ? (
            <View style={styles.skeletonSmall} />
          ) : (
            <>
              <Text style={styles.goldValue}>{wallet?.tokenBalance?.toFixed(3) || '0.000'} g</Text>
              <Text style={styles.balanceSubtext}>
                {((wallet?.tokenBalance || 0) * (price?.sellPrice || 0)).toLocaleString()} XOF
              </Text>
            </>
          )}
        </View>
        <View style={styles.balanceCard}>
          <View style={styles.balanceHeader}>
            <Ionicons name="cash-outline" size={16} color="#9CA3AF" />
            <Text style={styles.balanceLabel}>Solde XOF</Text>
          </View>
          {walletLoading ? (
            <View style={styles.skeletonSmall} />
          ) : (
            <Text style={styles.balanceValue}>{(wallet?.cashBalance || 0).toLocaleString()} XOF</Text>
          )}
        </View>
      </View>

      {/* Price Card */}
      <View style={styles.priceCard}>
        <View style={styles.priceRow}>
          <View>
            <Text style={styles.priceLabel}>Prix de l'or</Text>
            {priceLoading ? (
              <View style={styles.skeletonSmall} />
            ) : (
              <Text style={styles.priceValue}>
                {price?.priceXof?.toLocaleString() || '—'} XOF/g
              </Text>
            )}
          </View>
          <View style={[
            styles.changeBadge,
            { backgroundColor: (price?.change24h || 0) >= 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)' }
          ]}>
            <Ionicons
              name={(price?.change24h || 0) >= 0 ? 'arrow-up' : 'arrow-down'}
              size={12}
              color={(price?.change24h || 0) >= 0 ? '#10B981' : '#EF4444'}
            />
            <Text style={[
              styles.changeText,
              { color: (price?.change24h || 0) >= 0 ? '#10B981' : '#EF4444' }
            ]}>
              {Math.abs(price?.change24h || 0).toFixed(2)}%
            </Text>
          </View>
        </View>
        <View style={styles.priceDetails}>
          <View style={styles.priceDetailItem}>
            <Text style={styles.priceDetailLabel}>Achat</Text>
            <Text style={styles.priceDetailValue}>{price?.buyPrice?.toLocaleString() || '—'} XOF</Text>
          </View>
          <View style={styles.priceDetailDivider} />
          <View style={styles.priceDetailItem}>
            <Text style={styles.priceDetailLabel}>Vente</Text>
            <Text style={styles.priceDetailValue}>{price?.sellPrice?.toLocaleString() || '—'} XOF</Text>
          </View>
        </View>
      </View>

      {/* Quick Actions - Trading */}
      <Text style={styles.sectionTitle}>Actions rapides</Text>
      <View style={styles.tradingActions}>
        <Link href="/market" asChild>
          <TouchableOpacity style={styles.buyButton} activeOpacity={0.8}>
            <Ionicons name="cart-outline" size={20} color="#fff" />
            <Text style={styles.tradingText}>Acheter</Text>
          </TouchableOpacity>
        </Link>
        <Link href="/market" asChild>
          <TouchableOpacity style={styles.sellButton} activeOpacity={0.8}>
            <Ionicons name="swap-horizontal-outline" size={20} color="#fff" />
            <Text style={styles.tradingText}>Vendre</Text>
          </TouchableOpacity>
        </Link>
      </View>

      {/* Quick Actions - Wallet */}
      <View style={styles.walletActions}>
        <TouchableOpacity style={styles.walletButton} onPress={() => router.push('/(wallet)/deposit')}>
          <View style={[styles.walletIconBg, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
            <Ionicons name="arrow-down-outline" size={18} color="#10B981" />
          </View>
          <Text style={styles.walletText}>Deposer</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.walletButton} onPress={() => router.push('/(wallet)/withdraw')}>
          <View style={[styles.walletIconBg, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
            <Ionicons name="arrow-up-outline" size={18} color="#EF4444" />
          </View>
          <Text style={styles.walletText}>Retirer</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.walletButton} onPress={() => router.push('/(tabs)/wallet')}>
          <View style={[styles.walletIconBg, { backgroundColor: 'rgba(212, 175, 55, 0.15)' }]}>
            <Ionicons name="time-outline" size={18} color="#D4AF37" />
          </View>
          <Text style={styles.walletText}>Historique</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.walletButton} onPress={() => router.push('/(wallet)/certificate')}>
          <View style={[styles.walletIconBg, { backgroundColor: 'rgba(99, 102, 241, 0.15)' }]}>
            <Ionicons name="document-text-outline" size={18} color="#6366F1" />
          </View>
          <Text style={styles.walletText}>Certificat</Text>
        </TouchableOpacity>
      </View>

      {/* KYC Level */}
      <View style={styles.kycCard}>
        <View style={styles.kycHeader}>
          <View style={styles.kycLeft}>
            <Ionicons name="shield-checkmark" size={20} color="#D4AF37" />
            <Text style={styles.kycTitle}>Niveau KYC</Text>
          </View>
          <View style={[
            styles.kycBadge,
            user?.kycLevel === 'VERIFIED' ? styles.kycBadgeSuccess :
            user?.kycLevel === 'STANDARD' ? styles.kycBadgeInfo : styles.kycBadgeWarning
          ]}>
            <Text style={[
              styles.kycBadgeText,
              user?.kycLevel === 'VERIFIED' ? { color: '#10B981' } :
              user?.kycLevel === 'STANDARD' ? { color: '#3B82F6' } : { color: '#F59E0B' }
            ]}>{user?.kycLevel || 'BASIC'}</Text>
          </View>
        </View>
        <Text style={styles.kycDescription}>
          {user?.kycLevel === 'VERIFIED'
            ? 'Acces complet a la plateforme'
            : 'Augmentez vos limites en completant votre KYC'}
        </Text>
        {user?.kycLevel !== 'VERIFIED' && (
          <TouchableOpacity
            style={styles.kycButton}
            onPress={() => router.push('/(kyc)')}
            activeOpacity={0.8}
          >
            <Text style={styles.kycButtonText}>Ameliorer mon niveau</Text>
            <Ionicons name="arrow-forward" size={16} color="#0F0F1A" />
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1A',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingTop: 8,
  },
  headerLeft: {
    flex: 1,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  avatarButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(212, 175, 55, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#D4AF37',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#D4AF37',
  },
  kycAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  kycAlertLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  kycAlertContent: {
    flex: 1,
  },
  kycAlertTitle: {
    color: '#F59E0B',
    fontWeight: '600',
    fontSize: 13,
  },
  kycAlertText: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 1,
  },
  portfolioCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  portfolioLabel: {
    fontSize: 13,
    color: '#9CA3AF',
    marginBottom: 4,
  },
  portfolioValue: {
    fontSize: 30,
    fontWeight: '800',
    color: '#fff',
  },
  performanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  performanceText: {
    fontSize: 13,
    fontWeight: '600',
  },
  skeleton: {
    height: 36,
    backgroundColor: '#374151',
    borderRadius: 8,
    marginTop: 4,
  },
  skeletonSmall: {
    height: 20,
    backgroundColor: '#374151',
    borderRadius: 6,
    marginTop: 4,
  },
  balanceContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  balanceCard: {
    flex: 1,
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 14,
  },
  goldCard: {
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.15)',
  },
  balanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  balanceLabel: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  balanceLabelGold: {
    fontSize: 12,
    color: '#D4AF37',
  },
  balanceValue: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  goldValue: {
    fontSize: 17,
    fontWeight: '700',
    color: '#D4AF37',
  },
  balanceSubtext: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  priceCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceLabel: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  priceValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#D4AF37',
    marginTop: 2,
  },
  changeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  changeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  priceDetails: {
    flexDirection: 'row',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  priceDetailItem: {
    flex: 1,
    alignItems: 'center',
  },
  priceDetailDivider: {
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  priceDetailLabel: {
    fontSize: 11,
    color: '#6B7280',
  },
  priceDetailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D1D5DB',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  tradingActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  buyButton: {
    flex: 1,
    backgroundColor: '#10B981',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  sellButton: {
    flex: 1,
    backgroundColor: '#EF4444',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  tradingText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  walletActions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  walletButton: {
    flex: 1,
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 8,
  },
  walletIconBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  kycCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
  },
  kycHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  kycLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  kycTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  kycBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  kycBadgeWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  kycBadgeInfo: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
  },
  kycBadgeSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  kycBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  kycDescription: {
    fontSize: 13,
    color: '#9CA3AF',
    marginBottom: 12,
  },
  kycButton: {
    backgroundColor: '#D4AF37',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  kycButtonText: {
    color: '#0F0F1A',
    fontWeight: '600',
    fontSize: 14,
  },
});
