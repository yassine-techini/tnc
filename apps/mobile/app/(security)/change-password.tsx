import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/auth';
import api from '../../lib/api';
import InlineMessage from '../../components/InlineMessage';

export default function ChangePasswordScreen() {
  const { tokens } = useAuthStore();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!currentPassword) {
      newErrors.currentPassword = 'Le mot de passe actuel est requis';
    }

    if (!newPassword) {
      newErrors.newPassword = 'Le nouveau mot de passe est requis';
    } else if (newPassword.length < 8) {
      newErrors.newPassword = 'Le mot de passe doit contenir au moins 8 caracteres';
    } else if (!/[A-Z]/.test(newPassword)) {
      newErrors.newPassword = 'Le mot de passe doit contenir au moins une majuscule';
    } else if (!/[0-9]/.test(newPassword)) {
      newErrors.newPassword = 'Le mot de passe doit contenir au moins un chiffre';
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Veuillez confirmer le mot de passe';
    } else if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = 'Les mots de passe ne correspondent pas';
    }

    if (currentPassword === newPassword) {
      newErrors.newPassword = 'Le nouveau mot de passe doit etre different';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const changeMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifie');
      // `/auth/change-password` n'existe pas : cet ecran renvoyait un 404. La
      // seule route est `POST /users/me/password`, qui exige la confirmation.
      const API_URL = process.env.EXPO_PUBLIC_API_URL || '';
      const response = await fetch(`${API_URL}/api/v1/users/me/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens.accessToken}` },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword: newPassword }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error?.message || 'Erreur lors du changement de mot de passe');
      return data;
    },
    onSuccess: () => {
      setMessage({ type: 'success', text: 'Votre mot de passe a ete change avec succes' });
      setTimeout(() => router.back(), 2000);
    },
    onError: (error: Error) => {
      setMessage({ type: 'error', text: error.message || 'Impossible de changer le mot de passe' });
    },
  });

  const handleSubmit = () => {
    if (validateForm()) {
      changeMutation.mutate();
    }
  };

  const getPasswordStrength = (password: string): { level: number; text: string; color: string } => {
    if (!password) return { level: 0, text: '', color: '#374151' };

    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (score <= 2) return { level: 1, text: 'Faible', color: '#EF4444' };
    if (score <= 4) return { level: 2, text: 'Moyen', color: '#EAB308' };
    return { level: 3, text: 'Fort', color: '#10B981' };
  };

  const strength = getPasswordStrength(newPassword);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Changer le mot de passe</Text>
        <Text style={styles.subtitle}>
          Pour votre securite, choisissez un mot de passe unique et complexe
        </Text>

        {/* Current Password */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Mot de passe actuel</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.input, errors.currentPassword && styles.inputError]}
              placeholder="Entrez votre mot de passe actuel"
              placeholderTextColor="#6B7280"
              value={currentPassword}
              onChangeText={(text) => {
                setCurrentPassword(text);
                setErrors({ ...errors, currentPassword: '' });
              }}
              secureTextEntry={!showPasswords.current}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPasswords({ ...showPasswords, current: !showPasswords.current })}
            >
              <Ionicons name={showPasswords.current ? 'eye-off-outline' : 'eye-outline'} size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>
          {errors.currentPassword && <Text style={styles.errorText}>{errors.currentPassword}</Text>}
        </View>

        {/* New Password */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Nouveau mot de passe</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.input, errors.newPassword && styles.inputError]}
              placeholder="Entrez votre nouveau mot de passe"
              placeholderTextColor="#6B7280"
              value={newPassword}
              onChangeText={(text) => {
                setNewPassword(text);
                setErrors({ ...errors, newPassword: '' });
              }}
              secureTextEntry={!showPasswords.new}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}
            >
              <Ionicons name={showPasswords.new ? 'eye-off-outline' : 'eye-outline'} size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>
          {errors.newPassword && <Text style={styles.errorText}>{errors.newPassword}</Text>}

          {/* Password strength indicator */}
          {newPassword && (
            <View style={styles.strengthContainer}>
              <View style={styles.strengthBars}>
                {[1, 2, 3].map((level) => (
                  <View
                    key={level}
                    style={[
                      styles.strengthBar,
                      { backgroundColor: level <= strength.level ? strength.color : '#374151' },
                    ]}
                  />
                ))}
              </View>
              <Text style={[styles.strengthText, { color: strength.color }]}>{strength.text}</Text>
            </View>
          )}
        </View>

        {/* Confirm Password */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Confirmer le mot de passe</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.input, errors.confirmPassword && styles.inputError]}
              placeholder="Confirmez votre nouveau mot de passe"
              placeholderTextColor="#6B7280"
              value={confirmPassword}
              onChangeText={(text) => {
                setConfirmPassword(text);
                setErrors({ ...errors, confirmPassword: '' });
              }}
              secureTextEntry={!showPasswords.confirm}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })}
            >
              <Ionicons name={showPasswords.confirm ? 'eye-off-outline' : 'eye-outline'} size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>
          {errors.confirmPassword && <Text style={styles.errorText}>{errors.confirmPassword}</Text>}
          {confirmPassword && !errors.confirmPassword && newPassword === confirmPassword && (
            <Text style={styles.matchText}>✓ Les mots de passe correspondent</Text>
          )}
        </View>

        {/* Requirements */}
        <View style={styles.requirementsCard}>
          <Text style={styles.requirementsTitle}>Exigences du mot de passe</Text>
          <View style={styles.requirementItem}>
            <Text style={[styles.requirementIcon, newPassword.length >= 8 && styles.requirementMet]}>
              {newPassword.length >= 8 ? '✓' : '○'}
            </Text>
            <Text style={styles.requirementText}>Au moins 8 caracteres</Text>
          </View>
          <View style={styles.requirementItem}>
            <Text style={[styles.requirementIcon, /[A-Z]/.test(newPassword) && styles.requirementMet]}>
              {/[A-Z]/.test(newPassword) ? '✓' : '○'}
            </Text>
            <Text style={styles.requirementText}>Au moins une majuscule</Text>
          </View>
          <View style={styles.requirementItem}>
            <Text style={[styles.requirementIcon, /[0-9]/.test(newPassword) && styles.requirementMet]}>
              {/[0-9]/.test(newPassword) ? '✓' : '○'}
            </Text>
            <Text style={styles.requirementText}>Au moins un chiffre</Text>
          </View>
          <View style={styles.requirementItem}>
            <Text style={[styles.requirementIcon, /[^A-Za-z0-9]/.test(newPassword) && styles.requirementMet]}>
              {/[^A-Za-z0-9]/.test(newPassword) ? '✓' : '○'}
            </Text>
            <Text style={styles.requirementText}>Un caractere special (recommande)</Text>
          </View>
        </View>

        {message && (
          <InlineMessage type={message.type} message={message.text} onDismiss={() => setMessage(null)} />
        )}

        <TouchableOpacity
          style={[styles.submitButton, changeMutation.isPending && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={changeMutation.isPending}
        >
          {changeMutation.isPending ? (
            <ActivityIndicator size="small" color="#0F0F1A" />
          ) : (
            <Text style={styles.submitButtonText}>Changer le mot de passe</Text>
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
  subtitle: { fontSize: 14, color: '#9CA3AF', marginBottom: 24, lineHeight: 20 },

  inputGroup: { marginBottom: 20 },
  label: { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  inputContainer: { position: 'relative' },
  input: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    paddingRight: 50,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inputError: { borderColor: '#EF4444' },
  eyeButton: {
    position: 'absolute',
    right: 16,
    top: '50%',
    transform: [{ translateY: -12 }],
  },
  eyeIcon: { fontSize: 20 },
  errorText: { color: '#EF4444', fontSize: 12, marginTop: 4 },
  matchText: { color: '#10B981', fontSize: 12, marginTop: 4 },

  strengthContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 12,
  },
  strengthBars: { flexDirection: 'row', gap: 4, flex: 1 },
  strengthBar: { flex: 1, height: 4, borderRadius: 2 },
  strengthText: { fontSize: 12, fontWeight: '600' },

  requirementsCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  requirementsTitle: { color: '#9CA3AF', fontSize: 12, fontWeight: '600', marginBottom: 12 },
  requirementItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  requirementIcon: { color: '#6B7280', marginRight: 8, fontSize: 14 },
  requirementMet: { color: '#10B981' },
  requirementText: { color: '#9CA3AF', fontSize: 13 },

  submitButton: {
    backgroundColor: '#D4AF37',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  submitButtonText: { color: '#0F0F1A', fontWeight: '700', fontSize: 16 },

  bottomPadding: { height: 32 },
});
