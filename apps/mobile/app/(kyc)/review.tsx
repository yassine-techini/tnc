import { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth';
import api from '../../lib/api';
import InlineMessage from '../../components/InlineMessage';
import { preventScreenCapture, allowScreenCapture } from '../../hooks/useSecurityCheck';

export default function ReviewScreen() {
  // Prevent screen capture on KYC review (personal documents)
  useEffect(() => {
    preventScreenCapture();
    return () => { allowScreenCapture(); };
  }, []);
  const params = useLocalSearchParams<{
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    documentType: string;
    documentNumber: string;
    frontImage: string;
    backImage: string;
    selfieImage: string;
  }>();

  const { tokens, setUser, user } = useAuthStore();
  const [agreeTos, setAgreeTos] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success' | 'warning'; text: string } | null>(null);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifie');

      // The pages are uploaded first, one multipart request each: the KYC form
      // endpoint does not accept images, and sending file URIs to it — which is
      // what this screen used to do — could never have worked.
      await api.uploadKycDocument(params.frontImage, 'front');
      if (params.backImage) {
        await api.uploadKycDocument(params.backImage, 'back');
      }
      await api.uploadKycDocument(params.selfieImage, 'selfie');

      return api.submitKyc(
        {
          documentType: params.documentType as 'CNIB' | 'PASSPORT' | 'PERMIT' | 'CEDEAO',
          documentNumber: params.documentNumber || undefined,
          firstName: params.firstName,
          lastName: params.lastName,
          dateOfBirth: params.dateOfBirth,
          // Mandatory server-side and not collected by this flow; the platform
          // is Burkina-first, and the account's own country wins when known.
          nationality: user?.country || 'BF',
        },
        tokens.accessToken
      );
    },
    onSuccess: () => {
      // Update user's KYC status locally
      if (user) {
        setUser({ ...user, kycStatus: 'SUBMITTED' });
      }

      setMessage({ type: 'success', text: 'Votre demande de verification a ete soumise avec succes. Vous serez notifie une fois la verification terminee.' });
      setTimeout(() => router.replace('/(tabs)/profile'), 3000);
    },
    onError: (error: Error) => {
      setMessage({ type: 'error', text: error.message || "Une erreur est survenue lors de l'envoi de votre demande" });
    },
  });

  const handleSubmit = () => {
    if (!agreeTos) {
      setMessage({ type: 'warning', text: 'Veuillez accepter les conditions pour continuer' });
      return;
    }
    setMessage(null);
    submitMutation.mutate();
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  };

  const getDocumentTypeName = (type: string) => {
    const types: Record<string, string> = {
      CNIB: 'CNIB',
      PASSPORT: 'Passeport',
      CEDEAO: 'Carte CEDEAO',
      PERMIT: 'Permis de conduire',
    };
    return types[type] || type;
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.progressBar}>
        <View style={[styles.progressStep, styles.progressComplete]} />
        <View style={[styles.progressStep, styles.progressComplete]} />
        <View style={[styles.progressStep, styles.progressComplete]} />
        <View style={[styles.progressStep, styles.progressActive]} />
      </View>

      <Text style={styles.title}>Verifiez vos informations</Text>
      <Text style={styles.subtitle}>
        Assurez-vous que toutes les informations sont correctes avant de soumettre
      </Text>

      {/* Personal Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Informations personnelles</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Prenom</Text>
          <Text style={styles.infoValue}>{params.firstName}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Nom</Text>
          <Text style={styles.infoValue}>{params.lastName}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Date de naissance</Text>
          <Text style={styles.infoValue}>{formatDate(params.dateOfBirth)}</Text>
        </View>
      </View>

      {/* Document Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Document d'identite</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Type</Text>
          <Text style={styles.infoValue}>{getDocumentTypeName(params.documentType)}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Numero</Text>
          <Text style={styles.infoValue}>{params.documentNumber}</Text>
        </View>
      </View>

      {/* Photos */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Photos capturees</Text>
        <View style={styles.photosGrid}>
          <View style={styles.photoItem}>
            <Image source={{ uri: params.frontImage }} style={styles.photoThumbnail} />
            <Text style={styles.photoLabel}>Recto</Text>
          </View>
          {params.backImage && (
            <View style={styles.photoItem}>
              <Image source={{ uri: params.backImage }} style={styles.photoThumbnail} />
              <Text style={styles.photoLabel}>Verso</Text>
            </View>
          )}
          <View style={styles.photoItem}>
            <Image source={{ uri: params.selfieImage }} style={styles.photoThumbnail} />
            <Text style={styles.photoLabel}>Selfie</Text>
          </View>
        </View>
      </View>

      {/* Terms */}
      <TouchableOpacity
        style={styles.tosContainer}
        onPress={() => setAgreeTos(!agreeTos)}
        activeOpacity={0.8}
      >
        <View style={[styles.checkbox, agreeTos && styles.checkboxChecked]}>
          {agreeTos && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.tosText}>
          Je certifie que les informations fournies sont exactes et j'accepte les{' '}
          <Text style={styles.tosLink}>conditions de verification</Text>
        </Text>
      </TouchableOpacity>

      {/* Warning */}
      <View style={styles.warningBox}>
        <Text style={styles.warningIcon}>⚠️</Text>
        <Text style={styles.warningText}>
          Toute fausse declaration peut entrainer le blocage de votre compte
        </Text>
      </View>

      {message && (
        <InlineMessage type={message.type} message={message.text} onDismiss={() => setMessage(null)} />
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          disabled={submitMutation.isPending}
        >
          <Text style={styles.backButtonText}>Modifier</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.submitButton,
            (!agreeTos || submitMutation.isPending) && styles.buttonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!agreeTos || submitMutation.isPending}
        >
          {submitMutation.isPending ? (
            <ActivityIndicator size="small" color="#0F0F1A" />
          ) : (
            <Text style={styles.submitButtonText}>Soumettre</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Info */}
      <View style={styles.infoBox}>
        <Text style={styles.infoBoxIcon}>ℹ️</Text>
        <View style={styles.infoBoxContent}>
          <Text style={styles.infoBoxTitle}>Delai de verification</Text>
          <Text style={styles.infoBoxText}>
            La verification prend generalement 24 a 48 heures. Vous recevrez une notification une fois terminee.
          </Text>
        </View>
      </View>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A', padding: 16 },

  progressBar: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  progressStep: { flex: 1, height: 4, backgroundColor: '#374151', borderRadius: 2 },
  progressComplete: { backgroundColor: '#10B981' },
  progressActive: { backgroundColor: '#D4AF37' },

  title: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#9CA3AF', marginBottom: 24, lineHeight: 20 },

  section: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { color: '#D4AF37', fontSize: 14, fontWeight: '600', marginBottom: 12 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  infoLabel: { color: '#9CA3AF', fontSize: 14 },
  infoValue: { color: '#fff', fontSize: 14, fontWeight: '500' },

  photosGrid: { flexDirection: 'row', gap: 12 },
  photoItem: { alignItems: 'center' },
  photoThumbnail: { width: 80, height: 80, borderRadius: 8, backgroundColor: '#374151' },
  photoLabel: { color: '#9CA3AF', fontSize: 12, marginTop: 4 },

  tosContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1A1A2E',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#6B7280',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#D4AF37', borderColor: '#D4AF37' },
  checkmark: { color: '#0F0F1A', fontSize: 14, fontWeight: '700' },
  tosText: { flex: 1, color: '#9CA3AF', fontSize: 14, lineHeight: 20 },
  tosLink: { color: '#D4AF37', textDecorationLine: 'underline' },

  warningBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    padding: 12,
    borderRadius: 12,
    gap: 12,
    marginBottom: 24,
  },
  warningIcon: { fontSize: 20 },
  warningText: { flex: 1, color: '#EAB308', fontSize: 13 },

  actions: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  backButton: {
    flex: 1,
    backgroundColor: '#374151',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  backButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  submitButton: {
    flex: 2,
    backgroundColor: '#D4AF37',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  submitButtonText: { color: '#0F0F1A', fontWeight: '700', fontSize: 16 },

  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  infoBoxIcon: { fontSize: 20 },
  infoBoxContent: { flex: 1 },
  infoBoxTitle: { color: '#93C5FD', fontWeight: '600', marginBottom: 4 },
  infoBoxText: { color: '#93C5FD', fontSize: 13, lineHeight: 18 },

  bottomPadding: { height: 32 },
});
