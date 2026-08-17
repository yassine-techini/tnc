import { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/auth';
import { useThemeColors } from '../../stores/theme';
import { api } from '../../lib/api';
import InlineMessage from '../../components/InlineMessage';
import ConfirmDialog from '../../components/ConfirmDialog';

const CHART_WIDTH = Dimensions.get('window').width - 72; // padding + card padding
const CHART_HEIGHT = 60;

// Simple sparkline chart component
function MiniChart({ data, color }: { data: number[]; color: string }) {
  const c = useThemeColors();
  const points = useMemo(() => {
    if (!data || data.length < 2) return [];

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    return data.map((value, index) => ({
      x: (index / (data.length - 1)) * CHART_WIDTH,
      y: CHART_HEIGHT - ((value - min) / range) * CHART_HEIGHT,
    }));
  }, [data]);

  if (points.length < 2) {
    return (
      <View style={[chartStyles.container, { height: CHART_HEIGHT }]}>
        <Text style={[chartStyles.noData, { color: c.textTertiary }]}>Chargement...</Text>
      </View>
    );
  }

  return (
    <View style={[chartStyles.container, { height: CHART_HEIGHT }]}>
      {/* Render line segments */}
      {points.slice(0, -1).map((point, index) => {
        const nextPoint = points[index + 1];
        const dx = nextPoint.x - point.x;
        const dy = nextPoint.y - point.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);

        return (
          <View
            key={index}
            style={[
              chartStyles.line,
              {
                width: length,
                backgroundColor: color,
                left: point.x,
                top: point.y,
                transform: [{ rotate: `${angle}deg` }],
              },
            ]}
          />
        );
      })}
      {/* Render points */}
      {points.map((point, index) => (
        <View
          key={`point-${index}`}
          style={[
            chartStyles.point,
            {
              left: point.x - 2,
              top: point.y - 2,
              backgroundColor: index === points.length - 1 ? color : 'transparent',
              borderColor: color,
            },
          ]}
        />
      ))}
    </View>
  );
}

const chartStyles = StyleSheet.create({
  container: {
    width: CHART_WIDTH,
    position: 'relative',
    marginTop: 12,
  },
  noData: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
  },
  line: {
    position: 'absolute',
    height: 2,
    transformOrigin: 'left center',
  },
  point: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    borderWidth: 1,
  },
});

type TabType = 'buy' | 'sell';
type PaymentMethod = 'orange_money' | 'moov_money' | 'wave' | 'bank_transfer';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const PAYMENT_METHODS: { id: PaymentMethod; name: string; icon: IoniconsName; color: string }[] = [
  { id: 'orange_money', name: 'Orange Money', icon: 'phone-portrait-outline', color: '#F97316' },
  { id: 'moov_money', name: 'Moov Money', icon: 'phone-portrait-outline', color: '#3B82F6' },
  { id: 'wave', name: 'Wave', icon: 'water-outline', color: '#06B6D4' },
  { id: 'bank_transfer', name: 'Virement', icon: 'business-outline', color: '#8B5CF6' },
];

const QUICK_AMOUNTS_GRAMS = [0.1, 0.5, 1, 5, 10];
const QUICK_AMOUNTS_XOF = [5000, 10000, 25000, 50000, 100000];

export default function MarketScreen() {
  const insets = useSafeAreaInsets();
  const { tokens, user } = useAuthStore();
  const c = useThemeColors();
  const [tab, setTab] = useState<TabType>('buy');
  const [amount, setAmount] = useState('');
  const [amountType, setAmountType] = useState<'grams' | 'xof'>('grams');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('orange_money');
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success' | 'warning' | 'info'; text: string } | null>(null);
  const [confirmData, setConfirmData] = useState<{ quoteId: string; tokenAmount: number; total: number; fees: number } | null>(null);

  const { data: priceData, isLoading: priceLoading } = useQuery({
    queryKey: ['price'],
    queryFn: () => api.getPrice(),
    refetchInterval: 5 * 60 * 1000, // 5 min — saves battery vs 60s polling
  });

  const { data: stockData } = useQuery({
    queryKey: ['stock'],
    queryFn: () => api.getStock(),
  });

  const { data: priceHistoryData } = useQuery({
    queryKey: ['priceHistory'],
    // Aucun repli fabriqué.
    //
    // Cette requête inventait 24 points de prix aléatoires quand l'API ne
    // répondait pas (`basePrice * (1 + (Math.random() - 0.5) * 0.04)`) et les
    // affichait comme une vraie courbe. Un utilisateur voyait donc une
    // évolution du cours de l'or entièrement simulée, sans rien pour l'en
    // avertir — sur une application où l'on décide d'acheter ou de vendre.
    //
    // En cas d'échec, la requête échoue : le graphique ne s'affiche pas, ce qui
    // est la seule chose honnête à montrer quand on ne connaît pas le cours.
    queryFn: () => api.getPriceHistory('24h'),
    // No polling — relies on staleTime (10 min) + pull-to-refresh to save battery
  });

  const chartData = useMemo(() => {
    if (!priceHistoryData?.data?.items) return [];
    return priceHistoryData.data.items.map((p) => p.priceXof);
  }, [priceHistoryData]);

  const { data: walletData } = useQuery({
    queryKey: ['wallet'],
    queryFn: () => api.getWallet(tokens!.accessToken),
    enabled: !!tokens?.accessToken,
  });

  const price = priceData?.data;
  const stock = stockData?.data;
  const wallet = walletData?.data;

  const calculateTotal = () => {
    const numAmount = parseFloat(amount) || 0;
    if (amountType === 'grams') {
      return tab === 'buy'
        ? numAmount * (price?.buyPrice || 0)
        : numAmount * (price?.sellPrice || 0);
    } else {
      return tab === 'buy'
        ? numAmount / (price?.buyPrice || 1)
        : numAmount / (price?.sellPrice || 1);
    }
  };

  const getQuickAmounts = () => {
    return amountType === 'grams' ? QUICK_AMOUNTS_GRAMS : QUICK_AMOUNTS_XOF;
  };

  const formatQuickAmount = (value: number) => {
    if (amountType === 'grams') {
      return `${value}g`;
    }
    return value >= 1000 ? `${value / 1000}k` : `${value}`;
  };

  const handleQuickAmount = (value: number) => {
    setAmount(value.toString());
  };

  const handleTransaction = async () => {
    setMessage(null);
    setConfirmData(null);

    if (!tokens?.accessToken) {
      setMessage({ type: 'warning', text: 'Vous devez vous connecter pour effectuer des transactions.' });
      return;
    }

    if (user?.kycLevel === 'BASIC') {
      setMessage({ type: 'warning', text: 'Completez votre KYC pour effectuer des transactions' });
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setMessage({ type: 'error', text: 'Veuillez entrer un montant valide' });
      return;
    }

    if (tab === 'sell' && wallet) {
      const tokenAmount = amountType === 'grams'
        ? parseFloat(amount)
        : parseFloat(amount) / (price?.sellPrice || 1);
      if (tokenAmount > wallet.tokenBalance) {
        setMessage({ type: 'error', text: `Solde insuffisant. Vous n'avez que ${wallet.tokenBalance.toFixed(3)}g d'or` });
        return;
      }
    }

    setIsProcessing(true);
    try {
      const quoteResponse = await api.getQuote(
        tab === 'buy' ? 'BUY' : 'SELL',
        parseFloat(amount),
        amountType,
        tokens!.accessToken
      );
      const quote = quoteResponse.data;
      setConfirmData({ quoteId: quote.quoteId, tokenAmount: quote.tokenAmount, total: quote.total, fees: quote.fees || 0 });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Erreur lors du devis' });
    } finally {
      setIsProcessing(false);
    }
  };

  const executeTransaction = async () => {
    if (!confirmData || !tokens?.accessToken) return;
    setIsProcessing(true);
    try {
      if (tab === 'buy') {
        await api.executeBuy(confirmData.quoteId, paymentMethod, tokens.accessToken);
      } else {
        await api.executeSell(confirmData.quoteId, paymentMethod, tokens.accessToken);
      }
      setMessage({
        type: 'success',
        text: tab === 'buy'
          ? `Vous avez achete ${confirmData.tokenAmount.toFixed(3)}g d'or !`
          : `Vous avez vendu ${confirmData.tokenAmount.toFixed(3)}g d'or !`
      });
      setAmount('');
      setConfirmData(null);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Echec de la transaction' });
      setConfirmData(null);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={[styles.container, { backgroundColor: c.background }]} contentContainerStyle={{ paddingTop: insets.top + 8 }} keyboardShouldPersistTaps="handled">
        {/* Price Card */}
      <View style={[styles.priceCard, { backgroundColor: c.surface }]}>
        <View style={styles.priceHeader}>
          <View>
            <Text style={[styles.priceLabel, { color: c.textSecondary }]}>Prix actuel de l'or</Text>
            {priceLoading ? (
              <View style={styles.skeleton} />
            ) : (
              <Text style={[styles.priceValue, { color: c.gold }]}>
                {price?.priceXof?.toLocaleString() || '—'} XOF/g
              </Text>
            )}
          </View>
          <View style={styles.priceChange}>
            <Text style={[styles.priceChangeLabel, { color: c.textSecondary }]}>24h</Text>
            <Text style={[
              styles.priceChangeValue,
              { color: (price?.change24h || 0) >= 0 ? '#10B981' : '#EF4444' }
            ]}>
              {(price?.change24h || 0) >= 0 ? '+' : ''}{(price?.change24h || 0).toFixed(2)}%
            </Text>
          </View>
        </View>
        {/* Mini Chart */}
        {chartData.length > 0 && (
          <View style={styles.chartContainer}>
            <MiniChart
              data={chartData}
              color={(price?.change24h || 0) >= 0 ? '#10B981' : '#EF4444'}
            />
            <Text style={[styles.chartLabel, { color: c.textTertiary }]}>Dernières 24h</Text>
          </View>
        )}
        <View style={styles.priceRow}>
          <View style={styles.priceItem}>
            <Text style={[styles.priceItemLabel, { color: c.textSecondary }]}>Achat</Text>
            <Text style={[styles.priceItemValue, { color: c.text }]}>{price?.buyPrice?.toLocaleString()} XOF</Text>
          </View>
          <View style={styles.priceItem}>
            <Text style={[styles.priceItemLabel, { color: c.textSecondary }]}>Vente</Text>
            <Text style={[styles.priceItemValue, { color: c.text }]}>{price?.sellPrice?.toLocaleString()} XOF</Text>
          </View>
        </View>
        <View style={styles.stockInfo}>
          <Text style={[styles.stockText, { color: c.textSecondary }]}>Stock disponible: {stock?.availableStock?.toFixed(0) || '—'}g</Text>
        </View>
      </View>

      {/* Wallet Balance Summary */}
      {wallet && (
        <View style={[styles.balanceCard, { backgroundColor: c.surface }]}>
          <View style={styles.balanceItem}>
            <Text style={[styles.balanceLabel, { color: c.textSecondary }]}>Mon or</Text>
            <Text style={[styles.balanceValue, { color: c.gold }]}>{wallet.tokenBalance.toFixed(3)}g</Text>
          </View>
          <View style={styles.balanceDivider} />
          <View style={styles.balanceItem}>
            <Text style={[styles.balanceLabel, { color: c.textSecondary }]}>Mon solde</Text>
            <Text style={[styles.balanceValue, { color: c.gold }]}>{wallet.cashBalance.toLocaleString()} XOF</Text>
          </View>
        </View>
      )}

      {/* Buy/Sell Tabs */}
      <View style={[styles.tabs, { backgroundColor: c.surface }]}>
        <TouchableOpacity
          testID="marche-onglet-acheter"
          style={[styles.tab, tab === 'buy' && styles.tabActiveBuy]}
          onPress={() => setTab('buy')}
        >
          <Text style={[styles.tabText, { color: tab === 'buy' ? '#fff' : c.textSecondary }, tab === 'buy' && styles.tabTextActive]}>Acheter</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="marche-onglet-vendre"
          style={[styles.tab, tab === 'sell' && styles.tabActiveSell]}
          onPress={() => setTab('sell')}
        >
          <Text style={[styles.tabText, { color: tab === 'sell' ? '#fff' : c.textSecondary }, tab === 'sell' && styles.tabTextActive]}>Vendre</Text>
        </TouchableOpacity>
      </View>

      {/* Amount Input */}
      <View style={styles.inputSection}>
        <View style={styles.inputHeader}>
          <Text style={[styles.inputLabel, { color: c.text }]}>Montant</Text>
          <View style={styles.amountTypeButtons}>
            <TouchableOpacity
              style={[styles.amountTypeBtn, { backgroundColor: amountType === 'grams' ? c.gold : c.border }, amountType === 'grams' && styles.amountTypeBtnActive]}
              testID="marche-unite-grammes"
              onPress={() => { setAmountType('grams'); setAmount(''); }}
            >
              <Text style={[styles.amountTypeBtnText, { color: amountType === 'grams' ? '#0F0F1A' : c.textSecondary }, amountType === 'grams' && styles.amountTypeBtnTextActive]}>Grammes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.amountTypeBtn, { backgroundColor: amountType === 'xof' ? c.gold : c.border }, amountType === 'xof' && styles.amountTypeBtnActive]}
              testID="marche-unite-xof"
              onPress={() => { setAmountType('xof'); setAmount(''); }}
            >
              <Text style={[styles.amountTypeBtnText, { color: amountType === 'xof' ? '#0F0F1A' : c.textSecondary }, amountType === 'xof' && styles.amountTypeBtnTextActive]}>XOF</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={[styles.inputContainer, { backgroundColor: c.surface, borderColor: c.border }]}>
          <TextInput
            testID="marche-montant"
            style={[styles.input, { color: c.text }]}
            placeholder="0.000"
            placeholderTextColor={c.textTertiary}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
          <Text style={[styles.inputSuffix, { color: c.textSecondary }]}>{amountType === 'grams' ? 'g' : 'XOF'}</Text>
        </View>

        {/* Quick Amount Buttons */}
        <View style={styles.quickAmounts}>
          {getQuickAmounts().map((value) => (
            <TouchableOpacity
              key={value}
              style={[
                styles.quickAmountBtn,
                { backgroundColor: amount === value.toString() ? c.gold : c.border },
                amount === value.toString() && styles.quickAmountBtnActive
              ]}
              onPress={() => handleQuickAmount(value)}
            >
              <Text style={[
                styles.quickAmountText,
                { color: amount === value.toString() ? '#0F0F1A' : c.textSecondary },
                amount === value.toString() && styles.quickAmountTextActive
              ]}>
                {formatQuickAmount(value)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Payment Method Selector */}
      <View style={styles.paymentSection}>
        <Text style={[styles.sectionLabel, { color: c.text }]}>Mode de paiement</Text>
        <View style={styles.paymentMethods}>
          {PAYMENT_METHODS.map((method) => (
            <TouchableOpacity
              key={method.id}
              style={[
                styles.paymentMethod,
                { backgroundColor: c.surface, borderColor: paymentMethod === method.id ? c.gold : c.border },
                paymentMethod === method.id && styles.paymentMethodActive
              ]}
              onPress={() => setPaymentMethod(method.id)}
            >
              <Ionicons name={method.icon} size={16} color={paymentMethod === method.id ? method.color : c.textSecondary} />
              <Text style={[
                styles.paymentName,
                { color: paymentMethod === method.id ? c.gold : c.textSecondary },
                paymentMethod === method.id && styles.paymentNameActive
              ]}>
                {method.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Transaction Summary */}
      <View style={[styles.summary, { backgroundColor: c.surface }]}>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: c.textSecondary }]}>Prix unitaire</Text>
          <Text style={[styles.summaryValue, { color: c.text }]}>
            {tab === 'buy' ? price?.buyPrice?.toLocaleString() : price?.sellPrice?.toLocaleString()} XOF/g
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: c.textSecondary }]}>{amountType === 'grams' ? 'Total estimé' : 'Or équivalent'}</Text>
          <Text style={[styles.summaryValueBold, { color: c.gold }]}>
            {amountType === 'grams' ? `${calculateTotal().toLocaleString()} XOF` : `${calculateTotal().toFixed(3)} g`}
          </Text>
        </View>
      </View>

      {message && (
        <InlineMessage
          type={message.type}
          message={message.text}
          onDismiss={() => setMessage(null)}
        />
      )}

      {confirmData && (
        <ConfirmDialog
          title={tab === 'buy' ? "Confirmer l'achat" : 'Confirmer la vente'}
          message={`${tab === 'buy' ? 'Acheter' : 'Vendre'} ${confirmData.tokenAmount.toFixed(3)}g d'or\n\nPrix unitaire: ${(tab === 'buy' ? price?.buyPrice : price?.sellPrice)?.toLocaleString()} XOF/g\nFrais: ${confirmData.fees.toLocaleString()} XOF\nTotal: ${confirmData.total.toLocaleString()} XOF`}
          confirmText={tab === 'buy' ? 'Acheter' : 'Vendre'}
          cancelText="Annuler"
          onConfirm={executeTransaction}
          onCancel={() => setConfirmData(null)}
        />
      )}

      {/* Action Button */}
      <TouchableOpacity
        style={[
          styles.actionButton,
          tab === 'buy' ? styles.actionButtonBuy : styles.actionButtonSell,
          (!amount || parseFloat(amount) <= 0) && styles.actionButtonDisabled,
        ]}
        testID="marche-valider"
        onPress={handleTransaction}
        disabled={!amount || parseFloat(amount) <= 0 || isProcessing}
      >
        {isProcessing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.actionButtonText}>
            {tab === 'buy' ? "Acheter de l'or" : 'Vendre mon or'}
          </Text>
        )}
      </TouchableOpacity>

      <Text style={[styles.disclaimer, { color: c.textTertiary }]}>
        Le prix est valide pendant 60 secondes. Les transactions sont soumises aux limites KYC.
      </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A', padding: 16 },
  priceCard: { backgroundColor: '#1A1A2E', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(212, 175, 55, 0.3)' },
  priceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  priceLabel: { fontSize: 14, color: '#9CA3AF' },
  priceValue: { fontSize: 28, fontWeight: 'bold', color: '#D4AF37', marginTop: 4 },
  skeleton: { height: 36, width: 150, backgroundColor: '#374151', borderRadius: 8, marginTop: 4 },
  priceChange: { alignItems: 'flex-end' },
  priceChangeLabel: { fontSize: 12, color: '#9CA3AF' },
  priceChangeValue: { fontSize: 20, fontWeight: '600' },
  chartContainer: { marginTop: 8, alignItems: 'center' },
  chartLabel: { fontSize: 11, color: '#6B7280', marginTop: 4 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.1)' },
  priceItem: { alignItems: 'center' },
  priceItemLabel: { fontSize: 12, color: '#9CA3AF' },
  priceItemValue: { fontSize: 16, fontWeight: '600', color: '#fff', marginTop: 4 },
  stockInfo: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.1)' },
  stockText: { fontSize: 14, color: '#9CA3AF', textAlign: 'center' },
  balanceCard: { flexDirection: 'row', backgroundColor: '#1A1A2E', borderRadius: 12, padding: 16, marginBottom: 16 },
  balanceItem: { flex: 1, alignItems: 'center' },
  balanceDivider: { width: 1, backgroundColor: 'rgba(255, 255, 255, 0.1)' },
  balanceLabel: { fontSize: 12, color: '#9CA3AF' },
  balanceValue: { fontSize: 18, fontWeight: 'bold', color: '#D4AF37', marginTop: 4 },
  tabs: { flexDirection: 'row', backgroundColor: '#1A1A2E', borderRadius: 12, padding: 4, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10 },
  tabActiveBuy: { backgroundColor: '#10B981' },
  tabActiveSell: { backgroundColor: '#EF4444' },
  tabText: { fontSize: 16, fontWeight: '600', color: '#9CA3AF' },
  tabTextActive: { color: '#fff' },
  inputSection: { marginBottom: 16 },
  inputHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  inputLabel: { fontSize: 14, fontWeight: '500', color: '#D1D5DB' },
  amountTypeButtons: { flexDirection: 'row', gap: 8 },
  amountTypeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: '#374151' },
  amountTypeBtnActive: { backgroundColor: '#D4AF37' },
  amountTypeBtnText: { fontSize: 12, color: '#9CA3AF' },
  amountTypeBtnTextActive: { color: '#0F0F1A', fontWeight: '600' },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A2E', borderWidth: 1, borderColor: '#374151', borderRadius: 12 },
  input: { flex: 1, padding: 16, color: '#fff', fontSize: 18 },
  inputSuffix: { paddingRight: 16, color: '#9CA3AF', fontSize: 16 },
  quickAmounts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  quickAmountBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#374151', minWidth: 60, alignItems: 'center' },
  quickAmountBtnActive: { backgroundColor: '#D4AF37' },
  quickAmountText: { fontSize: 14, fontWeight: '600', color: '#9CA3AF' },
  quickAmountTextActive: { color: '#0F0F1A' },
  paymentSection: { marginBottom: 16 },
  sectionLabel: { fontSize: 14, fontWeight: '500', color: '#D1D5DB', marginBottom: 8 },
  paymentMethods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paymentMethod: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: '#1A1A2E', borderWidth: 1, borderColor: '#374151' },
  paymentMethodActive: { borderColor: '#D4AF37', backgroundColor: 'rgba(212, 175, 55, 0.1)' },
  paymentIcon: { marginRight: 6 },
  paymentName: { fontSize: 12, color: '#9CA3AF' },
  paymentNameActive: { color: '#D4AF37', fontWeight: '600' },
  summary: { backgroundColor: '#1A1A2E', borderRadius: 12, padding: 16, marginBottom: 16 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  summaryLabel: { fontSize: 14, color: '#9CA3AF' },
  summaryValue: { fontSize: 14, color: '#fff' },
  summaryValueBold: { fontSize: 16, fontWeight: 'bold', color: '#D4AF37' },
  actionButton: { borderRadius: 12, padding: 18, alignItems: 'center', marginBottom: 16 },
  actionButtonBuy: { backgroundColor: '#10B981' },
  actionButtonSell: { backgroundColor: '#EF4444' },
  actionButtonDisabled: { opacity: 0.5 },
  actionButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  disclaimer: { fontSize: 12, color: '#6B7280', textAlign: 'center', marginBottom: 32 },
});
