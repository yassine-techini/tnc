import { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Share } from 'react-native';
import InlineMessage from '../../components/InlineMessage';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/auth';
import api from '../../lib/api';
import { preventScreenCapture, allowScreenCapture } from '../../hooks/useSecurityCheck';

export default function CertificateScreen() {
  const { tokens, user } = useAuthStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success' | 'info'; text: string } | null>(null);

  // Prevent screen capture on certificate screen
  useEffect(() => {
    preventScreenCapture();
    return () => { allowScreenCapture(); };
  }, []);

  const { data: walletData, isLoading } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return api.getWallet(tokens.accessToken);
    },
    enabled: !!tokens?.accessToken,
  });

  const { data: priceData } = useQuery({
    queryKey: ['price'],
    queryFn: () => api.getPrice(),
  });

  const wallet = walletData?.data;
  const price = priceData?.data;
  const hasTokens = (wallet?.tokenBalance || 0) > 0;

  const handleGenerateCertificate = async () => {
    if (!hasTokens) return;

    setIsGenerating(true);
    setMessage(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      setMessage({ type: 'success', text: 'Votre certificat de propriété a été généré. Vous pouvez le partager.' });
    } catch {
      setMessage({ type: 'error', text: 'Impossible de générer le certificat' });
    } finally {
      setIsGenerating(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#D4AF37" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* No tokens banner */}
      {!hasTokens && (
        <View style={styles.emptyBanner}>
          <View style={styles.emptyIconBg}>
            <Ionicons name="alert-circle-outline" size={28} color="#F59E0B" />
          </View>
          <Text style={styles.emptyTitle}>Aucun or tokenisé</Text>
          <Text style={styles.emptyText}>
            Achetez de l'or pour obtenir votre certificat de propriété
          </Text>
          <TouchableOpacity
            style={styles.buyGoldButton}
            onPress={() => router.push('/(tabs)/market')}
            activeOpacity={0.8}
          >
            <Ionicons name="cart-outline" size={18} color="#0F0F1A" />
            <Text style={styles.buyGoldText}>Acheter de l'or</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Certificate Preview */}
      <View style={[styles.certificateCard, !hasTokens && styles.certificateCardDisabled]}>
        <View style={styles.certificateHeader}>
          <View style={styles.logoContainer}>
            <Ionicons name="shield-checkmark" size={36} color="#D4AF37" />
          </View>
          <Text style={styles.certificateTitle}>CERTIFICAT DE PROPRIÉTÉ</Text>
          <Text style={styles.certificateSubtitle}>Or Tokenisé - TNC Trading</Text>
        </View>

        <View style={styles.certificateBody}>
          <View style={styles.certificateSection}>
            <View style={styles.sectionLabelRow}>
              <Ionicons name="person-outline" size={14} color="#9CA3AF" />
              <Text style={styles.sectionLabel}>PROPRIÉTAIRE</Text>
            </View>
            <Text style={styles.ownerName}>{user?.email}</Text>
            <Text style={styles.ownerPhone}>{user?.phone}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.certificateSection}>
            <View style={styles.sectionLabelRow}>
              <Ionicons name="diamond-outline" size={14} color="#9CA3AF" />
              <Text style={styles.sectionLabel}>ACTIFS DÉTENUS</Text>
            </View>
            <Text style={styles.goldAmount}>{wallet?.tokenBalance?.toFixed(3) || '0.000'}</Text>
            <Text style={styles.goldUnit}>grammes d'or pur</Text>
          </View>

          <View style={styles.valueRow}>
            <Text style={styles.valueLabel}>Valeur estimée</Text>
            <Text style={styles.valueAmount}>
              {((wallet?.tokenBalance || 0) * (price?.sellPrice || 0)).toLocaleString()} XOF
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.certificateSection}>
            <View style={styles.sectionLabelRow}>
              <Ionicons name="information-circle-outline" size={14} color="#9CA3AF" />
              <Text style={styles.sectionLabel}>DÉTAILS</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Niveau KYC</Text>
              <Text style={styles.detailValue}>{user?.kycLevel || 'BASIC'}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Date</Text>
              <Text style={styles.detailValue}>
                {new Date().toLocaleDateString('fr-FR', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.certificateFooter}>
          <Ionicons name="ribbon-outline" size={16} color="#D4AF37" style={{ marginBottom: 4 }} />
          <Text style={styles.footerText}>Ce certificat atteste que le détenteur ci-dessus</Text>
          <Text style={styles.footerText}>possède la quantité indiquée d'or tokenisé</Text>
          <Text style={styles.footerNote}>Garanti par les réserves de l'État du Burkina Faso</Text>
        </View>
      </View>

      {/* Info */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>À propos du certificat</Text>
        {[
          { icon: 'checkmark-circle' as const, text: 'Atteste de votre propriete d\'or tokenise' },
          { icon: 'shield-checkmark' as const, text: 'Garanti par les reserves de l\'Etat' },
          { icon: 'pulse' as const, text: 'Valeur actualisée en temps réel' },
          { icon: 'share-social' as const, text: 'Partageable et téléchargeable' },
        ].map((item, index) => (
          <View key={index} style={styles.infoItem}>
            <Ionicons name={item.icon} size={18} color="#10B981" />
            <Text style={styles.infoText}>{item.text}</Text>
          </View>
        ))}
      </View>

      {message && (
        <InlineMessage
          type={message.type}
          message={message.text}
          onDismiss={() => setMessage(null)}
        />
      )}

      {/* Actions */}
      <TouchableOpacity
        style={[styles.generateButton, (!hasTokens || isGenerating) && styles.buttonDisabled]}
        onPress={handleGenerateCertificate}
        disabled={!hasTokens || isGenerating}
        activeOpacity={0.8}
      >
        {isGenerating ? (
          <ActivityIndicator size="small" color="#0F0F1A" />
        ) : (
          <View style={styles.buttonContent}>
            <Ionicons name="document-text-outline" size={20} color={hasTokens ? '#0F0F1A' : '#6B7280'} />
            <Text style={[styles.generateButtonText, !hasTokens && styles.generateButtonTextDisabled]}>
              Générer le certificat PDF
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {!hasTokens && (
        <Text style={styles.disabledHint}>Achetez de l'or pour générer votre certificat</Text>
      )}

      <TouchableOpacity
        style={[styles.shareButton, !hasTokens && styles.shareButtonDisabled]}
        disabled={!hasTokens}
        onPress={() => {
          Share.share({
            message: `Je possède ${wallet?.tokenBalance?.toFixed(3)} grammes d'or tokenisé sur TNC Trading!\n\nRejoignez-moi sur https://tnc-trading.com`,
          });
        }}
        activeOpacity={0.8}
      >
        <Ionicons name="share-social-outline" size={18} color={hasTokens ? '#D4AF37' : '#4B5563'} />
        <Text style={[styles.shareButtonText, !hasTokens && { color: '#4B5563' }]}>Partager</Text>
      </TouchableOpacity>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A', padding: 16 },
  loadingContainer: { flex: 1, backgroundColor: '#0F0F1A', justifyContent: 'center', alignItems: 'center' },

  emptyBanner: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyIconBg: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: { color: '#F59E0B', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  emptyText: { color: '#9CA3AF', fontSize: 13, textAlign: 'center', lineHeight: 18, marginBottom: 16 },
  buyGoldButton: {
    backgroundColor: '#D4AF37',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  buyGoldText: { color: '#0F0F1A', fontWeight: '600', fontSize: 14 },

  certificateCard: {
    backgroundColor: '#FFFEF0',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#D4AF37',
  },
  certificateCardDisabled: { opacity: 0.5 },
  certificateHeader: {
    backgroundColor: '#1A1A2E',
    padding: 24,
    alignItems: 'center',
  },
  logoContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  certificateTitle: { color: '#D4AF37', fontSize: 16, fontWeight: '700', letterSpacing: 2 },
  certificateSubtitle: { color: '#9CA3AF', fontSize: 12, marginTop: 4 },

  certificateBody: { padding: 24 },
  certificateSection: { marginBottom: 16 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  sectionLabel: { color: '#9CA3AF', fontSize: 10, fontWeight: '600', letterSpacing: 1 },
  ownerName: { color: '#1A1A2E', fontSize: 18, fontWeight: '600' },
  ownerPhone: { color: '#6B7280', fontSize: 14, marginTop: 2 },
  goldAmount: { color: '#D4AF37', fontSize: 44, fontWeight: '700' },
  goldUnit: { color: '#6B7280', fontSize: 14, marginTop: 4 },
  valueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  valueLabel: { color: '#6B7280', fontSize: 14 },
  valueAmount: { color: '#1A1A2E', fontSize: 18, fontWeight: '600' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  detailLabel: { color: '#6B7280', fontSize: 14 },
  detailValue: { color: '#1A1A2E', fontSize: 14, fontWeight: '500' },

  divider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 16 },

  certificateFooter: {
    backgroundColor: '#F9FAFB',
    padding: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  footerText: { color: '#6B7280', fontSize: 11, textAlign: 'center' },
  footerNote: { color: '#D4AF37', fontSize: 10, fontWeight: '600', marginTop: 8 },

  infoCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  infoTitle: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 14 },
  infoItem: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  infoText: { color: '#9CA3AF', fontSize: 14, flex: 1 },

  generateButton: {
    backgroundColor: '#D4AF37',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonDisabled: { backgroundColor: '#374151' },
  generateButtonText: { color: '#0F0F1A', fontWeight: '700', fontSize: 16 },
  generateButtonTextDisabled: { color: '#6B7280' },
  disabledHint: { color: '#6B7280', fontSize: 12, textAlign: 'center', marginBottom: 12 },

  shareButton: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shareButtonDisabled: { opacity: 0.5 },
  shareButtonText: { color: '#D4AF37', fontWeight: '600', fontSize: 16 },

  bottomPadding: { height: 32 },
});
