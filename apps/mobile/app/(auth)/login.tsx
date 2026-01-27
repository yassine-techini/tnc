import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Link, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../lib/api';
import InlineMessage from '../../components/InlineMessage';

const BIOMETRIC_ENABLED_KEY = 'tnc_biometric_enabled';
const BIOMETRIC_CREDENTIALS_KEY = 'tnc_biometric_credentials';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    identifier: '',
    password: '',
    totpCode: '',
  });
  const [showTOTP, setShowTOTP] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  const handleLogin = async () => {
    setErrorMsg('');
    if (!formData.identifier || !formData.password) {
      setErrorMsg('Veuillez remplir tous les champs');
      return;
    }

    setIsLoading(true);

    try {
      const response = await api.login(
        formData.identifier,
        formData.password,
        formData.totpCode || undefined
      );

      login(
        {
          id: response.data.user.id,
          email: response.data.user.email,
          phone: response.data.user.phone,
          country: response.data.user.country,
          kycLevel: response.data.user.kycLevel,
          kycStatus: response.data.user.kycStatus as any,
          emailVerified: response.data.user.emailVerified,
          phoneVerified: response.data.user.phoneVerified,
          twoFactorEnabled: response.data.user.twoFactorEnabled,
        },
        {
          accessToken: response.data.accessToken,
          refreshToken: response.data.refreshToken,
          expiresIn: response.data.expiresIn,
        }
      );

      // Save credentials for biometric login if enabled
      const biometricEnabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
      if (biometricEnabled === 'true') {
        await SecureStore.setItemAsync(
          BIOMETRIC_CREDENTIALS_KEY,
          JSON.stringify({ identifier: formData.identifier, password: formData.password })
        );
      }

      router.replace('/(tabs)');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur de connexion';
      if (message.includes('2FA')) {
        setShowTOTP(true);
      } else {
        setErrorMsg(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    setErrorMsg('');
    setIsLoading(true);

    try {
      // Check if biometric is enabled
      const enabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
      if (enabled !== 'true') {
        setErrorMsg('La biométrie n\'est pas activée');
        return;
      }

      // Get stored credentials
      const credentialsJson = await SecureStore.getItemAsync(BIOMETRIC_CREDENTIALS_KEY);
      if (!credentialsJson) {
        setErrorMsg('Aucune information d\'identification enregistrée');
        return;
      }

      const credentials = JSON.parse(credentialsJson);

      // Authenticate with biometric
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Connectez-vous avec la biométrie',
        cancelLabel: 'Annuler',
      });

      if (!result.success) {
        setErrorMsg('Authentification biométrique échouée');
        return;
      }

      // Login with stored credentials
      const response = await api.login(credentials.identifier, credentials.password);

      login(
        {
          id: response.data.user.id,
          email: response.data.user.email,
          phone: response.data.user.phone,
          country: response.data.user.country,
          kycLevel: response.data.user.kycLevel,
          kycStatus: response.data.user.kycStatus as any,
          emailVerified: response.data.user.emailVerified,
          phoneVerified: response.data.user.phoneVerified,
          twoFactorEnabled: response.data.user.twoFactorEnabled,
        },
        {
          accessToken: response.data.accessToken,
          refreshToken: response.data.refreshToken,
          expiresIn: response.data.expiresIn,
        }
      );

      router.replace('/(tabs)');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur de connexion biométrique';
      setErrorMsg(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const checkBiometric = async () => {
      // Check if biometric hardware is available
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      const available = compatible && enrolled;
      setBiometricAvailable(available);

      if (available) {
        // Check if biometric is enabled for the app
        const enabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
        const isEnabled = enabled === 'true';
        setBiometricEnabled(isEnabled);

        // Auto-trigger biometric login if enabled
        if (isEnabled) {
          handleBiometricLogin();
        }
      }
    };

    checkBiometric();
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Branding */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <View style={styles.logoCoin}>
              <Text style={styles.logoText}>Au</Text>
            </View>
          </View>
          <Text style={styles.title}>TNC Trading</Text>
          <Text style={styles.tagline}>Or souverain du Burkina Faso</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.formTitle}>Connexion</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email ou telephone</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="mail-outline" size={18} color="#6B7280" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="email@example.com"
                placeholderTextColor="#4B5563"
                value={formData.identifier}
                onChangeText={(text) => setFormData({ ...formData, identifier: text })}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Mot de passe</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={18} color="#6B7280" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Votre mot de passe"
                placeholderTextColor="#4B5563"
                value={formData.password}
                onChangeText={(text) => setFormData({ ...formData, password: text })}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeButton}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color="#6B7280"
                />
              </TouchableOpacity>
            </View>
          </View>

          {showTOTP && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Code 2FA</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="shield-checkmark-outline" size={18} color="#6B7280" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="123456"
                  placeholderTextColor="#4B5563"
                  value={formData.totpCode}
                  onChangeText={(text) => setFormData({ ...formData, totpCode: text })}
                  keyboardType="number-pad"
                  maxLength={6}
                />
              </View>
            </View>
          )}

          <TouchableOpacity style={styles.forgotPassword}>
            <Text style={styles.forgotPasswordText}>Mot de passe oublie ?</Text>
          </TouchableOpacity>

          {errorMsg ? (
            <InlineMessage
              type="error"
              message={errorMsg}
              onDismiss={() => setErrorMsg('')}
            />
          ) : null}

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#0F0F1A" />
            ) : (
              <>
                <Text style={styles.buttonText}>Se connecter</Text>
                <Ionicons name="arrow-forward" size={20} color="#0F0F1A" />
              </>
            )}
          </TouchableOpacity>

          {biometricAvailable && biometricEnabled && (
            <TouchableOpacity
              style={[styles.biometricButton, isLoading && styles.buttonDisabled]}
              onPress={handleBiometricLogin}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              <Ionicons name="finger-print" size={20} color="#D4AF37" />
              <Text style={styles.biometricButtonText}>Se connecter avec la biométrie</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou</Text>
            <View style={styles.dividerLine} />
          </View>

          <Link href="/(auth)/register" asChild>
            <TouchableOpacity style={styles.registerButton} activeOpacity={0.8}>
              <Text style={styles.registerButtonText}>Creer un compte</Text>
            </TouchableOpacity>
          </Link>

          <Text style={styles.legalText}>
            En vous connectant, vous acceptez nos conditions d'utilisation et notre politique de confidentialite.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1A',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoContainer: {
    marginBottom: 16,
  },
  logoCoin: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#D4AF37',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#D4AF37',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  logoText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#0F0F1A',
    fontStyle: 'italic',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#D4AF37',
    letterSpacing: 1,
  },
  tagline: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 6,
    letterSpacing: 0.5,
  },
  form: {
    gap: 16,
  },
  formTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
    borderWidth: 1,
    borderColor: '#2D2D44',
    borderRadius: 12,
  },
  inputIcon: {
    paddingLeft: 14,
  },
  input: {
    flex: 1,
    padding: 14,
    paddingLeft: 10,
    color: '#fff',
    fontSize: 16,
  },
  eyeButton: {
    padding: 14,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
  },
  forgotPasswordText: {
    fontSize: 13,
    color: '#D4AF37',
    fontWeight: '500',
  },
  button: {
    backgroundColor: '#D4AF37',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#0F0F1A',
    fontSize: 17,
    fontWeight: '700',
  },
  biometricButton: {
    borderWidth: 1,
    borderColor: '#D4AF37',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  biometricButtonText: {
    color: '#D4AF37',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    marginTop: 32,
    gap: 20,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#2D2D44',
  },
  dividerText: {
    fontSize: 13,
    color: '#6B7280',
  },
  registerButton: {
    borderWidth: 1,
    borderColor: '#D4AF37',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  registerButtonText: {
    color: '#D4AF37',
    fontSize: 16,
    fontWeight: '600',
  },
  legalText: {
    fontSize: 11,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 16,
  },
});
