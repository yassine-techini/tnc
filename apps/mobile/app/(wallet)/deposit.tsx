import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Linking, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/auth';
import { useThemeColors } from '../../stores/theme';
import api from '../../lib/api';
import InlineMessage from '../../components/InlineMessage';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

interface PaymentMethod {
  id: string;
  name: string;
  icon: IoniconsName;
  iconColor: string;
  iconBg: string;
  description: string;
  minAmount: number;
  maxAmount: number;
  fees: string;
}

const PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: 'orange_money',
    name: 'Orange Money',
    icon: 'phone-portrait-outline',
    iconColor: '#F97316',
    iconBg: 'rgba(249, 115, 22, 0.12)',
    description: 'Paiement instantane via Orange Money',
    minAmount: 1000,
    maxAmount: 2000000,
    fees: '1%',
  },
  {
    id: 'moov_money',
    name: 'Moov Money',
    icon: 'phone-portrait-outline',
    iconColor: '#3B82F6',
    iconBg: 'rgba(59, 130, 246, 0.12)',
    description: 'Paiement instantane via Moov Money',
    minAmount: 1000,
    maxAmount: 2000000,
    fees: '1%',
  },
  {
    id: 'card',
    name: 'Carte bancaire',
    icon: 'card-outline',
    iconColor: '#8B5CF6',
    iconBg: 'rgba(139, 92, 246, 0.12)',
    description: 'Visa, Mastercard',
    minAmount: 5000,
    maxAmount: 5000000,
    fees: '2.5%',
  },
];

const PRESET_AMOUNTS = [5000, 10000, 25000, 50000, 100000];

export default function DepositScreen() {
  const c = useThemeColors();
  const queryClient = useQueryClient();
  const { tokens, user } = useAuthStore();
  const [amount, setAmount] = useState('');
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState(user?.phone || '');
  const [error, setError] = useState('');
  const [message, setMessage] = useState<{ type: 'error' | 'success' | 'info'; text: string } | null>(null);

  const selectedPaymentMethod = PAYMENT_METHODS.find(m => m.id === selectedMethod);

  const depositMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifie');
      if (!selectedMethod) throw new Error('Selectionnez un mode de paiement');
      if (!amount || parseInt(amount) < 1000) throw new Error('Montant minimum: 1,000 XOF');

      return api.deposit(parseInt(amount), selectedMethod, phoneNumber, tokens.accessToken);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });

      if (data.data.paymentUrl) {
        setMessage({ type: 'info', text: 'Vous allez etre redirige vers la page de paiement...' });
        Linking.openURL(data.data.paymentUrl);
        setTimeout(() => router.back(), 2000);
      } else {
        setMessage({ type: 'success', text: `Votre depot de ${parseInt(amount).toLocaleString()} XOF est en cours de traitement.` });
        setTimeout(() => router.back(), 2000);
      }
    },
    onError: (error: Error) => {
      setMessage({ type: 'error', text: error.message || "Impossible d'effectuer le depot" });
    },
  });

  const handleAmountChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, '');
    setAmount(numericValue);
    setError('');
  };

  const handlePresetAmount = (value: number) => {
    setAmount(value.toString());
    setError('');
  };

  const validateAndSubmit = () => {
    if (!selectedMethod) {
      setError('Veuillez selectionner un mode de paiement');
      return;
    }

    const amountNum = parseInt(amount);
    if (!amountNum || amountNum < 1000) {
      setError('Le montant minimum est de 1,000 XOF');
      return;
    }

    if (selectedPaymentMethod && amountNum > selectedPaymentMethod.maxAmount) {
      setError(`Le montant maximum est de ${selectedPaymentMethod.maxAmount.toLocaleString()} XOF`);
      return;
    }

    if ((selectedMethod === 'orange_money' || selectedMethod === 'moov_money') && !phoneNumber) {
      setError('Veuillez entrer votre numero de telephone');
      return;
    }

    depositMutation.mutate();
  };

  const calculateFees = () => {
    if (!selectedPaymentMethod || !amount) return 0;
    const feePercent = parseFloat(selectedPaymentMethod.fees) / 100;
    return Math.round(parseInt(amount) * feePercent);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={[styles.container, { backgroundColor: c.background }]} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: c.text }]}>Deposer des fonds</Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          Alimentez votre compte pour acheter de l'or tokenise
        </Text>

        {/* Payment Methods */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Mode de paiement</Text>
          {PAYMENT_METHODS.map((method) => (
            <TouchableOpacity
              key={method.id}
              style={[
                styles.paymentCard,
                { backgroundColor: c.surface },
                selectedMethod === method.id && styles.paymentCardSelected,
              ]}
              onPress={() => {
                setSelectedMethod(method.id);
                setError('');
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.paymentIconBg, { backgroundColor: method.iconBg }]}>
                <Ionicons name={method.icon} size={22} color={method.iconColor} />
              </View>
              <View style={styles.paymentInfo}>
                <Text style={[styles.paymentName, { color: c.text }]}>{method.name}</Text>
                <Text style={[styles.paymentDesc, { color: c.textSecondary }]}>{method.description}</Text>
                <Text style={styles.paymentFees}>Frais: {method.fees}</Text>
              </View>
              <View style={[
                styles.radio,
                { borderColor: c.textTertiary },
                selectedMethod === method.id && styles.radioSelected,
              ]}>
                {selectedMethod === method.id && <View style={styles.radioInner} />}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Amount */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Montant (XOF)</Text>
          <View style={[styles.amountInputContainer, { backgroundColor: c.surface }]}>
            <TextInput
              style={[styles.amountInput, { color: c.text }]}
              placeholder="0"
              placeholderTextColor={c.textTertiary}
              value={amount ? parseInt(amount).toLocaleString() : ''}
              onChangeText={handleAmountChange}
              keyboardType="number-pad"
            />
            <Text style={[styles.currency, { color: c.textSecondary }]}>XOF</Text>
          </View>

          <View style={styles.presetAmounts}>
            {PRESET_AMOUNTS.map((preset) => (
              <TouchableOpacity
                key={preset}
                style={[
                  styles.presetButton,
                  { backgroundColor: c.surface },
                  amount === preset.toString() && styles.presetButtonActive,
                ]}
                onPress={() => handlePresetAmount(preset)}
              >
                <Text style={[
                  styles.presetText,
                  { color: c.textSecondary },
                  amount === preset.toString() && styles.presetTextActive,
                ]}>
                  {preset >= 1000 ? `${preset / 1000}K` : preset}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Phone Number for Mobile Money */}
        {(selectedMethod === 'orange_money' || selectedMethod === 'moov_money') && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Numero de telephone</Text>
            <View style={[styles.phoneInputContainer, { backgroundColor: c.surface }]}>
              <Ionicons name="call-outline" size={18} color={c.textTertiary} style={{ marginLeft: 14 }} />
              <TextInput
                style={[styles.phoneInput, { color: c.text }]}
                placeholder="+226 XX XX XX XX"
                placeholderTextColor={c.textTertiary}
                value={phoneNumber}
                onChangeText={(text) => {
                  setPhoneNumber(text);
                  setError('');
                }}
                keyboardType="phone-pad"
              />
            </View>
            <Text style={[styles.hint, { color: c.textTertiary }]}>
              Le numero utilise pour {selectedMethod === 'orange_money' ? 'Orange Money' : 'Moov Money'}
            </Text>
          </View>
        )}

        {error ? (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle" size={16} color="#EF4444" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Summary */}
        {selectedMethod && amount && parseInt(amount) > 0 && (
          <View style={[styles.summaryCard, { backgroundColor: c.surface }]}>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: c.textSecondary }]}>Montant</Text>
              <Text style={[styles.summaryValue, { color: c.text }]}>{parseInt(amount).toLocaleString()} XOF</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: c.textSecondary }]}>Frais ({selectedPaymentMethod?.fees})</Text>
              <Text style={[styles.summaryValue, { color: c.text }]}>{calculateFees().toLocaleString()} XOF</Text>
            </View>
            <View style={[styles.summaryRow, styles.summaryTotal]}>
              <Text style={[styles.totalLabel, { color: c.text }]}>Total</Text>
              <Text style={styles.totalValue}>{(parseInt(amount) + calculateFees()).toLocaleString()} XOF</Text>
            </View>
          </View>
        )}

        {/* Info */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={20} color="#3B82F6" />
          <Text style={styles.infoText}>
            Les depots sont generalement credites en quelques minutes. En cas de probleme, contactez notre support.
          </Text>
        </View>

        {message && (
          <InlineMessage
            type={message.type}
            message={message.text}
            onDismiss={() => setMessage(null)}
          />
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[
            styles.submitButton,
            (!selectedMethod || !amount || depositMutation.isPending) && styles.buttonDisabled,
          ]}
          onPress={validateAndSubmit}
          disabled={!selectedMethod || !amount || depositMutation.isPending}
          activeOpacity={0.8}
        >
          {depositMutation.isPending ? (
            <ActivityIndicator size="small" color="#0F0F1A" />
          ) : (
            <View style={styles.buttonContent}>
              <Ionicons name="arrow-down-circle-outline" size={20} color="#0F0F1A" />
              <Text style={styles.submitButtonText}>Deposer maintenant</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A', padding: 16 },

  title: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#9CA3AF', marginBottom: 24 },

  section: { marginBottom: 24 },
  sectionTitle: { color: '#9CA3AF', fontSize: 12, fontWeight: '600', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 },

  paymentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  paymentCardSelected: { borderColor: '#D4AF37' },
  paymentIconBg: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  paymentInfo: { flex: 1 },
  paymentName: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 2 },
  paymentDesc: { color: '#9CA3AF', fontSize: 12, marginBottom: 2 },
  paymentFees: { color: '#D4AF37', fontSize: 12 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#6B7280',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: '#D4AF37' },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#D4AF37' },

  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    paddingHorizontal: 20,
  },
  amountInput: {
    flex: 1,
    color: '#fff',
    fontSize: 30,
    fontWeight: '700',
    paddingVertical: 18,
  },
  currency: { color: '#9CA3AF', fontSize: 16, fontWeight: '600' },

  presetAmounts: { flexDirection: 'row', gap: 8, marginTop: 12 },
  presetButton: {
    flex: 1,
    backgroundColor: '#1A1A2E',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  presetButtonActive: { backgroundColor: '#D4AF37' },
  presetText: { color: '#9CA3AF', fontSize: 14, fontWeight: '600' },
  presetTextActive: { color: '#0F0F1A' },

  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
  },
  phoneInput: {
    flex: 1,
    padding: 14,
    paddingLeft: 10,
    color: '#fff',
    fontSize: 16,
  },
  hint: { color: '#6B7280', fontSize: 12, marginTop: 8 },

  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    marginBottom: 16,
  },
  errorText: { color: '#EF4444', fontSize: 14 },

  summaryCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  summaryLabel: { color: '#9CA3AF', fontSize: 14 },
  summaryValue: { color: '#fff', fontSize: 14 },
  summaryTotal: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    marginTop: 8,
    paddingTop: 16,
  },
  totalLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
  totalValue: { color: '#D4AF37', fontSize: 18, fontWeight: '700' },

  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
    borderRadius: 12,
    padding: 14,
    gap: 10,
    marginBottom: 20,
  },
  infoText: { color: '#93C5FD', fontSize: 13, flex: 1, lineHeight: 18 },

  submitButton: {
    backgroundColor: '#D4AF37',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  buttonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonDisabled: { opacity: 0.5 },
  submitButtonText: { color: '#0F0F1A', fontWeight: '700', fontSize: 16 },

  bottomPadding: { height: 32 },
});
