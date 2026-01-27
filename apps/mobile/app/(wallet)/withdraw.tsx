import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/auth';
import api from '../../lib/api';
import InlineMessage from '../../components/InlineMessage';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

interface WithdrawalMethod {
  id: string;
  name: string;
  icon: IoniconsName;
  iconColor: string;
  iconBg: string;
  description: string;
  minAmount: number;
  maxAmount: number;
  processingTime: string;
}

const WITHDRAWAL_METHODS: WithdrawalMethod[] = [
  {
    id: 'orange_money',
    name: 'Orange Money',
    icon: 'phone-portrait-outline',
    iconColor: '#F97316',
    iconBg: 'rgba(249, 115, 22, 0.12)',
    description: 'Transfert sur votre compte Orange Money',
    minAmount: 1000,
    maxAmount: 500000,
    processingTime: '1-2 heures',
  },
  {
    id: 'moov_money',
    name: 'Moov Money',
    icon: 'phone-portrait-outline',
    iconColor: '#3B82F6',
    iconBg: 'rgba(59, 130, 246, 0.12)',
    description: 'Transfert sur votre compte Moov Money',
    minAmount: 1000,
    maxAmount: 500000,
    processingTime: '1-2 heures',
  },
];

const KYC_LIMITS: Record<string, number> = {
  BASIC: 0,
  STANDARD: 500000,
  VERIFIED: 5000000,
};

export default function WithdrawScreen() {
  const queryClient = useQueryClient();
  const { tokens, user } = useAuthStore();
  const [amount, setAmount] = useState('');
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState(user?.phone || '');
  const [error, setError] = useState('');
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const { data: walletData } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifie');
      return api.getWallet(tokens.accessToken);
    },
    enabled: !!tokens?.accessToken,
  });

  const wallet = walletData?.data;
  const kycLevel = user?.kycLevel || 'BASIC';
  const dailyLimit = KYC_LIMITS[kycLevel] || 0;

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifie');
      if (!selectedMethod) throw new Error('Selectionnez un mode de retrait');
      if (!amount || parseInt(amount) < 1000) throw new Error('Montant minimum: 1,000 XOF');

      return api.withdraw(parseInt(amount), selectedMethod, phoneNumber, tokens.accessToken);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      setMessage({ type: 'success', text: `Votre demande de retrait de ${parseInt(amount).toLocaleString()} XOF a ete soumise. Vous recevrez les fonds dans les 1-2 heures.` });
      setTimeout(() => router.back(), 3000);
    },
    onError: (error: Error) => {
      setMessage({ type: 'error', text: error.message || "Impossible d'effectuer le retrait" });
    },
  });

  const handleAmountChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, '');
    setAmount(numericValue);
    setError('');
  };

  const handleMaxAmount = () => {
    const maxWithdrawable = Math.min(wallet?.cashBalance || 0, dailyLimit);
    setAmount(maxWithdrawable.toString());
    setError('');
  };

  const validateAndSubmit = () => {
    if (kycLevel === 'BASIC') {
      setError('Vous devez completer votre verification KYC pour effectuer des retraits');
      return;
    }

    if (!selectedMethod) {
      setError('Veuillez selectionner un mode de retrait');
      return;
    }

    const amountNum = parseInt(amount);
    if (!amountNum || amountNum < 1000) {
      setError('Le montant minimum est de 1,000 XOF');
      return;
    }

    if (amountNum > (wallet?.cashBalance || 0)) {
      setError('Solde insuffisant');
      return;
    }

    if (amountNum > dailyLimit) {
      setError(`Limite journaliere depassee (${dailyLimit.toLocaleString()} XOF)`);
      return;
    }

    if (!phoneNumber) {
      setError('Veuillez entrer votre numero de telephone');
      return;
    }

    withdrawMutation.mutate();
  };

  // KYC Check
  if (kycLevel === 'BASIC') {
    return (
      <ScrollView style={styles.container}>
        <View style={styles.kycRequired}>
          <View style={styles.kycIconBg}>
            <Ionicons name="lock-closed" size={40} color="#F59E0B" />
          </View>
          <Text style={styles.kycTitle}>Verification requise</Text>
          <Text style={styles.kycText}>
            Pour effectuer des retraits, vous devez d'abord completer la verification de votre identite (KYC).
          </Text>
          <TouchableOpacity style={styles.kycButton} onPress={() => router.push('/(kyc)')} activeOpacity={0.8}>
            <Ionicons name="shield-checkmark-outline" size={18} color="#0F0F1A" />
            <Text style={styles.kycButtonText}>Verifier mon identite</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Retirer des fonds</Text>
        <Text style={styles.subtitle}>
          Transferez votre solde vers votre compte mobile money
        </Text>

        {/* Balance Card */}
        <View style={styles.balanceCard}>
          <View style={styles.balanceHeader}>
            <Ionicons name="wallet-outline" size={18} color="#D4AF37" />
            <Text style={styles.balanceLabel}>Solde disponible</Text>
          </View>
          <Text style={styles.balanceValue}>{(wallet?.cashBalance || 0).toLocaleString()} XOF</Text>
          <View style={styles.limitRow}>
            <View style={styles.limitLeft}>
              <Ionicons name="speedometer-outline" size={14} color="#9CA3AF" />
              <Text style={styles.limitLabel}>Limite journaliere ({kycLevel})</Text>
            </View>
            <Text style={styles.limitValue}>{dailyLimit.toLocaleString()} XOF</Text>
          </View>
        </View>

        {/* Withdrawal Methods */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Mode de retrait</Text>
          {WITHDRAWAL_METHODS.map((method) => (
            <TouchableOpacity
              key={method.id}
              style={[
                styles.methodCard,
                selectedMethod === method.id && styles.methodCardSelected,
              ]}
              onPress={() => {
                setSelectedMethod(method.id);
                setError('');
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.methodIconBg, { backgroundColor: method.iconBg }]}>
                <Ionicons name={method.icon} size={22} color={method.iconColor} />
              </View>
              <View style={styles.methodInfo}>
                <Text style={styles.methodName}>{method.name}</Text>
                <Text style={styles.methodDesc}>{method.description}</Text>
                <View style={styles.methodTimeRow}>
                  <Ionicons name="time-outline" size={12} color="#6B7280" />
                  <Text style={styles.methodTime}>{method.processingTime}</Text>
                </View>
              </View>
              <View style={[
                styles.radio,
                selectedMethod === method.id && styles.radioSelected,
              ]}>
                {selectedMethod === method.id && <View style={styles.radioInner} />}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Amount */}
        <View style={styles.section}>
          <View style={styles.amountHeader}>
            <Text style={styles.sectionTitle}>Montant (XOF)</Text>
            <TouchableOpacity onPress={handleMaxAmount} style={styles.maxBtn}>
              <Text style={styles.maxButton}>MAX</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.amountInputContainer}>
            <TextInput
              style={styles.amountInput}
              placeholder="0"
              placeholderTextColor="#6B7280"
              value={amount ? parseInt(amount).toLocaleString() : ''}
              onChangeText={handleAmountChange}
              keyboardType="number-pad"
            />
            <Text style={styles.currency}>XOF</Text>
          </View>
        </View>

        {/* Phone Number */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Numero de telephone</Text>
          <View style={styles.phoneInputContainer}>
            <Ionicons name="call-outline" size={18} color="#6B7280" style={{ marginLeft: 14 }} />
            <TextInput
              style={styles.phoneInput}
              placeholder="+226 XX XX XX XX"
              placeholderTextColor="#6B7280"
              value={phoneNumber}
              onChangeText={(text) => {
                setPhoneNumber(text);
                setError('');
              }}
              keyboardType="phone-pad"
            />
          </View>
          <Text style={styles.hint}>
            Les fonds seront envoyes sur ce numero
          </Text>
        </View>

        {error ? (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle" size={16} color="#EF4444" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Summary */}
        {selectedMethod && amount && parseInt(amount) > 0 && (
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Montant du retrait</Text>
              <Text style={styles.summaryValue}>{parseInt(amount).toLocaleString()} XOF</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Frais</Text>
              <Text style={[styles.summaryValue, { color: '#10B981' }]}>0 XOF</Text>
            </View>
            <View style={[styles.summaryRow, styles.summaryTotal]}>
              <Text style={styles.totalLabel}>Vous recevrez</Text>
              <Text style={styles.totalValue}>{parseInt(amount).toLocaleString()} XOF</Text>
            </View>
          </View>
        )}

        {/* Warning */}
        <View style={styles.warningBox}>
          <Ionicons name="warning" size={20} color="#EAB308" />
          <Text style={styles.warningText}>
            Assurez-vous que le numero de telephone est correct. Les transferts ne peuvent pas etre annules une fois envoyes.
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
            (!selectedMethod || !amount || !phoneNumber || withdrawMutation.isPending) && styles.buttonDisabled,
          ]}
          onPress={validateAndSubmit}
          disabled={!selectedMethod || !amount || !phoneNumber || withdrawMutation.isPending}
          activeOpacity={0.8}
        >
          {withdrawMutation.isPending ? (
            <ActivityIndicator size="small" color="#0F0F1A" />
          ) : (
            <View style={styles.buttonContent}>
              <Ionicons name="arrow-up-circle-outline" size={20} color="#0F0F1A" />
              <Text style={styles.submitButtonText}>Demander le retrait</Text>
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

  kycRequired: { alignItems: 'center', paddingVertical: 48 },
  kycIconBg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  kycTitle: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 12 },
  kycText: { color: '#9CA3AF', fontSize: 15, textAlign: 'center', marginBottom: 28, paddingHorizontal: 24, lineHeight: 22 },
  kycButton: {
    backgroundColor: '#D4AF37',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  kycButtonText: { color: '#0F0F1A', fontWeight: '700', fontSize: 16 },

  balanceCard: {
    backgroundColor: 'rgba(212, 175, 55, 0.08)',
    borderRadius: 14,
    padding: 18,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  balanceHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  balanceLabel: { color: '#9CA3AF', fontSize: 13 },
  balanceValue: { color: '#D4AF37', fontSize: 30, fontWeight: '700', marginBottom: 12 },
  limitRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  limitLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  limitLabel: { color: '#9CA3AF', fontSize: 12 },
  limitValue: { color: '#fff', fontSize: 12, fontWeight: '600' },

  section: { marginBottom: 24 },
  sectionTitle: { color: '#9CA3AF', fontSize: 12, fontWeight: '600', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 },

  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  methodCardSelected: { borderColor: '#D4AF37' },
  methodIconBg: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  methodInfo: { flex: 1 },
  methodName: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 2 },
  methodDesc: { color: '#9CA3AF', fontSize: 12, marginBottom: 4 },
  methodTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  methodTime: { color: '#6B7280', fontSize: 12 },
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

  amountHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  maxBtn: {
    backgroundColor: 'rgba(212, 175, 55, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
  },
  maxButton: { color: '#D4AF37', fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
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
  totalValue: { color: '#10B981', fontSize: 18, fontWeight: '700' },

  warningBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(234, 179, 8, 0.08)',
    borderRadius: 12,
    padding: 14,
    gap: 10,
    marginBottom: 20,
  },
  warningText: { color: '#EAB308', fontSize: 13, flex: 1, lineHeight: 18 },

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
