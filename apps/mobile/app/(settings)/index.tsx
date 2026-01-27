import { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch, Linking } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';

const NOTIFICATIONS_KEY = 'tnc_notifications_enabled';
const PRICE_ALERTS_KEY = 'tnc_price_alerts_enabled';

export default function SettingsScreen() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [priceAlertsEnabled, setPriceAlertsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const notifications = await SecureStore.getItemAsync(NOTIFICATIONS_KEY);
      const priceAlerts = await SecureStore.getItemAsync(PRICE_ALERTS_KEY);
      setNotificationsEnabled(notifications === 'true');
      setPriceAlertsEnabled(priceAlerts === 'true');
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNotificationsToggle = async (value: boolean) => {
    setNotificationsEnabled(value);
    await SecureStore.setItemAsync(NOTIFICATIONS_KEY, value ? 'true' : 'false');
  };

  const handlePriceAlertsToggle = async (value: boolean) => {
    setPriceAlertsEnabled(value);
    await SecureStore.setItemAsync(PRICE_ALERTS_KEY, value ? 'true' : 'false');
  };

  const openURL = (url: string) => {
    Linking.openURL(url).catch((err) => console.error('Error opening URL:', err));
  };

  return (
    <ScrollView style={styles.container}>
      {/* Notifications Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>

        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <View style={styles.iconContainer}>
              <Text style={styles.icon}>🔔</Text>
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>Notifications push</Text>
              <Text style={styles.settingDescription}>
                Recevez des notifications pour les transactions et mises à jour
              </Text>
            </View>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={handleNotificationsToggle}
            trackColor={{ false: '#374151', true: 'rgba(212, 175, 55, 0.5)' }}
            thumbColor={notificationsEnabled ? '#D4AF37' : '#9CA3AF'}
            disabled={isLoading}
          />
        </View>

        <View style={styles.settingItem}>
          <View style={styles.settingInfo}>
            <View style={styles.iconContainer}>
              <Text style={styles.icon}>📊</Text>
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>Alertes de prix</Text>
              <Text style={styles.settingDescription}>
                Soyez alerté quand le prix de l'or atteint vos objectifs
              </Text>
            </View>
          </View>
          <Switch
            value={priceAlertsEnabled}
            onValueChange={handlePriceAlertsToggle}
            trackColor={{ false: '#374151', true: 'rgba(212, 175, 55, 0.5)' }}
            thumbColor={priceAlertsEnabled ? '#D4AF37' : '#9CA3AF'}
            disabled={isLoading}
          />
        </View>

        {priceAlertsEnabled && (
          <TouchableOpacity
            style={styles.subMenuItem}
            onPress={() => router.push('/(settings)/price-alerts')}
          >
            <Text style={styles.subMenuText}>Configurer les alertes</Text>
            <Text style={styles.arrow}>→</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Legal Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Légal</Text>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => openURL('https://tnc-trading.com/terms')}
        >
          <View style={styles.settingInfo}>
            <View style={styles.iconContainer}>
              <Text style={styles.icon}>📄</Text>
            </View>
            <Text style={styles.menuText}>Conditions d'utilisation</Text>
          </View>
          <Text style={styles.arrow}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => openURL('https://tnc-trading.com/privacy')}
        >
          <View style={styles.settingInfo}>
            <View style={styles.iconContainer}>
              <Text style={styles.icon}>🔒</Text>
            </View>
            <Text style={styles.menuText}>Politique de confidentialité</Text>
          </View>
          <Text style={styles.arrow}>→</Text>
        </TouchableOpacity>
      </View>

      {/* Support Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Support</Text>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => openURL('https://tnc-trading.com/help')}
        >
          <View style={styles.settingInfo}>
            <View style={styles.iconContainer}>
              <Text style={styles.icon}>❓</Text>
            </View>
            <Text style={styles.menuText}>Centre d'aide</Text>
          </View>
          <Text style={styles.arrow}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => openURL('mailto:support@tnc-trading.com')}
        >
          <View style={styles.settingInfo}>
            <View style={styles.iconContainer}>
              <Text style={styles.icon}>✉️</Text>
            </View>
            <Text style={styles.menuText}>Contacter le support</Text>
          </View>
          <Text style={styles.arrow}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => openURL('tel:+22670000000')}
        >
          <View style={styles.settingInfo}>
            <View style={styles.iconContainer}>
              <Text style={styles.icon}>📞</Text>
            </View>
            <Text style={styles.menuText}>Appeler le support</Text>
          </View>
          <Text style={styles.arrow}>→</Text>
        </TouchableOpacity>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>À propos</Text>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={() => router.push('/(settings)/about')}
        >
          <View style={styles.settingInfo}>
            <View style={styles.iconContainer}>
              <Text style={styles.icon}>ℹ️</Text>
            </View>
            <Text style={styles.menuText}>À propos de TNC Trading</Text>
          </View>
          <Text style={styles.arrow}>→</Text>
        </TouchableOpacity>

        <View style={styles.versionItem}>
          <Text style={styles.versionLabel}>Version</Text>
          <Text style={styles.versionValue}>
            {Application.nativeApplicationVersion || '1.0.0'} ({Application.nativeBuildVersion || '1'})
          </Text>
        </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  icon: {
    fontSize: 20,
  },
  settingContent: {
    flex: 1,
    marginRight: 12,
  },
  settingTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  settingDescription: {
    color: '#9CA3AF',
    fontSize: 13,
  },
  subMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    borderRadius: 8,
    padding: 12,
    marginLeft: 52,
    marginTop: 4,
  },
  subMenuText: {
    color: '#D4AF37',
    fontSize: 14,
    fontWeight: '500',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  menuText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  arrow: {
    color: '#9CA3AF',
    fontSize: 18,
  },
  versionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
  },
  versionLabel: {
    color: '#9CA3AF',
    fontSize: 14,
  },
  versionValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  bottomPadding: {
    height: 32,
  },
});
