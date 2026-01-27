import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Platform, KeyboardAvoidingView } from 'react-native';
import { router } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';

interface KycFormData {
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
}

export default function PersonalInfoScreen() {
  const [formData, setFormData] = useState<KycFormData>({
    firstName: '',
    lastName: '',
    dateOfBirth: new Date(1990, 0, 1),
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof KycFormData, string>>>({});

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof KycFormData, string>> = {};

    if (!formData.firstName.trim()) {
      newErrors.firstName = 'Le prenom est requis';
    } else if (formData.firstName.trim().length < 2) {
      newErrors.firstName = 'Le prenom doit contenir au moins 2 caracteres';
    }

    if (!formData.lastName.trim()) {
      newErrors.lastName = 'Le nom est requis';
    } else if (formData.lastName.trim().length < 2) {
      newErrors.lastName = 'Le nom doit contenir au moins 2 caracteres';
    }

    const today = new Date();
    const age = today.getFullYear() - formData.dateOfBirth.getFullYear();
    if (age < 18) {
      newErrors.dateOfBirth = 'Vous devez avoir au moins 18 ans';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleContinue = () => {
    if (validateForm()) {
      router.push({
        pathname: '/(kyc)/document-type',
        params: {
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          dateOfBirth: formData.dateOfBirth.toISOString().split('T')[0],
        },
      });
    }
  };

  const onDateChange = (_event: unknown, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selectedDate) {
      setFormData({ ...formData, dateOfBirth: selectedDate });
      setErrors({ ...errors, dateOfBirth: undefined });
    }
  };

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.progressBar}>
          <View style={[styles.progressStep, styles.progressActive]} />
          <View style={styles.progressStep} />
          <View style={styles.progressStep} />
          <View style={styles.progressStep} />
        </View>

        <Text style={styles.title}>Vos informations personnelles</Text>
        <Text style={styles.subtitle}>
          Ces informations doivent correspondre exactement a celles de votre piece d'identite
        </Text>

        <View style={styles.form}>
          {/* First Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Prenom *</Text>
            <TextInput
              style={[styles.input, errors.firstName && styles.inputError]}
              placeholder="Entrez votre prenom"
              placeholderTextColor="#6B7280"
              value={formData.firstName}
              onChangeText={(text) => {
                setFormData({ ...formData, firstName: text });
                setErrors({ ...errors, firstName: undefined });
              }}
              autoCapitalize="words"
              autoCorrect={false}
            />
            {errors.firstName && <Text style={styles.errorText}>{errors.firstName}</Text>}
          </View>

          {/* Last Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Nom de famille *</Text>
            <TextInput
              style={[styles.input, errors.lastName && styles.inputError]}
              placeholder="Entrez votre nom"
              placeholderTextColor="#6B7280"
              value={formData.lastName}
              onChangeText={(text) => {
                setFormData({ ...formData, lastName: text });
                setErrors({ ...errors, lastName: undefined });
              }}
              autoCapitalize="words"
              autoCorrect={false}
            />
            {errors.lastName && <Text style={styles.errorText}>{errors.lastName}</Text>}
          </View>

          {/* Date of Birth */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Date de naissance *</Text>
            <TouchableOpacity
              style={[styles.input, styles.dateInput, errors.dateOfBirth && styles.inputError]}
              onPress={() => setShowDatePicker(true)}
            >
              <Text style={styles.dateText}>{formatDate(formData.dateOfBirth)}</Text>
              <Text style={styles.calendarIcon}>📅</Text>
            </TouchableOpacity>
            {errors.dateOfBirth && <Text style={styles.errorText}>{errors.dateOfBirth}</Text>}
          </View>

          {showDatePicker && (
            <DateTimePicker
              value={formData.dateOfBirth}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onDateChange}
              maximumDate={new Date()}
              minimumDate={new Date(1920, 0, 1)}
            />
          )}
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoIcon}>ℹ️</Text>
          <Text style={styles.infoText}>
            Assurez-vous que les informations sont identiques a celles figurant sur votre document d'identite.
          </Text>
        </View>

        <TouchableOpacity style={styles.continueButton} onPress={handleContinue}>
          <Text style={styles.continueButtonText}>Continuer</Text>
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
  progressActive: { backgroundColor: '#D4AF37' },

  title: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#9CA3AF', marginBottom: 32, lineHeight: 20 },

  form: { gap: 20 },
  inputGroup: { gap: 8 },
  label: { color: '#fff', fontSize: 14, fontWeight: '600' },
  input: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inputError: { borderColor: '#EF4444' },
  errorText: { color: '#EF4444', fontSize: 12 },

  dateInput: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateText: { color: '#fff', fontSize: 16 },
  calendarIcon: { fontSize: 20 },

  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    padding: 16,
    borderRadius: 12,
    marginTop: 24,
    gap: 12,
  },
  infoIcon: { fontSize: 20 },
  infoText: { color: '#93C5FD', fontSize: 14, flex: 1, lineHeight: 20 },

  continueButton: {
    backgroundColor: '#D4AF37',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 32,
  },
  continueButtonText: { color: '#0F0F1A', fontWeight: '700', fontSize: 16 },

  bottomPadding: { height: 32 },
});
