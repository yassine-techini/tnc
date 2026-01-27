import { Tabs } from 'expo-router';
import { View, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  index: { active: 'home', inactive: 'home-outline' },
  market: { active: 'trending-up', inactive: 'trending-up-outline' },
  wallet: { active: 'wallet', inactive: 'wallet-outline' },
  profile: { active: 'person', inactive: 'person-outline' },
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons = TAB_ICONS[name] || { active: 'ellipse', inactive: 'ellipse-outline' };
  const iconName = focused ? icons.active : icons.inactive;
  const color = focused ? '#D4AF37' : '#6B7280';

  return (
    <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
      <Ionicons name={iconName} size={22} color={color} />
      {focused && <View style={styles.activeDot} />}
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#D4AF37',
        tabBarInactiveTintColor: '#6B7280',
        tabBarStyle: {
          backgroundColor: '#1A1A2E',
          borderTopColor: 'rgba(55, 65, 81, 0.5)',
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 28 : 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
        },
        headerStyle: {
          backgroundColor: '#1A1A2E',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: '600',
          fontSize: 18,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon name="index" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="market"
        options={{
          title: 'Marche',
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon name="market" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: 'Portefeuille',
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon name="wallet" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon name="profile" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 28,
  },
  iconContainerActive: {
    // subtle highlight for active tab
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D4AF37',
    marginTop: 2,
  },
});
