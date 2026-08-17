import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth';
import { useThemeColors } from '../../stores/theme';
import api from '../../lib/api';

export default function KycIntroScreen() {
  const c = useThemeColors();
  const { tokens, user } = useAuthStore();

  const { data: kycStatus, isLoading } = useQuery({
    queryKey: ['kyc-status'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return api.getKycStatus(tokens.accessToken);
    },
    enabled: !!tokens?.accessToken,
  });

  const status = kycStatus?.data;
  const canSubmit = !status || status.status === 'REJECTED' || status.status === 'EXPIRED';

  const startKyc = () => {
    router.push('/(kyc)/personal-info');
  };

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: c.background }]}>
        <ActivityIndicator size="large" color="#D4AF37" />
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: c.background }]}>
      {/* Status Card */}
      {status && (
        <View style={[styles.statusCard, { backgroundColor: c.surface }]}>
          <View style={styles.statusHeader}>
            <Text style={[styles.statusLabel, { color: c.textSecondary }]}>Statut actuel</Text>
            <View style={[
              styles.statusBadge,
              status.status === 'APPROVED' && styles.badgeSuccess,
              status.status === 'SUBMITTED' && styles.badgeInfo,
              status.status === 'REJECTED' && styles.badgeDanger,
              status.status === 'PENDING' && styles.badgeWarning,
            ]}>
              <Text style={styles.statusBadgeText}>
                {status.status === 'APPROVED' && 'Approuvé'}
                {status.status === 'SUBMITTED' && 'En cours de vérification'}
                {status.status === 'REJECTED' && 'Rejeté'}
                {status.status === 'PENDING' && 'En attente'}
                {status.status === 'EXPIRED' && 'Expiré'}
              </Text>
            </View>
          </View>
          <View style={styles.levelRow}>
            <Text style={[styles.levelLabel, { color: c.textSecondary }]}>Niveau KYC</Text>
            <Text style={styles.levelValue}>{status.level}</Text>
          </View>
          {/* Le motif est porté par le DOSSIER, pas par le statut. Lu à la
              racine, il valait toujours undefined : un utilisateur rejeté
              voyait le rejet sans jamais en connaître la raison. */}
          {status.document?.rejectionReason && (
            <View style={styles.rejectionBox}>
              <Text style={styles.rejectionTitle}>Raison du rejet:</Text>
              <Text style={styles.rejectionText}>{status.document.rejectionReason}</Text>
            </View>
          )}
        </View>
      )}

      {/* Info Card */}
      <View style={[styles.infoCard, { backgroundColor: c.surface }]}>
        <Text style={[styles.infoTitle, { color: c.text }]}>Pourquoi vérifier votre identité ?</Text>
        <View style={styles.infoItem}>
          <Text style={styles.infoIcon}>🛡️</Text>
          <View style={styles.infoContent}>
            <Text style={[styles.infoItemTitle, { color: c.text }]}>Sécurité</Text>
            <Text style={[styles.infoItemText, { color: c.textSecondary }]}>Protégez votre compte et vos investissements</Text>
          </View>
        </View>
        <View style={styles.infoItem}>
          <Text style={styles.infoIcon}>💰</Text>
          <View style={styles.infoContent}>
            <Text style={[styles.infoItemTitle, { color: c.text }]}>Limites augmentées</Text>
            <Text style={[styles.infoItemText, { color: c.textSecondary }]}>Achetez jusqu'à 1000g d'or par jour</Text>
          </View>
        </View>
        <View style={styles.infoItem}>
          <Text style={styles.infoIcon}>📤</Text>
          <View style={styles.infoContent}>
            <Text style={[styles.infoItemTitle, { color: c.text }]}>Retraits</Text>
            <Text style={[styles.infoItemText, { color: c.textSecondary }]}>Retirez jusqu'à 5,000,000 XOF par jour</Text>
          </View>
        </View>
      </View>

      {/* Requirements */}
      <View style={[styles.requirementsCard, { backgroundColor: c.surface }]}>
        <Text style={[styles.requirementsTitle, { color: c.text }]}>Documents requis</Text>
        <View style={styles.requirementItem}>
          <Text style={styles.checkIcon}>✓</Text>
          <Text style={[styles.requirementText, { color: c.textSecondary }]}>Pièce d'identité valide (CNIB, Passeport, Carte CEDEAO)</Text>
        </View>
        <View style={styles.requirementItem}>
          <Text style={styles.checkIcon}>✓</Text>
          <Text style={[styles.requirementText, { color: c.textSecondary }]}>Photo du recto et verso du document</Text>
        </View>
        <View style={styles.requirementItem}>
          <Text style={styles.checkIcon}>✓</Text>
          <Text style={[styles.requirementText, { color: c.textSecondary }]}>Selfie avec votre pièce d'identité</Text>
        </View>
      </View>

      {/* Levels */}
      <View style={[styles.levelsCard, { backgroundColor: c.surface }]}>
        <Text style={[styles.levelsTitle, { color: c.text }]}>Niveaux de vérification</Text>

        <View style={[styles.levelCard, { backgroundColor: c.background }, user?.kycLevel === 'BASIC' && styles.levelCardActive]}>
          <View style={styles.levelHeader}>
            <Text style={[styles.levelName, { color: c.text }]}>BASIC</Text>
            {user?.kycLevel === 'BASIC' && <Text style={styles.currentBadge}>Actuel</Text>}
          </View>
          <Text style={[styles.levelDesc, { color: c.textSecondary }]}>Consultation des prix uniquement</Text>
        </View>

        <View style={[styles.levelCard, { backgroundColor: c.background }, user?.kycLevel === 'STANDARD' && styles.levelCardActive]}>
          <View style={styles.levelHeader}>
            <Text style={[styles.levelName, { color: c.text }]}>STANDARD</Text>
            {user?.kycLevel === 'STANDARD' && <Text style={styles.currentBadge}>Actuel</Text>}
          </View>
          <Text style={[styles.levelDesc, { color: c.textSecondary }]}>100g/jour • 500g/mois • Retrait 500K XOF</Text>
        </View>

        <View style={[styles.levelCard, { backgroundColor: c.background }, user?.kycLevel === 'VERIFIED' && styles.levelCardActive]}>
          <View style={styles.levelHeader}>
            <Text style={[styles.levelName, { color: c.text }]}>VERIFIED</Text>
            {user?.kycLevel === 'VERIFIED' && <Text style={styles.currentBadge}>Actuel</Text>}
          </View>
          <Text style={[styles.levelDesc, { color: c.textSecondary }]}>1000g/jour • 5000g/mois • Retrait 5M XOF</Text>
        </View>
      </View>

      {/* CTA */}
      {canSubmit ? (
        <TouchableOpacity style={styles.ctaButton} onPress={startKyc}>
          <Text style={styles.ctaButtonText}>Commencer la vérification</Text>
        </TouchableOpacity>
      ) : status?.status === 'SUBMITTED' ? (
        <View style={styles.pendingBox}>
          <ActivityIndicator size="small" color="#D4AF37" />
          <Text style={styles.pendingText}>Vérification en cours, veuillez patienter...</Text>
        </View>
      ) : null}

      <View style={styles.bottomPadding} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A', padding: 16 },
  loadingContainer: { flex: 1, backgroundColor: '#0F0F1A', justifyContent: 'center', alignItems: 'center' },

  statusCard: { backgroundColor: '#1A1A2E', borderRadius: 16, padding: 20, marginBottom: 16 },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  statusLabel: { color: '#9CA3AF', fontSize: 14 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  badgeSuccess: { backgroundColor: 'rgba(16, 185, 129, 0.2)' },
  badgeInfo: { backgroundColor: 'rgba(59, 130, 246, 0.2)' },
  badgeDanger: { backgroundColor: 'rgba(239, 68, 68, 0.2)' },
  badgeWarning: { backgroundColor: 'rgba(234, 179, 8, 0.2)' },
  statusBadgeText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  levelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  levelLabel: { color: '#9CA3AF', fontSize: 14 },
  levelValue: { color: '#D4AF37', fontWeight: '700', fontSize: 16 },
  rejectionBox: { marginTop: 12, backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: 12, borderRadius: 8 },
  rejectionTitle: { color: '#EF4444', fontWeight: '600', marginBottom: 4 },
  rejectionText: { color: '#FCA5A5', fontSize: 14 },

  infoCard: { backgroundColor: '#1A1A2E', borderRadius: 16, padding: 20, marginBottom: 16 },
  infoTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 16 },
  infoItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  infoIcon: { fontSize: 24, marginRight: 12 },
  infoContent: { flex: 1 },
  infoItemTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 2 },
  infoItemText: { color: '#9CA3AF', fontSize: 14 },

  requirementsCard: { backgroundColor: '#1A1A2E', borderRadius: 16, padding: 20, marginBottom: 16 },
  requirementsTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 16 },
  requirementItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  checkIcon: { color: '#10B981', fontSize: 18, marginRight: 12, fontWeight: '700' },
  requirementText: { color: '#9CA3AF', fontSize: 14, flex: 1 },

  levelsCard: { backgroundColor: '#1A1A2E', borderRadius: 16, padding: 20, marginBottom: 16 },
  levelsTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 16 },
  levelCard: { backgroundColor: '#0F0F1A', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: 'transparent' },
  levelCardActive: { borderColor: '#D4AF37' },
  levelHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  levelName: { color: '#fff', fontWeight: '700', fontSize: 14 },
  currentBadge: { marginLeft: 8, backgroundColor: '#D4AF37', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, color: '#0F0F1A', fontSize: 10, fontWeight: '700' },
  levelDesc: { color: '#9CA3AF', fontSize: 13 },

  ctaButton: { backgroundColor: '#D4AF37', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  ctaButtonText: { color: '#0F0F1A', fontWeight: '700', fontSize: 16 },

  pendingBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(212, 175, 55, 0.1)', padding: 16, borderRadius: 12 },
  pendingText: { color: '#D4AF37', marginLeft: 12, fontSize: 14 },

  bottomPadding: { height: 32 },
});
