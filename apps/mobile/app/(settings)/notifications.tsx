import { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import InlineMessage from '../../components/InlineMessage';

const NOTIFICATIONS_STORAGE_KEY = 'tnc_notification_settings';

interface NotificationSettings {
  transactions: boolean;
  priceAlerts: boolean;
  news: boolean;
  security: boolean;
  marketing: boolean;
}

const defaultSettings: NotificationSettings = {
  transactions: true,
  priceAlerts: true,
  news: true,
  security: true,
  marketing: false,
};

export default function NotificationsScreen() {
  const [settings, setSettings] = useState<NotificationSettings>(defaultSettings);
  const [permissionStatus, setPermissionStatus] = useState<string>('unknown');
  const [isLoading, setIsLoading] = useState(true);
  const [permissionMsg, setPermissionMsg] = useState('');

  useEffect(() => {
    loadSettings();
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    const { status } = await Notifications.getPermissionsAsync();
    setPermissionStatus(status);
  };

  const requestPermissions = async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    setPermissionStatus(status);
    if (status !== 'granted') {
      setPermissionMsg('Pour recevoir des notifications, veuillez les activer dans les parametres de votre telephone.');
    }
  };

  const loadSettings = async () => {
    try {
      const stored = await SecureStore.getItemAsync(NOTIFICATIONS_STORAGE_KEY);
      if (stored) {
        setSettings(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error loading notification settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async (newSettings: NotificationSettings) => {
    try {
      await SecureStore.setItemAsync(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(newSettings));
      setSettings(newSettings);
    } catch (error) {
      console.error('Error saving notification settings:', error);
    }
  };

  const handleToggle = async (key: keyof NotificationSettings, value: boolean) => {
    if (value && permissionStatus !== 'granted') {
      await requestPermissions();
      if (permissionStatus !== 'granted') return;
    }
    const newSettings = { ...settings, [key]: value };
    saveSettings(newSettings);
  };

  return (
    <ScrollView style={styles.container}>
      {/* Permission Status */}
      {permissionStatus !== 'granted' && (
        <View style={styles.warningCard}>
          <Text style={styles.warningIcon}>⚠️</Text>
          <View style={styles.warningContent}>
            <Text style={styles.warningTitle}>Notifications désactivées</Text>
            <Text style={styles.warningText}>
              Activez les notifications pour recevoir des alertes importantes.
            </Text>
          </View>
        </View>
      )}

      {permissionMsg ? (
        <InlineMessage type="info" message={permissionMsg} onDismiss={() => setPermissionMsg('')} />
      ) : null}

      {/* Transaction Notifications */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Transactions</Text>
        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>Achats et ventes</Text>
            <Text style={styles.settingDescription}>
              Confirmation de vos achats et ventes d'or
            </Text>
          </View>
          <Switch
            value={settings.transactions}
            onValueChange={(value) => handleToggle('transactions', value)}
            trackColor={{ false: '#374151', true: 'rgba(212, 175, 55, 0.5)' }}
            thumbColor={settings.transactions ? '#D4AF37' : '#9CA3AF'}
            disabled={isLoading}
          />
        </View>
      </View>

      {/* Price Alerts */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Prix de l'or</Text>
        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>Alertes de prix</Text>
            <Text style={styles.settingDescription}>
              Notifications quand le prix atteint vos objectifs
            </Text>
          </View>
          <Switch
            value={settings.priceAlerts}
            onValueChange={(value) => handleToggle('priceAlerts', value)}
            trackColor={{ false: '#374151', true: 'rgba(212, 175, 55, 0.5)' }}
            thumbColor={settings.priceAlerts ? '#D4AF37' : '#9CA3AF'}
            disabled={isLoading}
          />
        </View>
      </View>

      {/* Security Notifications */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sécurité</Text>
        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>Alertes de sécurité</Text>
            <Text style={styles.settingDescription}>
              Connexions suspectes et changements de mot de passe
            </Text>
          </View>
          <Switch
            value={settings.security}
            onValueChange={(value) => handleToggle('security', value)}
            trackColor={{ false: '#374151', true: 'rgba(212, 175, 55, 0.5)' }}
            thumbColor={settings.security ? '#D4AF37' : '#9CA3AF'}
            disabled={isLoading}
          />
        </View>
      </View>

      {/* News & Updates */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Actualités</Text>
        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>Nouvelles et mises à jour</Text>
            <Text style={styles.settingDescription}>
              Informations sur les nouvelles fonctionnalités et actualités
            </Text>
          </View>
          <Switch
            value={settings.news}
            onValueChange={(value) => handleToggle('news', value)}
            trackColor={{ false: '#374151', true: 'rgba(212, 175, 55, 0.5)' }}
            thumbColor={settings.news ? '#D4AF37' : '#9CA3AF'}
            disabled={isLoading}
          />
        </View>
        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingTitle}>Offres promotionnelles</Text>
            <Text style={styles.settingDescription}>
              Promotions et offres spéciales
            </Text>
          </View>
          <Switch
            value={settings.marketing}
            onValueChange={(value) => handleToggle('marketing', value)}
            trackColor={{ false: '#374151', true: 'rgba(212, 175, 55, 0.5)' }}
            thumbColor={settings.marketing ? '#D4AF37' : '#9CA3AF'}
            disabled={isLoading}
          />
        </View>
      </View>

      {/* Info */}
      <View style={styles.infoBox}>
        <Text style={styles.infoIcon}>ℹ️</Text>
        <Text style={styles.infoText}>
          Nous vous recommandons de garder les notifications de sécurité activées pour
          protéger votre compte.
        </Text>
      </View>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1A',
    padding: 16,
  },
  warningCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    gap: 12,
  },
  warningIcon: {
    fontSize: 24,
  },
  warningContent: {
    flex: 1,
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#EAB308',
    marginBottom: 4,
  },
  warningText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  settingInfo: {
    flex: 1,
    marginRight: 12,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  infoIcon: {
    fontSize: 20,
  },
  infoText: {
    color: '#93C5FD',
    fontSize: 13,
    flex: 1,
    lineHeight: 20,
  },
  bottomPadding: {
    height: 32,
  },
});
