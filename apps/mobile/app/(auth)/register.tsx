import { useState } from 'react';
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
import { Picker } from '@react-native-picker/picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../stores/theme';
import { api } from '../../lib/api';
import InlineMessage from '../../components/InlineMessage';

const countries = [
  { code: 'BF', name: 'Burkina Faso', prefix: '+226' },
  { code: 'CI', name: "Cote d'Ivoire", prefix: '+225' },
  { code: 'ML', name: 'Mali', prefix: '+223' },
  { code: 'SN', name: 'Senegal', prefix: '+221' },
  { code: 'TG', name: 'Togo', prefix: '+228' },
  { code: 'BJ', name: 'Benin', prefix: '+229' },
  { code: 'NE', name: 'Niger', prefix: '+227' },
  { code: 'GW', name: 'Guinee-Bissau', prefix: '+245' },
];

export default function RegisterScreen() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [formData, setFormData] = useState({
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    country: 'BF',
  });

  const selectedCountry = countries.find(c => c.code === formData.country);

  const getPasswordStrength = () => {
    const pw = formData.password;
    if (!pw) return { level: 0, label: '', color: '#374151' };
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    if (score <= 2) return { level: 1, label: 'Faible', color: '#EF4444' };
    if (score <= 3) return { level: 2, label: 'Moyen', color: '#F59E0B' };
    return { level: 3, label: 'Fort', color: '#10B981' };
  };

  const strength = getPasswordStrength();

  const handleRegister = async () => {
    setErrorMsg('');
    setSuccessMsg('');

    if (!formData.email || !formData.phone || !formData.password) {
      setErrorMsg('Veuillez remplir tous les champs');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setErrorMsg('Les mots de passe ne correspondent pas');
      return;
    }

    if (formData.password.length < 8) {
      setErrorMsg('Le mot de passe doit contenir au moins 8 caracteres');
      return;
    }

    setIsLoading(true);

    try {
      await api.register(
        formData.email,
        formData.phone,
        formData.password,
        formData.country
      );

      setSuccessMsg('Votre compte a ete cree avec succes. Verifiez votre email.');
      setTimeout(() => router.replace('/(auth)/login'), 2500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erreur lors de l'inscription");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Back button */}
        <Link href="/(auth)/login" asChild>
          <TouchableOpacity style={[styles.backButton, { backgroundColor: c.surface }]}>
            <Ionicons name="arrow-back" size={24} color={c.text} />
          </TouchableOpacity>
        </Link>

        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text }]}>Creer un compte</Text>
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>Rejoignez TNC Trading et investissez dans l'or souverain</Text>
        </View>

        {/* Progress steps */}
        <View style={styles.steps}>
          <View style={[styles.step, styles.stepActive]}>
            <Text style={[styles.stepNumber, styles.stepNumberActive]}>1</Text>
            <Text style={[styles.stepLabel, styles.stepLabelActive]}>Inscription</Text>
          </View>
          <View style={[styles.stepLine, { backgroundColor: c.border }]} />
          <View style={styles.step}>
            <Text style={[styles.stepNumber, { backgroundColor: c.border, color: c.textTertiary }]}>2</Text>
            <Text style={[styles.stepLabel, { color: c.textTertiary }]}>Verification</Text>
          </View>
          <View style={[styles.stepLine, { backgroundColor: c.border }]} />
          <View style={styles.step}>
            <Text style={[styles.stepNumber, { backgroundColor: c.border, color: c.textTertiary }]}>3</Text>
            <Text style={[styles.stepLabel, { color: c.textTertiary }]}>KYC</Text>
          </View>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: c.textSecondary }]}>Email</Text>
            <View style={[styles.inputWrapper, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Ionicons name="mail-outline" size={18} color={c.textTertiary} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="email@example.com"
                placeholderTextColor={c.textTertiary}
                value={formData.email}
                onChangeText={(text) => setFormData({ ...formData, email: text })}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: c.textSecondary }]}>Pays</Text>
            <View style={[styles.pickerContainer, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Ionicons name="globe-outline" size={18} color={c.textTertiary} style={styles.inputIcon} />
              <Picker
                selectedValue={formData.country}
                onValueChange={(value) => setFormData({ ...formData, country: value })}
                style={[styles.picker, { color: c.text }]}
                dropdownIconColor="#D4AF37"
              >
                {countries.map((country) => (
                  <Picker.Item key={country.code} label={`${country.name} (${country.prefix})`} value={country.code} color={c.text} />
                ))}
              </Picker>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: c.textSecondary }]}>Telephone</Text>
            <View style={[styles.inputWrapper, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={[styles.phonePrefix, { borderRightColor: c.border }]}>
                <Text style={styles.phonePrefixText}>{selectedCountry?.prefix}</Text>
              </View>
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="70 00 00 00"
                placeholderTextColor={c.textTertiary}
                value={formData.phone}
                onChangeText={(text) => setFormData({ ...formData, phone: text })}
                keyboardType="phone-pad"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: c.textSecondary }]}>Mot de passe</Text>
            <View style={[styles.inputWrapper, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Ionicons name="lock-closed-outline" size={18} color={c.textTertiary} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="Min. 8 caracteres"
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
            {formData.password.length > 0 && (
              <View style={styles.strengthBar}>
                <View style={styles.strengthTrack}>
                  {[1, 2, 3].map(i => (
                    <View
                      key={i}
                      style={[
                        styles.strengthSegment,
                        { backgroundColor: i <= strength.level ? strength.color : '#374151' },
                      ]}
                    />
                  ))}
                </View>
                <Text style={[styles.strengthLabel, { color: strength.color }]}>{strength.label}</Text>
              </View>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: c.textSecondary }]}>Confirmer le mot de passe</Text>
            <View style={[styles.inputWrapper, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Ionicons name="lock-closed-outline" size={18} color={c.textTertiary} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                placeholder="Repetez le mot de passe"
                placeholderTextColor={c.textTertiary}
                value={formData.confirmPassword}
                onChangeText={(text) => setFormData({ ...formData, confirmPassword: text })}
                secureTextEntry={!showPassword}
              />
              {formData.confirmPassword.length > 0 && (
                <View style={styles.matchIcon}>
                  <Ionicons
                    name={formData.password === formData.confirmPassword ? 'checkmark-circle' : 'close-circle'}
                    size={20}
                    color={formData.password === formData.confirmPassword ? '#10B981' : '#EF4444'}
                  />
                </View>
              )}
            </View>
          </View>

          {errorMsg ? (
            <InlineMessage type="error" message={errorMsg} onDismiss={() => setErrorMsg('')} />
          ) : null}
          {successMsg ? (
            <InlineMessage type="success" message={successMsg} autoDismiss={0} />
          ) : null}

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleRegister}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#0F0F1A" />
            ) : (
              <>
                <Text style={styles.buttonText}>Creer mon compte</Text>
                <Ionicons name="arrow-forward" size={20} color="#0F0F1A" />
              </>
            )}
          </TouchableOpacity>

          <Link href="/(auth)/login" asChild>
            <TouchableOpacity style={styles.linkButton}>
              <Text style={[styles.linkText, { color: c.textSecondary }]}>
                Deja un compte ? <Text style={styles.linkBold}>Se connecter</Text>
              </Text>
            </TouchableOpacity>
          </Link>
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
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A2E',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 8,
    lineHeight: 20,
  },
  steps: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    gap: 8,
  },
  step: {
    alignItems: 'center',
    gap: 4,
  },
  stepActive: {},
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#374151',
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 28,
    fontSize: 13,
    fontWeight: '600',
    overflow: 'hidden',
  },
  stepNumberActive: {
    backgroundColor: '#D4AF37',
    color: '#0F0F1A',
  },
  stepLabel: {
    fontSize: 10,
    color: '#6B7280',
  },
  stepLabelActive: {
    color: '#D4AF37',
    fontWeight: '600',
  },
  stepLine: {
    width: 32,
    height: 1,
    backgroundColor: '#374151',
    marginBottom: 16,
  },
  form: {
    gap: 16,
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
  matchIcon: {
    paddingRight: 14,
  },
  phonePrefix: {
    paddingLeft: 14,
    paddingRight: 4,
    borderRightWidth: 1,
    borderRightColor: '#2D2D44',
    paddingVertical: 14,
  },
  phonePrefixText: {
    color: '#D4AF37',
    fontWeight: '600',
    fontSize: 14,
  },
  pickerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
    borderWidth: 1,
    borderColor: '#2D2D44',
    borderRadius: 12,
    overflow: 'hidden',
  },
  picker: {
    flex: 1,
    color: '#fff',
  },
  strengthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  strengthTrack: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  strengthSegment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
  },
  strengthLabel: {
    fontSize: 11,
    fontWeight: '600',
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
  linkButton: {
    alignItems: 'center',
    padding: 16,
  },
  linkText: {
    color: '#9CA3AF',
    fontSize: 14,
  },
  linkBold: {
    color: '#D4AF37',
    fontWeight: '600',
  },
});
