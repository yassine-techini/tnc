import { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Share, Image } from 'react-native';
import InlineMessage from '../../components/InlineMessage';
import { useQuery, useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/auth';
import api from '../../lib/api';
import { preventScreenCapture, allowScreenCapture } from '../../hooks/useSecurityCheck';
import { secureCopy } from '../../lib/clipboard';

export default function CertificateScreen() {
  const { tokens, user } = useAuthStore();
  const [message, setMessage] = useState<{ type: 'error' | 'success' | 'info'; text: string } | null>(null);

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

  const wallet = walletData?.data;
  const hasTokens = (wallet?.tokenBalance || 0) > 0;

  // Issue certificate via API
  const issueCertificate = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      const res = await api.getCertificate(tokens.accessToken);
      return res.data;
    },
    onSuccess: () => {
      setMessage({ type: 'success', text: 'Certificat généré avec succès.' });
    },
    onError: (err: Error) => {
      setMessage({ type: 'error', text: err.message || 'Impossible de générer le certificat' });
    },
  });

  const cert = issueCertificate.data;
  const verifyUrl = cert ? `https://app.tnc-trading.com/verify/${encodeURIComponent(cert.verificationCode)}` : null;
  const qrCodeUrl = verifyUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(verifyUrl)}&color=1B4332&bgcolor=FFFEF5`
    : null;

  const issueDate = cert
    ? new Date(cert.issuedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

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

      {/* ========= OFFICIAL CERTIFICATE ========= */}
      <View style={[styles.certificateCard, !hasTokens && styles.certificateCardDisabled]}>

        {/* Gold decorative border top */}
        <View style={styles.goldBorderTop} />

        {/* Header — State emblem + title */}
        <View style={styles.certificateHeader}>
          <Text style={styles.headerRepublic}>BURKINA FASO</Text>
          <View style={styles.coatOfArms}>
            <Text style={styles.coatOfArmsText}>BF</Text>
          </View>
          <Text style={styles.headerMotto}>Unité - Progrès - Justice</Text>
          <View style={styles.headerSeparator} />
          <Text style={styles.headerMinistry}>Ministère des Mines et des Carrières</Text>
          <Text style={styles.headerAgency}>Programme National de Tokenisation de l'Or</Text>
        </View>

        {/* Certificate title */}
        <View style={styles.titleBlock}>
          <View style={styles.titleDecorLeft} />
          <Text style={styles.certificateTitle}>CERTIFICAT DE PROPRIÉTÉ</Text>
          <View style={styles.titleDecorRight} />
        </View>
        <Text style={styles.certificateSubtitle}>Or Physique Tokenisé</Text>

        {/* Certificate number */}
        <View style={styles.certNumberBlock}>
          <Text style={styles.certNumberLabel}>N°</Text>
          <Text style={styles.certNumberValue}>{cert?.certificateId || '---'}</Text>
        </View>

        {/* Body content */}
        <View style={styles.certificateBody}>
          {/* Attestation text */}
          <Text style={styles.attestationText}>
            Le présent certificat atteste que le titulaire ci-dessous désigné est propriétaire
            de la quantité d'or physique indiquée, détenue sous forme de tokens numériques
            adossés aux réserves aurifères du Burkina Faso.
          </Text>

          <View style={styles.divider} />

          {/* Owner */}
          <View style={styles.section}>
            <View style={styles.sectionLabelRow}>
              <Ionicons name="person-outline" size={14} color="#7C6D3A" />
              <Text style={styles.sectionLabel}>TITULAIRE</Text>
            </View>
            <Text style={styles.ownerName}>{cert?.userName || user?.email}</Text>
            <Text style={styles.ownerDetail}>{user?.email}</Text>
            <Text style={styles.ownerDetail}>
              Identité vérifiée — Niveau {user?.kycLevel || 'BASIC'}
            </Text>
          </View>

          <View style={styles.divider} />

          {/* Gold holdings */}
          <View style={styles.section}>
            <View style={styles.sectionLabelRow}>
              <Ionicons name="diamond-outline" size={14} color="#7C6D3A" />
              <Text style={styles.sectionLabel}>OR PHYSIQUE DÉTENU</Text>
            </View>
            <View style={styles.goldAmountRow}>
              <Text style={styles.goldAmount}>
                {(cert?.tokenBalance ?? wallet?.tokenBalance)?.toFixed(3) || '0.000'}
              </Text>
              <Text style={styles.goldUnit}>grammes</Text>
            </View>
            <Text style={styles.goldPurity}>Or pur 999,9/1000 (24 carats)</Text>
            <Text style={styles.goldNote}>
              Équivalent à {(cert?.tokenBalance ?? wallet?.tokenBalance)?.toFixed(3) || '0.000'} token(s) TNC
            </Text>
            <Text style={styles.goldNote}>1 token = 1 gramme d'or physique</Text>
          </View>

          <View style={styles.divider} />

          {/* Guarantee */}
          <View style={styles.section}>
            <View style={styles.sectionLabelRow}>
              <Ionicons name="shield-checkmark-outline" size={14} color="#7C6D3A" />
              <Text style={styles.sectionLabel}>GARANTIE ET COUVERTURE</Text>
            </View>
            <Text style={styles.guaranteeText}>
              L'or physique correspondant aux tokens émis est conservé dans les réserves
              nationales sous la supervision du Ministère des Mines et des Carrières du
              Burkina Faso. Le ratio de couverture est vérifié par audit indépendant.
            </Text>
          </View>

          <View style={styles.divider} />

          {/* Certificate details */}
          <View style={styles.section}>
            <View style={styles.sectionLabelRow}>
              <Ionicons name="document-text-outline" size={14} color="#7C6D3A" />
              <Text style={styles.sectionLabel}>INFORMATIONS DU CERTIFICAT</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Numéro de certificat</Text>
              <Text style={styles.detailValue}>{cert?.certificateId || '---'}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Date d'émission</Text>
              <Text style={styles.detailValue}>{issueDate}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Émetteur</Text>
              <Text style={styles.detailValue}>TNC Trading SA</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Autorité de tutelle</Text>
              <Text style={styles.detailValue}>Min. des Mines - BF</Text>
            </View>
          </View>
        </View>

        {/* QR Code + Verification footer */}
        <View style={styles.certificateFooter}>
          {cert && qrCodeUrl ? (
            <View style={styles.qrContainer}>
              <Image
                source={{ uri: qrCodeUrl }}
                style={styles.qrImage}
                resizeMode="contain"
              />
              <Text style={styles.qrLabel}>Scanner pour vérifier</Text>
            </View>
          ) : (
            <View style={styles.sealContainer}>
              <View style={styles.sealCircle}>
                <Text style={styles.sealText}>SCEAU</Text>
                <Text style={styles.sealSubtext}>OFFICIEL</Text>
              </View>
            </View>
          )}
          <View style={styles.footerContent}>
            <Text style={styles.footerLegal}>
              Ce certificat est émis conformément à la réglementation en vigueur
              relative à la tokenisation des actifs aurifères en zone UEMOA.
            </Text>
            <Text style={styles.footerLegal}>
              Document à valeur probante — Vérifiable sur tnc-trading.com/verify
            </Text>
            {cert?.verificationCode && (
              <TouchableOpacity
                style={styles.verificationBox}
                onPress={() => {
                  secureCopy(cert.verificationCode);
                  setMessage({ type: 'info', text: 'Code copié dans le presse-papiers' });
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.verificationLabel}>CODE DE VÉRIFICATION</Text>
                <Text style={styles.verificationCode}>{cert.verificationCode}</Text>
                <Text style={styles.verificationHint}>Appuyer pour copier</Text>
              </TouchableOpacity>
            )}
            <View style={styles.footerSignature}>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureLabel}>Signature électronique</Text>
              <Text style={styles.signatureLabel}>TNC Trading SA</Text>
            </View>
          </View>
        </View>

        {/* Gold decorative border bottom */}
        <View style={styles.goldBorderBottom} />
      </View>

      {/* Info card */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>À propos du certificat</Text>
        {[
          { icon: 'shield-checkmark' as const, text: 'Reconnu par les autorités du Burkina Faso' },
          { icon: 'checkmark-circle' as const, text: 'Adossé à de l\'or physique 24 carats' },
          { icon: 'lock-closed' as const, text: 'Couverture vérifiée par audit indépendant' },
          { icon: 'qr-code' as const, text: 'QR Code et code unique pour vérification' },
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
        style={[styles.generateButton, (!hasTokens || issueCertificate.isPending) && styles.buttonDisabled]}
        onPress={() => issueCertificate.mutate()}
        disabled={!hasTokens || issueCertificate.isPending}
        activeOpacity={0.8}
      >
        {issueCertificate.isPending ? (
          <ActivityIndicator size="small" color="#0F0F1A" />
        ) : (
          <View style={styles.buttonContent}>
            <Ionicons name="document-text-outline" size={20} color={hasTokens ? '#0F0F1A' : '#6B7280'} />
            <Text style={[styles.generateButtonText, !hasTokens && styles.generateButtonTextDisabled]}>
              {cert ? 'Regénérer le certificat' : 'Générer le certificat'}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {!hasTokens && (
        <Text style={styles.disabledHint}>Achetez de l'or pour générer votre certificat</Text>
      )}

      <TouchableOpacity
        style={[styles.shareButton, (!hasTokens || !cert) && styles.shareButtonDisabled]}
        disabled={!hasTokens || !cert}
        onPress={() => {
          if (!cert) return;
          Share.share({
            message: `Certificat de propriété ${cert.certificateId}\nJe possède ${cert.totalOwnedGrams.toFixed(3)} grammes d'or physique tokenisé via TNC Trading, adossé aux réserves du Burkina Faso.${
              // Never let a shared message claim vaulted gold that is lent out.
              cert.leasedBalance > 0
                ? `\n(dont ${cert.leasedBalance.toFixed(3)} g placés en location, donc prêtés)`
                : ''
            }\n\nCode de vérification : ${cert.verificationCode}\nVérifier : https://app.tnc-trading.com/verify/${cert.verificationCode}`,
          });
        }}
        activeOpacity={0.8}
      >
        <Ionicons name="share-social-outline" size={18} color={cert ? '#D4AF37' : '#4B5563'} />
        <Text style={[styles.shareButtonText, !cert && { color: '#4B5563' }]}>Partager</Text>
      </TouchableOpacity>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A', padding: 16 },
  loadingContainer: { flex: 1, backgroundColor: '#0F0F1A', justifyContent: 'center', alignItems: 'center' },

  // Empty state
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
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  emptyTitle: { color: '#F59E0B', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  emptyText: { color: '#9CA3AF', fontSize: 13, textAlign: 'center', lineHeight: 18, marginBottom: 16 },
  buyGoldButton: {
    backgroundColor: '#D4AF37', borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 20,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  buyGoldText: { color: '#0F0F1A', fontWeight: '600', fontSize: 14 },

  // Certificate card
  certificateCard: {
    backgroundColor: '#FFFEF5',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#C9A84C',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  certificateCardDisabled: { opacity: 0.45 },

  goldBorderTop: { height: 6, backgroundColor: '#D4AF37' },
  goldBorderBottom: { height: 6, backgroundColor: '#D4AF37' },

  // Header
  certificateHeader: {
    paddingTop: 28, paddingBottom: 20, paddingHorizontal: 24,
    alignItems: 'center', backgroundColor: '#FFFEF5',
  },
  headerRepublic: { color: '#1B4332', fontSize: 14, fontWeight: '800', letterSpacing: 3 },
  coatOfArms: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#1B4332',
    alignItems: 'center', justifyContent: 'center',
    marginVertical: 12, borderWidth: 2, borderColor: '#D4AF37',
  },
  coatOfArmsText: { color: '#D4AF37', fontSize: 18, fontWeight: '900' },
  headerMotto: { color: '#6B7280', fontSize: 11, letterSpacing: 2, fontStyle: 'italic' },
  headerSeparator: { width: 60, height: 2, backgroundColor: '#D4AF37', marginVertical: 14 },
  headerMinistry: { color: '#374151', fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  headerAgency: { color: '#6B7280', fontSize: 10, marginTop: 2, letterSpacing: 0.3 },

  // Title
  titleBlock: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, marginTop: 4, gap: 12,
  },
  titleDecorLeft: { flex: 1, height: 1, backgroundColor: '#C9A84C' },
  titleDecorRight: { flex: 1, height: 1, backgroundColor: '#C9A84C' },
  certificateTitle: { color: '#7C6D3A', fontSize: 15, fontWeight: '800', letterSpacing: 2.5 },
  certificateSubtitle: {
    color: '#9CA3AF', fontSize: 11, textAlign: 'center',
    letterSpacing: 1, marginTop: 4, marginBottom: 8,
  },

  // Certificate number
  certNumberBlock: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8, marginHorizontal: 24,
    borderWidth: 1, borderColor: '#E5D9B6', borderRadius: 4,
    backgroundColor: 'rgba(212, 175, 55, 0.06)',
  },
  certNumberLabel: { color: '#9CA3AF', fontSize: 12, fontWeight: '600' },
  certNumberValue: {
    color: '#374151', fontSize: 14, fontWeight: '700',
    letterSpacing: 1, fontVariant: ['tabular-nums'],
  },

  // Body
  certificateBody: { padding: 24, paddingTop: 16 },
  attestationText: {
    color: '#374151', fontSize: 13, lineHeight: 20, textAlign: 'justify', fontStyle: 'italic',
  },
  section: { marginBottom: 4 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  sectionLabel: { color: '#7C6D3A', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  ownerName: { color: '#1A1A2E', fontSize: 18, fontWeight: '700' },
  ownerDetail: { color: '#6B7280', fontSize: 13, marginTop: 2 },
  goldAmountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  goldAmount: { color: '#1B4332', fontSize: 40, fontWeight: '800' },
  goldUnit: { color: '#6B7280', fontSize: 16, fontWeight: '500' },
  goldPurity: { color: '#D4AF37', fontSize: 12, fontWeight: '600', marginTop: 4, letterSpacing: 0.5 },
  goldNote: { color: '#9CA3AF', fontSize: 12, marginTop: 2 },
  guaranteeText: { color: '#374151', fontSize: 12, lineHeight: 18 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  detailLabel: { color: '#6B7280', fontSize: 12 },
  detailValue: { color: '#374151', fontSize: 12, fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#E5D9B6', marginVertical: 16 },

  // Footer with QR
  certificateFooter: {
    flexDirection: 'row', backgroundColor: '#F5F0E1', padding: 20,
    borderTopWidth: 1, borderTopColor: '#E5D9B6', gap: 16,
  },
  qrContainer: { alignItems: 'center', justifyContent: 'flex-start' },
  qrImage: {
    width: 100, height: 100, borderRadius: 4,
    borderWidth: 2, borderColor: '#E5D9B6',
  },
  qrLabel: { fontSize: 8, color: '#9CA3AF', marginTop: 4, letterSpacing: 0.5 },
  sealContainer: { alignItems: 'center', justifyContent: 'center' },
  sealCircle: {
    width: 60, height: 60, borderRadius: 30,
    borderWidth: 2, borderColor: '#D4AF37',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(212, 175, 55, 0.08)',
  },
  sealText: { color: '#7C6D3A', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  sealSubtext: { color: '#7C6D3A', fontSize: 7, fontWeight: '600', letterSpacing: 0.5 },
  footerContent: { flex: 1 },
  footerLegal: { color: '#6B7280', fontSize: 10, lineHeight: 14, marginBottom: 4 },
  verificationBox: {
    marginTop: 10, padding: 10,
    backgroundColor: 'rgba(212, 175, 55, 0.08)',
    borderWidth: 1, borderColor: '#E5D9B6', borderRadius: 6,
    alignItems: 'center',
  },
  verificationLabel: {
    fontSize: 9, color: '#7C6D3A', letterSpacing: 1, fontWeight: '700', marginBottom: 4,
  },
  verificationCode: {
    fontFamily: 'Courier', fontSize: 18, fontWeight: '800',
    color: '#1B4332', letterSpacing: 3,
  },
  verificationHint: {
    fontSize: 8, color: '#9CA3AF', marginTop: 4,
  },
  footerSignature: { marginTop: 10, alignItems: 'center' },
  signatureLine: { width: 120, height: 1, backgroundColor: '#9CA3AF', marginBottom: 4 },
  signatureLabel: { color: '#9CA3AF', fontSize: 9, fontWeight: '500' },

  // Info card
  infoCard: {
    backgroundColor: '#1A1A2E', borderRadius: 14, padding: 16, marginBottom: 20,
  },
  infoTitle: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 14 },
  infoItem: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  infoText: { color: '#9CA3AF', fontSize: 14, flex: 1 },

  // Buttons
  generateButton: {
    backgroundColor: '#D4AF37', borderRadius: 12, padding: 16,
    alignItems: 'center', marginBottom: 10,
  },
  buttonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonDisabled: { backgroundColor: '#374151' },
  generateButtonText: { color: '#0F0F1A', fontWeight: '700', fontSize: 16 },
  generateButtonTextDisabled: { color: '#6B7280' },
  disabledHint: { color: '#6B7280', fontSize: 12, textAlign: 'center', marginBottom: 12 },

  shareButton: {
    backgroundColor: '#1A1A2E', borderRadius: 12, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  shareButtonDisabled: { opacity: 0.5 },
  shareButtonText: { color: '#D4AF37', fontWeight: '600', fontSize: 16 },

  bottomPadding: { height: 32 },
});
