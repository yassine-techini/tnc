import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../stores/theme';
import { api, type Consignment, type ConsignmentEvent } from '../../lib/api';
import { STATUS_LABELS, GOLD_TYPE_LABELS } from './index';

// Ordered path of a lot. REJECTED is terminal and handled separately.
const STEPS = ['SUBMITTED', 'FORWARDER_VALIDATED', 'IN_TRANSIT', 'ARRIVED_DUBAI', 'AUDIT_VALIDATED'];

export default function ConsignmentDetailScreen() {
  const c = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [consignment, setConsignment] = useState<Consignment | null>(null);
  const [events, setEvents] = useState<ConsignmentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getMyConsignment(String(id))
      .then((res) => {
        if (!alive) return;
        setConsignment(res.data?.consignment ?? null);
        setEvents(res.data?.events ?? []);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Chargement impossible'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.gold} />
      </View>
    );
  }

  if (error || !consignment) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <Text style={{ color: c.error }}>{error || 'Lot introuvable'}</Text>
      </View>
    );
  }

  const rejected = consignment.status === 'REJECTED';
  const currentStep = STEPS.indexOf(consignment.status);

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.reference, { color: c.text }]}>{consignment.reference}</Text>
      <Text style={[styles.detail, { color: c.textSecondary }]}>
        {consignment.weight_declared_g.toLocaleString('fr-FR')} g déclarés ·{' '}
        {GOLD_TYPE_LABELS[consignment.gold_type]} · {Math.round(consignment.purity_declared * 24)} carats
      </Text>

      {consignment.producer_tokens_credited != null && (
        <View style={[styles.payout, { backgroundColor: c.success + '20' }]}>
          <Text style={[styles.payoutAmount, { color: c.success }]}>
            {consignment.producer_tokens_credited.toLocaleString('fr-FR')} g crédités en tokens
          </Text>
          {consignment.refined_weight_g != null && (
            <Text style={[styles.payoutNote, { color: c.textSecondary }]}>
              Poids raffiné à Dubaï : {consignment.refined_weight_g.toLocaleString('fr-FR')} g
              {consignment.refinery_lot ? ` · lot ${consignment.refinery_lot}` : ''}
            </Text>
          )}
          <Text style={[styles.payoutNote, { color: c.textSecondary }]}>
            1 token = 1 gramme d'or. Retrouvez-les dans votre portefeuille.
          </Text>
        </View>
      )}

      {rejected ? (
        <View style={[styles.rejected, { backgroundColor: c.error + '20' }]}>
          <Text style={{ color: c.error, fontWeight: '600' }}>Lot rejeté</Text>
          {consignment.rejection_reason && (
            <Text style={{ color: c.textSecondary, marginTop: 4 }}>{consignment.rejection_reason}</Text>
          )}
        </View>
      ) : (
        <View style={styles.tracker}>
          {STEPS.map((step, i) => {
            const done = i <= currentStep;
            return (
              <View key={step} style={styles.step}>
                <View
                  style={[
                    styles.bullet,
                    { backgroundColor: done ? c.gold : c.surface, borderColor: c.border },
                  ]}
                >
                  {i < currentStep ? (
                    <Ionicons name="checkmark" size={12} color="#000" />
                  ) : (
                    <Text style={{ fontSize: 10, color: done ? '#000' : c.textTertiary }}>{i + 1}</Text>
                  )}
                </View>
                <Text style={{ color: done ? c.text : c.textTertiary, fontSize: 14 }}>
                  {STATUS_LABELS[step]}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      <Text style={[styles.sectionTitle, { color: c.textTertiary }]}>Historique</Text>
      {events.map((ev) => (
        <View key={ev.id} style={[styles.event, { borderColor: c.border }]}>
          <Text style={{ color: c.text, fontSize: 13 }}>
            {STATUS_LABELS[ev.to_status] || ev.to_status}
          </Text>
          <Text style={{ color: c.textTertiary, fontSize: 11, marginTop: 2 }}>
            {new Date(ev.created_at).toLocaleString('fr-FR')}
            {ev.note ? ` — ${ev.note}` : ''}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  reference: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  detail: { fontSize: 13, marginTop: 4 },
  payout: { borderRadius: 14, padding: 14, marginTop: 16 },
  payoutAmount: { fontSize: 16, fontWeight: '700' },
  payoutNote: { fontSize: 12, marginTop: 4, lineHeight: 17 },
  rejected: { borderRadius: 14, padding: 14, marginTop: 16 },
  tracker: { marginTop: 24, gap: 14 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bullet: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginTop: 28, marginBottom: 8 },
  event: { borderTopWidth: 1, paddingVertical: 10 },
});
