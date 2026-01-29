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
type LoginMode = 'password' | 'passwordless';
type PasswordlessStep = 'request' | 'verify' | '2fa';

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

  // Passwordless state
  const [loginMode, setLoginMode] = useState<LoginMode>('password');
  const [passwordlessStep, setPasswordlessStep] = useState<PasswordlessStep>('request');
  const [passwordlessMethod, setPasswordlessMethod] = useState<'email' | 'sms'>('email');
  const [otpCode, setOtpCode] = useState('');
  const [countdown, setCountdown] = useState(0);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

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

  const handlePasswordlessRequest = async () => {
    setErrorMsg('');
    const identifier = formData.identifier.trim();

    if (!identifier) {
      setErrorMsg('Veuillez entrer votre email ou numéro de téléphone');
      return;
    }

    setIsLoading(true);

    try {
      await api.requestPasswordlessCode(identifier, passwordlessMethod);
      setPasswordlessStep('verify');
      setCountdown(60);
      setOtpCode('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l\'envoi du code';
      setErrorMsg(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordlessVerify = async () => {
    setErrorMsg('');

    if (otpCode.length !== 6) {
      setErrorMsg('Veuillez entrer le code à 6 chiffres');
      return;
    }

    setIsLoading(true);

    try {
      const result = await api.verifyPasswordlessCode(
        formData.identifier,
        otpCode,
        passwordlessStep === '2fa' ? formData.totpCode : undefined
      );

      if (!result.success) {
        if ('requires2FA' in result && result.requires2FA) {
          setPasswordlessStep('2fa');
          setIsLoading(false);
          return;
        }
        return;
      }

      if (result.success) {
        const userData = {
          id: result.data.user.id,
          email: result.data.user.email,
          phone: result.data.user.phone,
          country: result.data.user.country,
          kycLevel: result.data.user.kycLevel,
          kycStatus: result.data.user.kycStatus as any,
          emailVerified: result.data.user.emailVerified,
          phoneVerified: result.data.user.phoneVerified,
          twoFactorEnabled: result.data.user.twoFactorEnabled,
        };

        login(userData, {
          accessToken: result.data.accessToken,
          refreshToken: result.data.refreshToken,
          expiresIn: result.data.expiresIn,
        });

        // Save refresh token for biometric + remember email
        const biometricOn = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
        if (biometricOn === 'true') {
          await SecureStore.setItemAsync(BIOMETRIC_REFRESH_TOKEN_KEY, result.data.refreshToken);
        }
        await SecureStore.setItemAsync(LAST_USER_EMAIL_KEY, result.data.user.email);

        router.replace('/(tabs)');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Code invalide';
      setErrorMsg(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (countdown > 0) return;
    await handlePasswordlessRequest();
  };

  const switchLoginMode = (mode: LoginMode) => {
    setLoginMode(mode);
    setPasswordlessStep('request');
    setOtpCode('');
    setErrorMsg('');
    setShowTOTP(false);
    setFormData({ ...formData, totpCode: '' });
  };

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

          {/* Login Mode Toggle */}
          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[
                styles.modeButton,
                loginMode === 'password' && styles.modeButtonActive,
              ]}
              onPress={() => switchLoginMode('password')}
              activeOpacity={0.8}
            >
              <Ionicons
                name="lock-closed-outline"
                size={16}
                color={loginMode === 'password' ? '#0F0F1A' : '#D4AF37'}
              />
              <Text style={[
                styles.modeButtonText,
                loginMode === 'password' && styles.modeButtonTextActive,
              ]}>Mot de passe</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modeButton,
                loginMode === 'passwordless' && styles.modeButtonActive,
              ]}
              onPress={() => switchLoginMode('passwordless')}
              activeOpacity={0.8}
            >
              <Ionicons
                name="mail-outline"
                size={16}
                color={loginMode === 'passwordless' ? '#0F0F1A' : '#D4AF37'}
              />
              <Text style={[
                styles.modeButtonText,
                loginMode === 'passwordless' && styles.modeButtonTextActive,
              ]}>Code unique</Text>
            </TouchableOpacity>
          </View>

          {/* PASSWORD MODE */}
          {loginMode === 'password' && (
            <>
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
            </>
          )}

          {/* PASSWORDLESS MODE */}
          {loginMode === 'passwordless' && (
            <>
              {/* Step 1: Request Code */}
              {passwordlessStep === 'request' && (
                <>
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
                    <Text style={[styles.label, { color: c.textSecondary }]}>Recevoir le code par</Text>
                    <View style={styles.methodToggle}>
                      <TouchableOpacity
                        style={[
                          styles.methodButton,
                          passwordlessMethod === 'email' && styles.methodButtonActive,
                        ]}
                        onPress={() => setPasswordlessMethod('email')}
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name="mail-outline"
                          size={16}
                          color={passwordlessMethod === 'email' ? '#0F0F1A' : '#D4AF37'}
                        />
                        <Text style={[
                          styles.methodButtonText,
                          passwordlessMethod === 'email' && styles.methodButtonTextActive,
                        ]}>Email</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.methodButton,
                          passwordlessMethod === 'sms' && styles.methodButtonActive,
                        ]}
                        onPress={() => setPasswordlessMethod('sms')}
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name="chatbubble-outline"
                          size={16}
                          color={passwordlessMethod === 'sms' ? '#0F0F1A' : '#D4AF37'}
                        />
                        <Text style={[
                          styles.methodButtonText,
                          passwordlessMethod === 'sms' && styles.methodButtonTextActive,
                        ]}>SMS</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {errorMsg ? (
                    <InlineMessage
                      type="error"
                      message={errorMsg}
                      onDismiss={() => setErrorMsg('')}
                    />
                  ) : null}

                  <TouchableOpacity
                    style={[styles.button, isLoading && styles.buttonDisabled]}
                    onPress={handlePasswordlessRequest}
                    disabled={isLoading}
                    activeOpacity={0.8}
                  >
                    {isLoading ? (
                      <ActivityIndicator color="#0F0F1A" />
                    ) : (
                      <>
                        <Text style={styles.buttonText}>Envoyer le code</Text>
                        <Ionicons name="send-outline" size={20} color="#0F0F1A" />
                      </>
                    )}
                  </TouchableOpacity>
                </>
              )}

              {/* Step 2: Verify Code */}
              {passwordlessStep === 'verify' && (
                <>
                  <View style={styles.verifyHeader}>
                    <Ionicons name="mail-open-outline" size={48} color="#D4AF37" />
                    <Text style={[styles.verifyTitle, { color: c.text }]}>Code envoyé</Text>
                    <Text style={[styles.verifySubtitle, { color: c.textSecondary }]}>
                      Entrez le code à 6 chiffres envoyé à {formData.identifier}
                    </Text>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: c.textSecondary }]}>Code à usage unique</Text>
                    <View style={[styles.inputWrapper, { backgroundColor: c.surface, borderColor: c.border }]}>
                      <Ionicons name="keypad-outline" size={18} color={c.textTertiary} style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, styles.otpInput, { color: c.text }]}
                        placeholder="000000"
                        placeholderTextColor={c.textTertiary}
                        value={otpCode}
                        onChangeText={setOtpCode}
                        keyboardType="number-pad"
                        maxLength={6}
                        autoFocus
                      />
                    </View>
                  </View>

                  <View style={styles.resendRow}>
                    {countdown > 0 ? (
                      <Text style={[styles.countdownText, { color: c.textSecondary }]}>
                        Renvoyer dans {countdown}s
                      </Text>
                    ) : (
                      <TouchableOpacity onPress={handleResendCode} disabled={isLoading}>
                        <Text style={styles.resendText}>Renvoyer le code</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => setPasswordlessStep('request')}>
                      <Text style={styles.changeIdentifierText}>Changer d'identifiant</Text>
                    </TouchableOpacity>
                  </View>

                  {errorMsg ? (
                    <InlineMessage
                      type="error"
                      message={errorMsg}
                      onDismiss={() => setErrorMsg('')}
                    />
                  ) : null}

                  <TouchableOpacity
                    style={[styles.button, (isLoading || otpCode.length !== 6) && styles.buttonDisabled]}
                    onPress={handlePasswordlessVerify}
                    disabled={isLoading || otpCode.length !== 6}
                    activeOpacity={0.8}
                  >
                    {isLoading ? (
                      <ActivityIndicator color="#0F0F1A" />
                    ) : (
                      <>
                        <Text style={styles.buttonText}>Vérifier</Text>
                        <Ionicons name="checkmark" size={20} color="#0F0F1A" />
                      </>
                    )}
                  </TouchableOpacity>
                </>
              )}

              {/* Step 3: 2FA (if enabled) */}
              {passwordlessStep === '2fa' && (
                <>
                  <View style={styles.verifyHeader}>
                    <Ionicons name="shield-checkmark-outline" size={48} color="#D4AF37" />
                    <Text style={[styles.verifyTitle, { color: c.text }]}>Vérification 2FA</Text>
                    <Text style={[styles.verifySubtitle, { color: c.textSecondary }]}>
                      Entrez le code de votre application d'authentification
                    </Text>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: c.textSecondary }]}>Code 2FA</Text>
                    <View style={[styles.inputWrapper, { backgroundColor: c.surface, borderColor: c.border }]}>
                      <Ionicons name="shield-checkmark-outline" size={18} color={c.textTertiary} style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, styles.otpInput, { color: c.text }]}
                        placeholder="000000"
                        placeholderTextColor={c.textTertiary}
                        value={formData.totpCode}
                        onChangeText={(text) => setFormData({ ...formData, totpCode: text })}
                        keyboardType="number-pad"
                        maxLength={6}
                        autoFocus
                      />
                    </View>
                  </View>

                  {errorMsg ? (
                    <InlineMessage
                      type="error"
                      message={errorMsg}
                      onDismiss={() => setErrorMsg('')}
                    />
                  ) : null}

                  <TouchableOpacity
                    style={[styles.button, (isLoading || formData.totpCode.length !== 6) && styles.buttonDisabled]}
                    onPress={handlePasswordlessVerify}
                    disabled={isLoading || formData.totpCode.length !== 6}
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
                </>
              )}
            </>
          )}
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
  // ── Passwordless styles ──
  modeToggle: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  modeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    borderRadius: 10,
  },
  modeButtonActive: {
    backgroundColor: '#D4AF37',
    borderColor: '#D4AF37',
  },
  modeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D4AF37',
  },
  modeButtonTextActive: {
    color: '#0F0F1A',
  },
  methodToggle: {
    flexDirection: 'row',
    gap: 8,
  },
  methodButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    borderRadius: 10,
  },
  methodButtonActive: {
    backgroundColor: '#D4AF37',
    borderColor: '#D4AF37',
  },
  methodButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D4AF37',
  },
  methodButtonTextActive: {
    color: '#0F0F1A',
  },
  verifyHeader: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingVertical: 16,
  },
  verifyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginTop: 8,
  },
  verifySubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
  },
  otpInput: {
    textAlign: 'center',
    letterSpacing: 8,
    fontSize: 24,
    fontWeight: '600',
  },
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  countdownText: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  resendText: {
    fontSize: 13,
    color: '#D4AF37',
    fontWeight: '500',
  },
  changeIdentifierText: {
    fontSize: 13,
    color: '#6B7280',
  },
});
