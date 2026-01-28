import { useState, useEffect, useCallback } from 'react';
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
import { useThemeColors } from '../../stores/theme';
import { api } from '../../lib/api';
import { validateForm, loginSchema } from '../../lib/validation';
import InlineMessage from '../../components/InlineMessage';

const BIOMETRIC_ENABLED_KEY = 'tnc_biometric_enabled';
const BIOMETRIC_REFRESH_TOKEN_KEY = 'tnc_biometric_refresh_token';
const LAST_USER_EMAIL_KEY = 'tnc_last_user_email';

// Demo accounts (staging/dev only)
const DEMO_ACCOUNTS = __DEV__ ? [
  { label: 'Compte Standard', email: 'demo@tnc.trading', password: 'Demo2024!', level: 'STANDARD' },
  { label: 'Compte Vérifié', email: 'verified@tnc.trading', password: 'Demo2024!', level: 'VERIFIED' },
] : [];

type ScreenMode = 'biometric' | 'credentials';

export default function LoginScreen() {
  const c = useThemeColors();
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
  const [screenMode, setScreenMode] = useState<ScreenMode>('credentials');
  const [lastUserEmail, setLastUserEmail] = useState('');
  const [biometricType, setBiometricType] = useState<'face' | 'fingerprint'>('fingerprint');
  const [checkingBiometric, setCheckingBiometric] = useState(true);

  const fillDemoAccount = (account: typeof DEMO_ACCOUNTS[0]) => {
    setFormData({ ...formData, identifier: account.email, password: account.password });
    setErrorMsg('');
  };

  // Check if returning user with biometric enabled
  useEffect(() => {
    const init = async () => {
      try {
        const compatible = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        if (!compatible || !enrolled) {
          setCheckingBiometric(false);
          return;
        }

        // Detect biometric type
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
        if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
          setBiometricType('face');
        }

        // Check if biometric is enabled + has stored refresh token
        const enabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
        const storedToken = await SecureStore.getItemAsync(BIOMETRIC_REFRESH_TOKEN_KEY);
        const savedEmail = await SecureStore.getItemAsync(LAST_USER_EMAIL_KEY);

        if (enabled === 'true' && storedToken) {
          // Returning user — show biometric screen
          setScreenMode('biometric');
          if (savedEmail) setLastUserEmail(savedEmail);
          // Auto-trigger biometric
          setTimeout(() => handleBiometricLogin(), 300);
        }
      } catch (err) {
        console.error('Biometric init error:', err);
      } finally {
        setCheckingBiometric(false);
      }
    };
    init();
  }, []);

  const handleLogin = async () => {
    setErrorMsg('');
    const validation = validateForm(loginSchema, {
      identifier: formData.identifier,
      password: formData.password,
      totpCode: formData.totpCode || undefined,
    });
    if (!validation.success) {
      setErrorMsg(validation.firstError || 'Veuillez vérifier vos informations');
      return;
    }

    setIsLoading(true);

    try {
      const response = await api.login(
        formData.identifier,
        formData.password,
        formData.totpCode || undefined
      );

      const userData = {
        id: response.data.user.id,
        email: response.data.user.email,
        phone: response.data.user.phone,
        country: response.data.user.country,
        kycLevel: response.data.user.kycLevel,
        kycStatus: response.data.user.kycStatus as any,
        emailVerified: response.data.user.emailVerified,
        phoneVerified: response.data.user.phoneVerified,
        twoFactorEnabled: response.data.user.twoFactorEnabled,
      };

      login(userData, {
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken,
        expiresIn: response.data.expiresIn,
      });

      // Save refresh token for biometric + remember email
      const biometricOn = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
      if (biometricOn === 'true') {
        await SecureStore.setItemAsync(BIOMETRIC_REFRESH_TOKEN_KEY, response.data.refreshToken);
      }
      await SecureStore.setItemAsync(LAST_USER_EMAIL_KEY, response.data.user.email);

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

  const handleBiometricLogin = useCallback(async () => {
    setErrorMsg('');
    setIsLoading(true);

    try {
      const storedRefreshToken = await SecureStore.getItemAsync(BIOMETRIC_REFRESH_TOKEN_KEY);
      if (!storedRefreshToken) {
        setErrorMsg('Session expirée. Veuillez vous reconnecter.');
        await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
        setScreenMode('credentials');
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Connectez-vous à TNC Trading',
        cancelLabel: 'Utiliser le mot de passe',
        disableDeviceFallback: false,
      });

      if (!result.success) {
        // User cancelled — don't show error, just stay on biometric screen
        setIsLoading(false);
        return;
      }

      // Use refresh token to get new session
      const response = await api.refreshToken(storedRefreshToken);

      // Save new refresh token for next time
      await SecureStore.setItemAsync(BIOMETRIC_REFRESH_TOKEN_KEY, response.data.refreshToken);

      // Fetch user profile
      const profileResponse = await api.getProfile(response.data.accessToken);

      login(
        {
          id: profileResponse.data.id,
          email: profileResponse.data.email,
          phone: profileResponse.data.phone,
          country: 'BF',
          kycLevel: profileResponse.data.kycLevel,
          kycStatus: profileResponse.data.kycStatus as any,
          emailVerified: true,
          phoneVerified: true,
          twoFactorEnabled: false,
        },
        {
          accessToken: response.data.accessToken,
          refreshToken: response.data.refreshToken,
          expiresIn: response.data.expiresIn,
        }
      );

      router.replace('/(tabs)');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur de connexion';
      if (message.includes('expired') || message.includes('invalid') || message.includes('Unauthorized')) {
        await SecureStore.deleteItemAsync(BIOMETRIC_REFRESH_TOKEN_KEY);
        setErrorMsg('Session expirée. Veuillez vous reconnecter.');
        setScreenMode('credentials');
      } else {
        setErrorMsg(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [login]);

  // Loading check
  if (checkingBiometric) {
    return (
      <View style={[styles.container, { backgroundColor: c.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#D4AF37" />
      </View>
    );
  }

  // ── BIOMETRIC SCREEN (banking-app style) ──
  if (screenMode === 'biometric') {
    return (
      <View style={[styles.container, styles.biometricScreen, { backgroundColor: c.background, paddingTop: insets.top + 60 }]}>
        {/* Logo */}
        <View style={styles.biometricHeader}>
          <View style={styles.logoCoin}>
            <Text style={styles.logoText}>Au</Text>
          </View>
          <Text style={styles.biometricTitle}>TNC Trading</Text>
          {lastUserEmail ? (
            <Text style={[styles.biometricEmail, { color: c.textSecondary }]}>{lastUserEmail}</Text>
          ) : null}
        </View>

        {/* Biometric prompt */}
        <View style={styles.biometricCenter}>
          {errorMsg ? (
            <InlineMessage
              type="error"
              message={errorMsg}
              onDismiss={() => setErrorMsg('')}
            />
          ) : null}

          <TouchableOpacity
            style={styles.biometricCircle}
            onPress={handleBiometricLogin}
            disabled={isLoading}
            activeOpacity={0.7}
          >
            {isLoading ? (
              <ActivityIndicator size="large" color="#D4AF37" />
            ) : (
              <Ionicons
                name={biometricType === 'face' ? 'scan-outline' : 'finger-print'}
                size={56}
                color="#D4AF37"
              />
            )}
          </TouchableOpacity>

          <Text style={[styles.biometricHint, { color: c.textSecondary }]}>
            {isLoading
              ? 'Connexion en cours...'
              : biometricType === 'face'
                ? 'Appuyez pour Face ID'
                : 'Appuyez pour l\'empreinte'}
          </Text>
        </View>

        {/* Switch to credentials */}
        <View style={styles.biometricFooter}>
          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => {
              setScreenMode('credentials');
              setErrorMsg('');
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="key-outline" size={18} color="#D4AF37" />
            <Text style={styles.switchButtonText}>Utiliser les identifiants</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── CREDENTIALS SCREEN (classic login form) ──
  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.background }]}
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
          <Text style={[styles.tagline, { color: c.textTertiary }]}>Or souverain du Burkina Faso</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text style={[styles.formTitle, { color: c.text }]}>Connexion</Text>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: c.textSecondary }]}>Email ou telephone</Text>
            <View style={[styles.inputWrapper, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Ionicons name="mail-outline" size={18} color={c.textTertiary} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="email@example.com"
                placeholderTextColor={c.textTertiary}
                value={formData.identifier}
                onChangeText={(text) => setFormData({ ...formData, identifier: text })}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: c.textSecondary }]}>Mot de passe</Text>
            <View style={[styles.inputWrapper, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Ionicons name="lock-closed-outline" size={18} color={c.textTertiary} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="Votre mot de passe"
                placeholderTextColor={c.textTertiary}
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
                  color={c.textTertiary}
                />
              </TouchableOpacity>
            </View>
          </View>

          {showTOTP && (
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: c.textSecondary }]}>Code 2FA</Text>
              <View style={[styles.inputWrapper, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Ionicons name="shield-checkmark-outline" size={18} color={c.textTertiary} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: c.text }]}
                  placeholder="123456"
                  placeholderTextColor={c.textTertiary}
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
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
            <Text style={[styles.dividerText, { color: c.textTertiary }]}>ou</Text>
            <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
          </View>

          <Link href="/(auth)/register" asChild>
            <TouchableOpacity style={styles.registerButton} activeOpacity={0.8}>
              <Text style={styles.registerButtonText}>Creer un compte</Text>
            </TouchableOpacity>
          </Link>

          <Text style={[styles.legalText, { color: c.textTertiary }]}>
            En vous connectant, vous acceptez nos conditions d'utilisation et notre politique de confidentialite.
          </Text>

          {/* Demo Accounts Section (dev only) */}
          {DEMO_ACCOUNTS.length > 0 && (
            <View style={styles.demoSection}>
              <View style={[styles.demoHeader, { borderTopColor: c.border }]}>
                <Text style={[styles.demoTitle, { color: c.textSecondary }]}>Comptes de démonstration</Text>
              </View>
              {DEMO_ACCOUNTS.map((account) => (
                <TouchableOpacity
                  key={account.email}
                  style={[styles.demoButton, { backgroundColor: 'rgba(212, 175, 55, 0.1)', borderColor: 'rgba(212, 175, 55, 0.3)' }]}
                  onPress={() => fillDemoAccount(account)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.demoButtonLabel, { color: c.text }]}>{account.label}</Text>
                  <View style={styles.demoLevelBadge}>
                    <Text style={styles.demoLevelText}>{account.level}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              <Text style={[styles.demoHint, { color: c.textTertiary }]}>
                Appuyez pour auto-remplir les identifiants
              </Text>
            </View>
          )}
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

  // ── Biometric screen ──
  biometricScreen: {
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  biometricHeader: {
    alignItems: 'center',
  },
  biometricTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#D4AF37',
    letterSpacing: 1,
    marginTop: 16,
  },
  biometricEmail: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 8,
  },
  biometricCenter: {
    alignItems: 'center',
    gap: 24,
    width: '100%',
  },
  biometricCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    backgroundColor: 'rgba(212, 175, 55, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  biometricHint: {
    fontSize: 15,
    color: '#9CA3AF',
  },
  biometricFooter: {
    width: '100%',
    alignItems: 'center',
  },
  switchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    borderRadius: 12,
  },
  switchButtonText: {
    color: '#D4AF37',
    fontSize: 15,
    fontWeight: '600',
  },

  // ── Credentials screen ──
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
  // Demo section
  demoSection: {
    marginTop: 20,
    gap: 10,
  },
  demoHeader: {
    borderTopWidth: 1,
    borderTopColor: '#2D2D44',
    paddingTop: 16,
  },
  demoTitle: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 8,
  },
  demoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
  },
  demoButtonLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  demoLevelBadge: {
    backgroundColor: 'rgba(212, 175, 55, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  demoLevelText: {
    fontSize: 11,
    color: '#D4AF37',
    fontWeight: '600',
  },
  demoHint: {
    fontSize: 11,
    color: '#6B7280',
    textAlign: 'center',
  },
});
