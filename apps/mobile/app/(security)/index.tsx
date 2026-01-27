import { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/auth';
import InlineMessage from '../../components/InlineMessage';

const BIOMETRIC_ENABLED_KEY = 'tnc_biometric_enabled';

export default function SecurityScreen() {
  const { user } = useAuthStore();
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    checkBiometricAvailability();
    loadBiometricSetting();
  }, []);

  const checkBiometricAvailability = async () => {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setBiometricAvailable(compatible && enrolled);

      if (compatible) {
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
        if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
          setBiometricType('Face ID');
        } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
          setBiometricType('Empreinte digitale');
        } else {
          setBiometricType('Biométrie');
        }
      }
    } catch (error) {
      console.error('Error checking biometric availability:', error);
    }
  };

  const loadBiometricSetting = async () => {
    try {
      const enabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
      setBiometricEnabled(enabled === 'true');
    } catch (error) {
      console.error('Error loading biometric setting:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBiometricToggle = async (value: boolean) => {
    if (value) {
      // Verify biometric before enabling
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authentifiez-vous pour activer la biométrie',
        cancelLabel: 'Annuler',
        disableDeviceFallback: false,
      });

      if (result.success) {
        await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'true');
        setBiometricEnabled(true);
        setMessage({ type: 'success', text: `${biometricType} active avec succes` });
      } else {
        setMessage({ type: 'error', text: 'Authentification biometrique echouee' });
      }
    } else {
      await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'false');
      setBiometricEnabled(false);
    }
  };

  const handle2FAPress = () => {
    router.push('/(security)/two-factor');
  };

  const handleChangePassword = () => {
    router.push('/(security)/change-password');
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
      {message && (
        <InlineMessage type={message.type} message={message.text} onDismiss={() => setMessage(null)} />
      )}
      {/* 2FA Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Authentification à deux facteurs</Text>
        <TouchableOpacity style={styles.settingItem} onPress={handle2FAPress}>
          <View style={styles.settingInfo}>
            <View style={styles.settingIconContainer}>
              <Ionicons name="shield-checkmark" size={22} color="#D4AF37" />
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>2FA par application</Text>
              <Text style={styles.settingDescription}>
                Utilisez une application d'authentification (Google Authenticator, Authy)
              </Text>
            </View>
          </View>
          <View style={[styles.statusBadge, user?.twoFactorEnabled ? styles.statusActive : styles.statusInactive]}>
            <Text style={styles.statusText}>{user?.twoFactorEnabled ? 'Actif' : 'Inactif'}</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Biometric Section */}
      {biometricAvailable && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Connexion biométrique</Text>
          <View style={styles.settingItem}>
            <View style={styles.settingInfo}>
              <View style={styles.settingIconContainer}>
                <Ionicons name={biometricType === 'Face ID' ? 'scan' : 'finger-print'} size={22} color="#D4AF37" />
              </View>
              <View style={styles.settingContent}>
                <Text style={styles.settingTitle}>{biometricType}</Text>
                <Text style={styles.settingDescription}>
                  Connexion rapide avec {biometricType.toLowerCase()}
                </Text>
              </View>
            </View>
            <Switch
              value={biometricEnabled}
              onValueChange={handleBiometricToggle}
              trackColor={{ false: '#374151', true: 'rgba(212, 175, 55, 0.5)' }}
              thumbColor={biometricEnabled ? '#D4AF37' : '#9CA3AF'}
            />
          </View>
        </View>
      )}

      {/* Password Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mot de passe</Text>
        <TouchableOpacity style={styles.settingItem} onPress={handleChangePassword}>
          <View style={styles.settingInfo}>
            <View style={styles.settingIconContainer}>
              <Ionicons name="key" size={22} color="#D4AF37" />
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>Changer le mot de passe</Text>
              <Text style={styles.settingDescription}>
                Mettez à jour votre mot de passe régulièrement
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      {/* Security Tips */}
      <View style={styles.tipsSection}>
        <Text style={styles.tipsTitle}>Conseils de sécurité</Text>
        <View style={styles.tipItem}>
          <Ionicons name="checkmark-circle" size={16} color="#10B981" />
          <Text style={styles.tipText}>Activez l'authentification 2FA pour plus de sécurité</Text>
        </View>
        <View style={styles.tipItem}>
          <Ionicons name="checkmark-circle" size={16} color="#10B981" />
          <Text style={styles.tipText}>Utilisez un mot de passe unique et complexe</Text>
        </View>
        <View style={styles.tipItem}>
          <Ionicons name="checkmark-circle" size={16} color="#10B981" />
          <Text style={styles.tipText}>Ne partagez jamais vos codes d'accès</Text>
        </View>
        <View style={styles.tipItem}>
          <Ionicons name="checkmark-circle" size={16} color="#10B981" />
          <Text style={styles.tipText}>Vérifiez toujours l'URL avant de vous connecter</Text>
        </View>
      </View>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A', padding: 16 },
  loadingContainer: { flex: 1, backgroundColor: '#0F0F1A', justifyContent: 'center', alignItems: 'center' },

  section: { marginBottom: 24 },
  sectionTitle: { color: '#9CA3AF', fontSize: 12, fontWeight: '600', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 },

  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
  },
  settingInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  settingIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  settingIcon: { fontSize: 22 },
  settingContent: { flex: 1 },
  settingTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 2 },
  settingDescription: { color: '#9CA3AF', fontSize: 13 },

  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  statusActive: { backgroundColor: 'rgba(16, 185, 129, 0.2)' },
  statusInactive: { backgroundColor: 'rgba(234, 179, 8, 0.2)' },
  statusText: { color: '#fff', fontWeight: '600', fontSize: 12 },

  arrow: { color: '#9CA3AF', fontSize: 18 },

  tipsSection: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  tipsTitle: { color: '#93C5FD', fontSize: 14, fontWeight: '600', marginBottom: 12 },
  tipItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  tipIcon: { color: '#10B981', fontWeight: '700', marginRight: 12 },
  tipText: { color: '#93C5FD', fontSize: 13, flex: 1 },

  bottomPadding: { height: 32 },
});
