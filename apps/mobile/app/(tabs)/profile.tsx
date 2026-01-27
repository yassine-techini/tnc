import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/auth';
import ConfirmDialog from '../../components/ConfirmDialog';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

interface MenuItem {
  icon: IoniconsName;
  iconColor: string;
  iconBg: string;
  label: string;
  route: string;
}

const MENU_ITEMS: MenuItem[] = [
  { icon: 'shield-checkmark-outline', iconColor: '#D4AF37', iconBg: 'rgba(212, 175, 55, 0.12)', label: 'Securite', route: '/(security)' },
  { icon: 'notifications-outline', iconColor: '#3B82F6', iconBg: 'rgba(59, 130, 246, 0.12)', label: 'Notifications', route: '/(settings)/notifications' },
  { icon: 'settings-outline', iconColor: '#9CA3AF', iconBg: 'rgba(156, 163, 175, 0.12)', label: 'Parametres', route: '/(settings)' },
  { icon: 'information-circle-outline', iconColor: '#6366F1', iconBg: 'rgba(99, 102, 241, 0.12)', label: 'A propos', route: '/(settings)/about' },
];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuthStore();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    logout();
    router.replace('/(auth)/login');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingTop: insets.top + 16 }}>
      {/* Profile Header */}
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.email?.charAt(0).toUpperCase() || '?'}</Text>
          </View>
          <View style={[
            styles.kycDot,
            user?.kycLevel === 'VERIFIED' ? styles.dotSuccess :
            user?.kycLevel === 'STANDARD' ? styles.dotInfo : styles.dotWarning
          ]} />
        </View>
        <Text style={styles.email}>{user?.email}</Text>
        <Text style={styles.phone}>{user?.phone}</Text>
      </View>

      {/* Account Status */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Statut du compte</Text>

        <View style={styles.statusRow}>
          <View style={styles.statusLeft}>
            <Ionicons name="shield-checkmark" size={18} color="#D4AF37" />
            <Text style={styles.statusLabel}>Niveau KYC</Text>
          </View>
          <View style={[styles.badge,
            user?.kycLevel === 'VERIFIED' ? styles.badgeSuccess :
            user?.kycLevel === 'STANDARD' ? styles.badgeInfo : styles.badgeWarning
          ]}>
            <Text style={[styles.badgeText,
              user?.kycLevel === 'VERIFIED' ? { color: '#10B981' } :
              user?.kycLevel === 'STANDARD' ? { color: '#3B82F6' } : { color: '#F59E0B' }
            ]}>{user?.kycLevel || 'BASIC'}</Text>
          </View>
        </View>

        <View style={styles.statusRow}>
          <View style={styles.statusLeft}>
            <Ionicons name="mail" size={18} color="#3B82F6" />
            <Text style={styles.statusLabel}>Email verifie</Text>
          </View>
          <View style={[styles.badge, user?.emailVerified ? styles.badgeSuccess : styles.badgeWarning]}>
            <Text style={[styles.badgeText, { color: user?.emailVerified ? '#10B981' : '#F59E0B' }]}>
              {user?.emailVerified ? 'Oui' : 'Non'}
            </Text>
          </View>
        </View>

        <View style={[styles.statusRow, { borderBottomWidth: 0 }]}>
          <View style={styles.statusLeft}>
            <Ionicons name="lock-closed" size={18} color="#6366F1" />
            <Text style={styles.statusLabel}>2FA</Text>
          </View>
          <View style={[styles.badge, user?.twoFactorEnabled ? styles.badgeSuccess : styles.badgeWarning]}>
            <Text style={[styles.badgeText, { color: user?.twoFactorEnabled ? '#10B981' : '#F59E0B' }]}>
              {user?.twoFactorEnabled ? 'Actif' : 'Inactif'}
            </Text>
          </View>
        </View>
      </View>

      {/* KYC Limits */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Limites KYC</Text>
        {[
          { level: 'BASIC', desc: 'Consultation uniquement' },
          { level: 'STANDARD', desc: '100g/jour - 500,000 XOF retrait' },
          { level: 'VERIFIED', desc: '1000g/jour - 5,000,000 XOF retrait' },
        ].map((item, index) => (
          <View key={item.level} style={[styles.limitItem, index === 2 && { borderBottomWidth: 0 }]}>
            <View style={[
              styles.limitBadge,
              user?.kycLevel === item.level && styles.limitBadgeActive,
            ]}>
              {user?.kycLevel === item.level && (
                <Ionicons name="checkmark" size={10} color="#0F0F1A" style={{ marginRight: 2 }} />
              )}
              <Text style={[
                styles.limitBadgeText,
                user?.kycLevel === item.level && styles.limitBadgeTextActive,
              ]}>{item.level}</Text>
            </View>
            <Text style={styles.limitText}>{item.desc}</Text>
          </View>
        ))}
        {user?.kycLevel !== 'VERIFIED' && (
          <TouchableOpacity style={styles.kycButton} onPress={() => router.push('/(kyc)')} activeOpacity={0.8}>
            <Ionicons name="arrow-up-circle-outline" size={18} color="#0F0F1A" />
            <Text style={styles.kycButtonText}>Ameliorer mon KYC</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Menu */}
      <View style={styles.card}>
        {MENU_ITEMS.map((item, index) => (
          <TouchableOpacity
            key={item.route}
            style={[styles.menuItem, index === MENU_ITEMS.length - 1 && { borderBottomWidth: 0 }]}
            onPress={() => router.push(item.route as any)}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconBg, { backgroundColor: item.iconBg }]}>
              <Ionicons name={item.icon} size={18} color={item.iconColor} />
            </View>
            <Text style={styles.menuText}>{item.label}</Text>
            <Ionicons name="chevron-forward" size={18} color="#4B5563" />
          </TouchableOpacity>
        ))}
      </View>

      {/* Logout */}
      {showLogoutConfirm ? (
        <ConfirmDialog
          title="Deconnexion"
          message="Voulez-vous vraiment vous deconnecter ?"
          confirmText="Deconnecter"
          cancelText="Annuler"
          onConfirm={confirmLogout}
          onCancel={() => setShowLogoutConfirm(false)}
          destructive
        />
      ) : (
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={20} color="#EF4444" />
          <Text style={styles.logoutText}>Se deconnecter</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.version}>TNC Trading v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A', padding: 16 },
  header: { alignItems: 'center', marginBottom: 24 },
  avatarContainer: { position: 'relative', marginBottom: 14 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#D4AF37',
  },
  avatarText: { fontSize: 30, fontWeight: '800', color: '#D4AF37' },
  kycDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#0F0F1A',
  },
  dotSuccess: { backgroundColor: '#10B981' },
  dotInfo: { backgroundColor: '#3B82F6' },
  dotWarning: { backgroundColor: '#F59E0B' },
  email: { fontSize: 17, fontWeight: '600', color: '#fff' },
  phone: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  card: { backgroundColor: '#1A1A2E', borderRadius: 14, padding: 16, marginBottom: 14 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 14 },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusLabel: { fontSize: 14, color: '#D1D5DB' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  badgeSuccess: { backgroundColor: 'rgba(16, 185, 129, 0.12)' },
  badgeInfo: { backgroundColor: 'rgba(59, 130, 246, 0.12)' },
  badgeWarning: { backgroundColor: 'rgba(245, 158, 11, 0.12)' },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  limitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  limitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#374151',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 85,
    justifyContent: 'center',
  },
  limitBadgeActive: { backgroundColor: '#D4AF37' },
  limitBadgeText: { fontSize: 10, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.5 },
  limitBadgeTextActive: { color: '#0F0F1A' },
  limitText: { fontSize: 13, color: '#9CA3AF', flex: 1 },
  kycButton: {
    backgroundColor: '#D4AF37',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  kycButtonText: { color: '#0F0F1A', fontWeight: '600', fontSize: 14 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    gap: 12,
  },
  menuIconBg: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: { flex: 1, fontSize: 15, color: '#fff' },
  logoutButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 14,
  },
  logoutText: { color: '#EF4444', fontWeight: '600', fontSize: 15 },
  version: { textAlign: 'center', color: '#4B5563', fontSize: 12, marginBottom: 32 },
});
