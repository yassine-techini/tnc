import { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch, Linking } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore, useThemeColors, type ThemeMode } from '../../stores/theme';

const NOTIFICATIONS_KEY = 'tnc_notifications_enabled';
const PRICE_ALERTS_KEY = 'tnc_price_alerts_enabled';

const themeOptions: { value: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'light', label: 'Clair', icon: 'sunny' },
  { value: 'dark', label: 'Sombre', icon: 'moon' },
  { value: 'system', label: 'Système', icon: 'phone-portrait-outline' },
];

export default function SettingsScreen() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [priceAlertsEnabled, setPriceAlertsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { mode, setMode } = useThemeStore();
  const c = useThemeColors();

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
    <ScrollView style={[styles.container, { backgroundColor: c.background }]}>
      {/* Appearance Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Apparence</Text>

        <View style={[styles.settingItem, { backgroundColor: c.surface }]}>
          <View style={styles.settingInfo}>
            <View style={[styles.iconContainer, { backgroundColor: c.gold + '1A' }]}>
              <Ionicons name="color-palette" size={20} color={c.gold} />
            </View>
            <View style={styles.settingContent}>
              <Text style={[styles.settingTitle, { color: c.text }]}>Thème</Text>
              <Text style={[styles.settingDescription, { color: c.textSecondary }]}>
                Choisissez l'apparence de l'application
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.themeSelector, { backgroundColor: c.surface }]}>
          {themeOptions.map((option) => {
            const isActive = mode === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.themeOption,
                  { borderColor: isActive ? c.gold : c.border },
                  isActive && { backgroundColor: c.gold + '1A' },
                ]}
                onPress={() => setMode(option.value)}
              >
                <Ionicons
                  name={option.icon}
                  size={22}
                  color={isActive ? c.gold : c.textSecondary}
                />
                <Text style={[
                  styles.themeOptionLabel,
                  { color: isActive ? c.gold : c.textSecondary },
                  isActive && { fontWeight: '700' },
                ]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Notifications Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Notifications</Text>

        <View style={[styles.settingItem, { backgroundColor: c.surface }]}>
          <View style={styles.settingInfo}>
            <View style={[styles.iconContainer, { backgroundColor: c.gold + '1A' }]}>
              <Text style={styles.icon}>🔔</Text>
            </View>
            <View style={styles.settingContent}>
              <Text style={[styles.settingTitle, { color: c.text }]}>Notifications push</Text>
              <Text style={[styles.settingDescription, { color: c.textSecondary }]}>
                Recevez des notifications pour les transactions et mises à jour
              </Text>
            </View>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={handleNotificationsToggle}
            trackColor={{ false: c.border, true: c.gold + '80' }}
            thumbColor={notificationsEnabled ? c.gold : c.textSecondary}
            disabled={isLoading}
          />
        </View>

        <View style={[styles.settingItem, { backgroundColor: c.surface }]}>
          <View style={styles.settingInfo}>
            <View style={[styles.iconContainer, { backgroundColor: c.gold + '1A' }]}>
              <Text style={styles.icon}>📊</Text>
            </View>
            <View style={styles.settingContent}>
              <Text style={[styles.settingTitle, { color: c.text }]}>Alertes de prix</Text>
              <Text style={[styles.settingDescription, { color: c.textSecondary }]}>
                Soyez alerté quand le prix de l'or atteint vos objectifs
              </Text>
            </View>
          </View>
          <Switch
            value={priceAlertsEnabled}
            onValueChange={handlePriceAlertsToggle}
            trackColor={{ false: c.border, true: c.gold + '80' }}
            thumbColor={priceAlertsEnabled ? c.gold : c.textSecondary}
            disabled={isLoading}
          />
        </View>

        {priceAlertsEnabled && (
          <TouchableOpacity
            style={[styles.subMenuItem, { backgroundColor: c.gold + '1A' }]}
            onPress={() => router.push('/(settings)/price-alerts')}
          >
            <Text style={[styles.subMenuText, { color: c.gold }]}>Configurer les alertes</Text>
            <Ionicons name="chevron-forward" size={16} color={c.gold} />
          </TouchableOpacity>
        )}
      </View>

      {/* Legal Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Légal</Text>

        <TouchableOpacity
          style={[styles.menuItem, { backgroundColor: c.surface }]}
          onPress={() => openURL('https://tnc-trading.com/terms')}
        >
          <View style={styles.settingInfo}>
            <View style={[styles.iconContainer, { backgroundColor: c.gold + '1A' }]}>
              <Text style={styles.icon}>📄</Text>
            </View>
            <Text style={[styles.menuText, { color: c.text }]}>Conditions d'utilisation</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.menuItem, { backgroundColor: c.surface }]}
          onPress={() => openURL('https://tnc-trading.com/privacy')}
        >
          <View style={styles.settingInfo}>
            <View style={[styles.iconContainer, { backgroundColor: c.gold + '1A' }]}>
              <Text style={styles.icon}>🔒</Text>
            </View>
            <Text style={[styles.menuText, { color: c.text }]}>Politique de confidentialité</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Support Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Support</Text>

        <TouchableOpacity
          style={[styles.menuItem, { backgroundColor: c.surface }]}
          onPress={() => openURL('https://tnc-trading.com/help')}
        >
          <View style={styles.settingInfo}>
            <View style={[styles.iconContainer, { backgroundColor: c.gold + '1A' }]}>
              <Text style={styles.icon}>❓</Text>
            </View>
            <Text style={[styles.menuText, { color: c.text }]}>Centre d'aide</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.menuItem, { backgroundColor: c.surface }]}
          onPress={() => openURL('mailto:support@tnc-trading.com')}
        >
          <View style={styles.settingInfo}>
            <View style={[styles.iconContainer, { backgroundColor: c.gold + '1A' }]}>
              <Text style={styles.icon}>✉️</Text>
            </View>
            <Text style={[styles.menuText, { color: c.text }]}>Contacter le support</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.menuItem, { backgroundColor: c.surface }]}
          onPress={() => openURL('tel:+22670000000')}
        >
          <View style={styles.settingInfo}>
            <View style={[styles.iconContainer, { backgroundColor: c.gold + '1A' }]}>
              <Text style={styles.icon}>📞</Text>
            </View>
            <Text style={[styles.menuText, { color: c.text }]}>Appeler le support</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>À propos</Text>

        <TouchableOpacity
          style={[styles.menuItem, { backgroundColor: c.surface }]}
          onPress={() => router.push('/(settings)/about')}
        >
          <View style={styles.settingInfo}>
            <View style={[styles.iconContainer, { backgroundColor: c.gold + '1A' }]}>
              <Text style={styles.icon}>ℹ️</Text>
            </View>
            <Text style={[styles.menuText, { color: c.text }]}>À propos de TNC Trading</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.textSecondary} />
        </TouchableOpacity>

        <View style={[styles.versionItem, { backgroundColor: c.surface }]}>
          <Text style={[styles.versionLabel, { color: c.textSecondary }]}>Version</Text>
          <Text style={[styles.versionValue, { color: c.text }]}>
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
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
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
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 13,
  },
  themeSelector: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  themeOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 2,
    gap: 6,
  },
  themeOptionLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  subMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 8,
    padding: 12,
    marginLeft: 52,
    marginTop: 4,
  },
  subMenuText: {
    fontSize: 14,
    fontWeight: '500',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  menuText: {
    fontSize: 16,
    fontWeight: '500',
  },
  versionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    padding: 16,
  },
  versionLabel: {
    fontSize: 14,
  },
  versionValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  bottomPadding: {
    height: 32,
  },
});
