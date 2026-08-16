/**
 * Open a lease position.
 *
 * The screen's real job is the acknowledgement: nobody should lend their gold
 * without understanding it leaves the vault, cannot be sold while lent, and
 * takes the recall period to come back. The confirm button stays disabled until
 * that box is ticked.
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
  Switch,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import InlineMessage from '../../components/InlineMessage';
import { useAuthStore } from '../../stores/auth';
import { useThemeColors } from '../../stores/theme';
import { api, type LeaseTerms } from '../../lib/api';
import { formatXof, formatGrams } from '../../lib/format';
import { checkLeaseAmount, projectAnnualLeaseYieldXof } from '@tnc-trading/shared';

export default function OpenLeaseScreen() {
  const c = useThemeColors();
  const { tokens } = useAuthStore();

  const [terms, setTerms] = useState<LeaseTerms | null>(null);
  const [available, setAvailable] = useState(0);
  const [spotPerGram, setSpotPerGram] = useState(0);
  const [loading, setLoading] = useState(true);

  const [grams, setGrams] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [termsRes, walletRes, priceRes] = await Promise.all([
          api.getLeaseTerms(),
          tokens?.accessToken ? api.getWallet(tokens.accessToken) : Promise.resolve(null),
          api.getPrice(),
        ]);
        setTerms(termsRes.data || null);
        setAvailable(walletRes?.data?.tokenBalance ?? 0);
        // Spot, not the sell price: the daily accrual values the principal at
        // spot, so a projection built on either side of the spread would not
        // match what actually gets booked.
        setSpotPerGram(priceRes.data?.priceXof ?? 0);
      } catch (e) {
        setMessage({
          type: 'error',
          text: e instanceof Error ? e.message : 'Chargement impossible',
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [tokens?.accessToken]);

  // The rules live in @tnc-trading/shared so web and mobile cannot drift apart,
  // and so they are tested somewhere other than by tapping.
  const check = checkLeaseAmount({
    raw: grams,
    minimumG: terms?.minimumGrams ?? 1,
    availableG: available,
    acknowledged,
  });
  const amount = check.grams ?? 0;
  const belowMinimum = check.problem === 'BELOW_MINIMUM';
  const overBalance = check.problem === 'OVER_BALANCE';
  const canSubmit = check.valid && !submitting;

  const projectedYearlyXof = projectAnnualLeaseYieldXof({
    grams: amount,
    spotPerGramXof: spotPerGram,
    annualRate: terms?.annualRate ?? 0,
  });

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setMessage(null);
    try {
      await api.openLeasePosition(amount);
      // Back to the list rather than a success screen: the position itself is
      // the confirmation, and it is where the holder will look next.
      router.replace('/(lease)');
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Ouverture impossible',
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
        <View style={styles.row}>
          <Text style={[styles.label, { color: c.textSecondary }]}>Disponible</Text>
          <Text style={[styles.value, { color: c.text }]}>{formatGrams(available)}</Text>
        </View>
        {terms && (
          <View style={styles.row}>
            <Text style={[styles.label, { color: c.textSecondary }]}>Taux annuel</Text>
            <Text style={[styles.value, { color: c.gold }]}>{terms.annualRatePercent} %</Text>
          </View>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.label, { color: c.textSecondary }]}>Quantité (grammes)</Text>
        <TextInput
          value={grams}
          onChangeText={(v) => {
            setGrams(v);
            setMessage(null);
          }}
          keyboardType="decimal-pad"
          placeholder={terms ? String(terms.minimumGrams) : '1'}
          placeholderTextColor={c.textTertiary}
          style={[styles.input, { color: c.text, borderColor: c.border }]}
        />

        {belowMinimum && (
          <Text style={[styles.hint, { color: c.warning }]}>
            Le minimum est de {terms?.minimumGrams} g.
          </Text>
        )}
        {overBalance && (
          <Text style={[styles.hint, { color: c.error }]}>
            Vous ne disposez que de {formatGrams(available)}.
          </Text>
        )}

        {projectedYearlyXof > 0 && !belowMinimum && !overBalance && (
          <Text style={[styles.hint, { color: c.textSecondary }]}>
            À titre indicatif, environ {formatXof(projectedYearlyXof)} sur un an au cours
            actuel. Le rendement est calculé chaque jour sur le cours du jour : ce montant
            n'est pas garanti.
          </Text>
        )}
      </View>

      {terms && (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.warning }]}>
          {/* Verbatim from the API, never paraphrased. */}
          <Text style={[styles.disclosure, { color: c.warning }]}>{terms.disclosure}</Text>

          <View style={styles.ackRow}>
            <Switch
              value={acknowledged}
              onValueChange={setAcknowledged}
              trackColor={{ false: c.border, true: c.gold }}
            />
            <Text style={[styles.ackText, { color: c.textSecondary }]}>
              Je comprends que mon or sera prêté, qu'il ne sera pas vendable tant que la
              position est ouverte, et que sa restitution prend{' '}
              {terms.exitSettlementBusinessDays} jours ouvrés après ma demande.
            </Text>
          </View>
        </View>
      )}

      <TouchableOpacity
        style={[styles.cta, { backgroundColor: canSubmit ? c.gold : c.border }]}
        onPress={submit}
        disabled={!canSubmit}
        activeOpacity={0.8}
      >
        {submitting ? (
          <ActivityIndicator color="#0F0F1A" />
        ) : (
          <>
            <Ionicons
              name="lock-closed-outline"
              size={18}
              color={canSubmit ? '#0F0F1A' : c.textTertiary}
            />
            <Text style={[styles.ctaText, { color: canSubmit ? '#0F0F1A' : c.textTertiary }]}>
              Placer en location
            </Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 12 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13 },
  value: { fontSize: 16, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    fontWeight: '600',
  },
  hint: { fontSize: 12, lineHeight: 18 },
  disclosure: { fontSize: 12, lineHeight: 18 },
  ackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  ackText: { flex: 1, fontSize: 12, lineHeight: 18 },
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
