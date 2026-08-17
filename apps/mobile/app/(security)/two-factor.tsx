import { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/auth';
import api from '../../lib/api';
import InlineMessage from '../../components/InlineMessage';
import ConfirmDialog from '../../components/ConfirmDialog';
import { preventScreenCapture, allowScreenCapture } from '../../hooks/useSecurityCheck';

const BACKUP_CODES_KEY = 'tnc_2fa_backup_codes';

export default function TwoFactorScreen() {
  const queryClient = useQueryClient();
  const { user, tokens, setUser } = useAuthStore();
  const [step, setStep] = useState<'intro' | 'setup' | 'verify' | 'backup' | 'disable'>('intro');
  const [verificationCode, setVerificationCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disableCode, setDisableCode] = useState('');
  const [message, setMessage] = useState<{ type: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [showBackupConfirm, setShowBackupConfirm] = useState(false);

  const is2FAEnabled = user?.twoFactorEnabled;

  // Prevent screen capture on this sensitive screen
  useEffect(() => {
    preventScreenCapture();
    return () => { allowScreenCapture(); };
  }, []);

  // Setup 2FA mutation
  const setupMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return api.setup2FA(tokens.accessToken);
    },
    onSuccess: () => {
      setStep('setup');
    },
    onError: (error: Error) => {
      setMessage({ type: 'error', text: error.message || 'Impossible de configurer le 2FA' });
    },
  });

  // Verify 2FA mutation
  const verifyMutation = useMutation({
    mutationFn: async (code: string) => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return api.verify2FA(code, tokens.accessToken);
    },
    onSuccess: async (data) => {
      setBackupCodes(data.data.backupCodes);
      await SecureStore.setItemAsync(BACKUP_CODES_KEY, JSON.stringify(data.data.backupCodes));
      setStep('backup');
      if (user) {
        setUser({ ...user, twoFactorEnabled: true });
      }
      queryClient.invalidateQueries({ queryKey: ['user-profile'] });
    },
    onError: (error: Error) => {
      setMessage({ type: 'error', text: error.message || 'Code invalide' });
    },
  });

  // Disable 2FA mutation
  const disableMutation = useMutation({
    mutationFn: async (code: string) => {
      if (!tokens?.accessToken) throw new Error('Non authentifié');
      return api.disable2FA(code, tokens.accessToken);
    },
    onSuccess: async () => {
      await SecureStore.deleteItemAsync(BACKUP_CODES_KEY);
      if (user) {
        setUser({ ...user, twoFactorEnabled: false });
      }
      queryClient.invalidateQueries({ queryKey: ['user-profile'] });
      setMessage({ type: 'success', text: '2FA désactivé avec succès' });
      setTimeout(() => router.back(), 2000);
    },
    onError: (error: Error) => {
      setMessage({ type: 'error', text: error.message || 'Code invalide' });
    },
  });

  const setupData = setupMutation.data?.data;

  const handleSetup = () => {
    setupMutation.mutate();
  };

  const handleVerify = () => {
    if (verificationCode.length !== 6) {
      setMessage({ type: 'error', text: 'Veuillez entrer un code à 6 chiffres' });
      return;
    }
    setMessage(null);
    verifyMutation.mutate(verificationCode);
  };

  const handleDisable = () => {
    if (disableCode.length !== 6) {
      setMessage({ type: 'error', text: 'Veuillez entrer un code à 6 chiffres' });
      return;
    }
    setMessage(null);
    disableMutation.mutate(disableCode);
  };

  const handleFinish = () => {
    setShowBackupConfirm(true);
  };

  // Intro screen (2FA not enabled)
  if (!is2FAEnabled && step === 'intro') {
    return (
      <ScrollView style={styles.container}>
        <View style={styles.introCard}>
          <Ionicons name="shield-checkmark" size={48} color="#D4AF37" />
          <Text style={styles.introTitle}>Protection renforcée</Text>
          <Text style={styles.introText}>
            L'authentification à deux facteurs ajoute une couche de sécurité supplémentaire à votre compte.
          </Text>
        </View>

        <View style={styles.stepsCard}>
          <Text style={styles.stepsTitle}>Comment ça marche ?</Text>
          <View style={styles.stepItem}>
            <View style={styles.stepNumber}><Text style={styles.stepNumberText}>1</Text></View>
            <Text style={styles.stepText}>Installez une application d'authentification (Google Authenticator, Authy)</Text>
          </View>
          <View style={styles.stepItem}>
            <View style={styles.stepNumber}><Text style={styles.stepNumberText}>2</Text></View>
            <Text style={styles.stepText}>Ajoutez le compte via le lien, ou saisissez la clé</Text>
          </View>
          <View style={styles.stepItem}>
            <View style={styles.stepNumber}><Text style={styles.stepNumberText}>3</Text></View>
            <Text style={styles.stepText}>Entrez le code généré pour confirmer</Text>
          </View>
        </View>

        {message && (
          <InlineMessage type={message.type} message={message.text} onDismiss={() => setMessage(null)} />
        )}

        <TouchableOpacity
          style={[styles.button, setupMutation.isPending && styles.buttonDisabled]}
          onPress={handleSetup}
          disabled={setupMutation.isPending}
        >
          {setupMutation.isPending ? (
            <ActivityIndicator size="small" color="#0F0F1A" />
          ) : (
            <Text style={styles.buttonText}>Activer le 2FA</Text>
          )}
        </TouchableOpacity>

        <View style={styles.bottomPadding} />
      </ScrollView>
    );
  }

  // Setup screen : lien otpauth:// ou saisie manuelle de la clé
  if (step === 'setup' && setupData) {
    return (
      <ScrollView style={styles.container}>
        <Text style={styles.title}>Activez la double authentification</Text>
        <Text style={styles.subtitle}>
          Ajoutez ce compte à votre application d'authentification
        </Text>

        {/* Pas d'image de QR : la faire générer par un service externe
            enverrait la graine TOTP à un tiers. Sur téléphone, le lien
            otpauth:// fait mieux qu'un QR — il ouvre directement
            l'application d'authentification, sans passer par l'appareil photo. */}
        {setupData.uri ? (
          <TouchableOpacity
            style={styles.button}
            onPress={() => Linking.openURL(setupData.uri)}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>Ouvrir dans mon application</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.secretBox}>
          <Text style={styles.secretLabel}>Ou entrez ce code manuellement:</Text>
          <Text style={styles.secretCode}>{setupData.secret}</Text>
        </View>

        <TouchableOpacity style={styles.button} onPress={() => setStep('verify')}>
          <Text style={styles.buttonText}>J'ai ajouté le compte</Text>
        </TouchableOpacity>

        <View style={styles.bottomPadding} />
      </ScrollView>
    );
  }

  // Verify screen
  if (step === 'verify') {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Vérification</Text>
        <Text style={styles.subtitle}>
          Entrez le code à 6 chiffres genere par votre application
        </Text>

        <View style={styles.codeInputContainer}>
          <TextInput
            style={styles.codeInput}
            placeholder="000000"
            placeholderTextColor="#6B7280"
            value={verificationCode}
            onChangeText={(text) => setVerificationCode(text.replace(/[^0-9]/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />
        </View>

        {message && (
          <InlineMessage type={message.type} message={message.text} onDismiss={() => setMessage(null)} />
        )}

        <TouchableOpacity
          style={[styles.button, verifyMutation.isPending && styles.buttonDisabled]}
          onPress={handleVerify}
          disabled={verifyMutation.isPending}
        >
          {verifyMutation.isPending ? (
            <ActivityIndicator size="small" color="#0F0F1A" />
          ) : (
            <Text style={styles.buttonText}>Vérifier</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.backLink} onPress={() => setStep('setup')}>
          <Text style={styles.backLinkText}>← Retour à la clé</Text>
        </TouchableOpacity>

        <View style={styles.bottomPadding} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Backup codes screen
  if (step === 'backup') {
    return (
      <ScrollView style={styles.container}>
        <View style={styles.successBanner}>
          <Ionicons name="checkmark-circle" size={28} color="#10B981" />
          <Text style={styles.successText}>2FA activé avec succès !</Text>
        </View>

        <Text style={styles.title}>Codes de secours</Text>
        <Text style={styles.subtitle}>
          Sauvegardez ces codes dans un endroit sûr. Ils vous permettront d'accéder à votre compte si vous perdez accès à votre application d'authentification.
        </Text>

        <View style={styles.codesContainer}>
          {backupCodes.map((code, index) => (
            <View key={index} style={styles.codeItem}>
              <Text style={styles.codeText}>{code}</Text>
            </View>
          ))}
        </View>

        <View style={styles.warningBox}>
          <Ionicons name="warning" size={20} color="#EAB308" />
          <Text style={styles.warningText}>
            Chaque code ne peut être utilisé qu'une seule fois. Conservez-les précieusement !
          </Text>
        </View>

        {showBackupConfirm ? (
          <ConfirmDialog
            title="Codes de secours"
            message="Avez-vous bien sauvegardé vos codes de secours dans un endroit sûr ?"
            confirmText="Oui, j'ai sauvegardé"
            cancelText="Non, pas encore"
            onConfirm={() => router.back()}
            onCancel={() => setShowBackupConfirm(false)}
          />
        ) : (
          <TouchableOpacity style={styles.button} onPress={handleFinish}>
            <Text style={styles.buttonText}>J'ai sauvegardé mes codes</Text>
          </TouchableOpacity>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>
    );
  }

  // 2FA enabled - show disable option
  if (is2FAEnabled && step === 'intro') {
    return (
      <ScrollView style={styles.container}>
        <View style={styles.enabledCard}>
          <View style={styles.enabledIcon}>
            <Ionicons name="checkmark-circle" size={48} color="#fff" />
          </View>
          <Text style={styles.enabledTitle}>2FA Active</Text>
          <Text style={styles.enabledText}>
            Votre compte est protégé par l'authentification à deux facteurs
          </Text>
        </View>

        <TouchableOpacity
          style={styles.disableButton}
          onPress={() => setStep('disable')}
        >
          <Text style={styles.disableButtonText}>Désactiver le 2FA</Text>
        </TouchableOpacity>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={20} color="#3B82F6" />
          <Text style={styles.infoText}>
            Il est fortement recommandé de garder le 2FA activé pour protéger votre compte et vos investissements.
          </Text>
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>
    );
  }

  // Disable 2FA screen
  if (step === 'disable') {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.warningCard}>
          <Ionicons name="warning" size={28} color="#EF4444" />
          <Text style={styles.warningTitle}>Désactiver le 2FA</Text>
          <Text style={styles.warningDescription}>
            Cette action réduira la sécurité de votre compte. Êtes-vous sûr de vouloir continuer ?
          </Text>
        </View>

        <Text style={styles.label}>Entrez votre code 2FA actuel</Text>
        <View style={styles.codeInputContainer}>
          <TextInput
            style={styles.codeInput}
            placeholder="000000"
            placeholderTextColor="#6B7280"
            value={disableCode}
            onChangeText={(text) => setDisableCode(text.replace(/[^0-9]/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
          />
        </View>

        {message && (
          <InlineMessage type={message.type} message={message.text} onDismiss={() => setMessage(null)} />
        )}

        <View style={styles.actions}>
          <TouchableOpacity style={styles.cancelButton} onPress={() => setStep('intro')}>
            <Text style={styles.cancelButtonText}>Annuler</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dangerButton, disableMutation.isPending && styles.buttonDisabled]}
            onPress={handleDisable}
            disabled={disableMutation.isPending}
          >
            {disableMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.dangerButtonText}>Désactiver</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.bottomPadding} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A', padding: 16 },

  title: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#9CA3AF', marginBottom: 24, lineHeight: 20 },
  label: { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 8 },

  introCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  introTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  introText: { color: '#9CA3AF', fontSize: 14, textAlign: 'center', lineHeight: 20 },

  stepsCard: { backgroundColor: '#1A1A2E', borderRadius: 16, padding: 20, marginBottom: 24 },
  stepsTitle: { color: '#D4AF37', fontSize: 16, fontWeight: '600', marginBottom: 16 },
  stepItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(212, 175, 55, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stepNumberText: { color: '#D4AF37', fontWeight: '700' },
  stepText: { color: '#9CA3AF', fontSize: 14, flex: 1, lineHeight: 20 },

  qrContainer: { alignItems: 'center', marginVertical: 24 },
  qrCode: { width: 200, height: 200, borderRadius: 12 },
  qrPlaceholder: {
    width: 200,
    height: 200,
    backgroundColor: '#fff',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrPlaceholderText: { color: '#0F0F1A', fontSize: 16 },

  secretBox: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  secretLabel: { color: '#9CA3AF', fontSize: 12, marginBottom: 8 },
  secretCode: { color: '#D4AF37', fontSize: 16, fontWeight: '700', letterSpacing: 2 },

  codeInputContainer: { marginBottom: 24 },
  codeInput: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 20,
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 8,
  },

  button: {
    backgroundColor: '#D4AF37',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#0F0F1A', fontWeight: '700', fontSize: 16 },

  backLink: { alignItems: 'center', marginTop: 16 },
  backLinkText: { color: '#D4AF37', fontSize: 14 },

  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    gap: 12,
  },
  successText: { color: '#10B981', fontWeight: '600', fontSize: 16 },

  codesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
  },
  codeItem: {
    backgroundColor: '#1A1A2E',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    width: '48%',
  },
  codeText: { color: '#fff', fontFamily: 'monospace', fontSize: 14, textAlign: 'center' },

  warningBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    gap: 12,
  },
  warningText: { color: '#EAB308', fontSize: 13, flex: 1 },

  enabledCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  enabledIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  enabledTitle: { color: '#10B981', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  enabledText: { color: '#6EE7B7', fontSize: 14, textAlign: 'center' },

  disableButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  disableButtonText: { color: '#EF4444', fontWeight: '600', fontSize: 16 },

  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  infoText: { color: '#93C5FD', fontSize: 13, flex: 1 },

  warningCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  warningTitle: { color: '#EF4444', fontSize: 20, fontWeight: '700', marginVertical: 12 },
  warningDescription: { color: '#FCA5A5', fontSize: 14, textAlign: 'center' },

  actions: { flexDirection: 'row', gap: 12 },
  cancelButton: {
    flex: 1,
    backgroundColor: '#374151',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  cancelButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  dangerButton: {
    flex: 1,
    backgroundColor: '#EF4444',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  dangerButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  bottomPadding: { height: 32 },
});
