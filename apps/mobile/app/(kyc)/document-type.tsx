import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

type DocumentType = 'CNIB' | 'PASSPORT' | 'PERMIT' | 'CEDEAO';

interface DocumentOption {
  type: DocumentType;
  name: string;
  description: string;
  icon: string;
  requiresBack: boolean;
}

const DOCUMENT_OPTIONS: DocumentOption[] = [
  {
    type: 'CNIB',
    name: 'CNIB',
    description: 'Carte Nationale d\'Identite Burkinabe',
    icon: '🪪',
    requiresBack: true,
  },
  {
    type: 'PASSPORT',
    name: 'Passeport',
    description: 'Passeport valide',
    icon: '📕',
    requiresBack: false,
  },
  {
    type: 'CEDEAO',
    name: 'Carte CEDEAO',
    description: 'Carte d\'identite CEDEAO',
    icon: '🌍',
    requiresBack: true,
  },
  {
    type: 'PERMIT',
    name: 'Permis de conduire',
    description: 'Permis de conduire valide',
    icon: '🚗',
    requiresBack: true,
  },
];

export default function DocumentTypeScreen() {
  const params = useLocalSearchParams<{
    firstName: string;
    lastName: string;
    dateOfBirth: string;
  }>();

  const [selectedType, setSelectedType] = useState<DocumentType | null>(null);
  const [documentNumber, setDocumentNumber] = useState('');
  const [error, setError] = useState('');

  const selectedOption = DOCUMENT_OPTIONS.find(opt => opt.type === selectedType);

  const handleContinue = () => {
    if (!selectedType) {
      setError('Veuillez selectionner un type de document');
      return;
    }

    if (!documentNumber.trim()) {
      setError('Veuillez entrer le numero du document');
      return;
    }

    if (documentNumber.trim().length < 5) {
      setError('Le numero du document semble invalide');
      return;
    }

    router.push({
      pathname: '/(kyc)/camera',
      params: {
        ...params,
        documentType: selectedType,
        documentNumber: documentNumber.trim(),
        requiresBack: selectedOption?.requiresBack ? 'true' : 'false',
        step: 'front',
      },
    });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.progressBar}>
        <View style={[styles.progressStep, styles.progressComplete]} />
        <View style={[styles.progressStep, styles.progressActive]} />
        <View style={styles.progressStep} />
        <View style={styles.progressStep} />
      </View>

      <Text style={styles.title}>Type de document</Text>
      <Text style={styles.subtitle}>
        Selectionnez le document d'identite que vous souhaitez utiliser pour la verification
      </Text>

      <View style={styles.options}>
        {DOCUMENT_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.type}
            style={[
              styles.optionCard,
              selectedType === option.type && styles.optionCardSelected,
            ]}
            onPress={() => {
              setSelectedType(option.type);
              setError('');
            }}
          >
            <Text style={styles.optionIcon}>{option.icon}</Text>
            <View style={styles.optionContent}>
              <Text style={styles.optionName}>{option.name}</Text>
              <Text style={styles.optionDesc}>{option.description}</Text>
            </View>
            <View style={[
              styles.radio,
              selectedType === option.type && styles.radioSelected,
            ]}>
              {selectedType === option.type && <View style={styles.radioInner} />}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {selectedType && (
        <View style={styles.documentNumberSection}>
          <Text style={styles.label}>Numero du document *</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: B12345678"
            placeholderTextColor="#6B7280"
            value={documentNumber}
            onChangeText={(text) => {
              setDocumentNumber(text.toUpperCase());
              setError('');
            }}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Text style={styles.hint}>
            Entrez le numero exactement comme il apparait sur votre document
          </Text>
        </View>
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.infoBox}>
        <Text style={styles.infoIcon}>📷</Text>
        <View style={styles.infoContent}>
          <Text style={styles.infoTitle}>Prochaine etape</Text>
          <Text style={styles.infoText}>
            Vous allez prendre en photo votre document{selectedOption?.requiresBack ? ' (recto et verso)' : ''} et un selfie de verification
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.continueButton, (!selectedType || !documentNumber.trim()) && styles.buttonDisabled]}
        onPress={handleContinue}
        disabled={!selectedType || !documentNumber.trim()}
      >
        <Text style={styles.continueButtonText}>Continuer vers la camera</Text>
      </TouchableOpacity>

      <View style={styles.bottomPadding} />
      </ScrollView>
    </KeyboardAvoidingView>
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

  options: { gap: 12 },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionCardSelected: { borderColor: '#D4AF37' },
  optionIcon: { fontSize: 32, marginRight: 16 },
  optionContent: { flex: 1 },
  optionName: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 2 },
  optionDesc: { color: '#9CA3AF', fontSize: 13 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#6B7280',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: '#D4AF37' },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#D4AF37' },

  documentNumberSection: { marginTop: 24, gap: 8 },
  label: { color: '#fff', fontSize: 14, fontWeight: '600' },
  input: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 16,
  },
  hint: { color: '#6B7280', fontSize: 12 },

  errorText: { color: '#EF4444', fontSize: 14, marginTop: 16, textAlign: 'center' },

  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    padding: 16,
    borderRadius: 12,
    marginTop: 24,
    gap: 12,
  },
  infoIcon: { fontSize: 24 },
  infoContent: { flex: 1 },
  infoTitle: { color: '#D4AF37', fontWeight: '600', marginBottom: 4 },
  infoText: { color: '#E5C76B', fontSize: 14, lineHeight: 20 },

  continueButton: {
    backgroundColor: '#D4AF37',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.5 },
  continueButtonText: { color: '#0F0F1A', fontWeight: '700', fontSize: 16 },

  bottomPadding: { height: 32 },
});
