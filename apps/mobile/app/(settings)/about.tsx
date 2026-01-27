import { View, Text, ScrollView, StyleSheet, Image, Linking, TouchableOpacity } from 'react-native';
import * as Application from 'expo-application';

export default function AboutScreen() {
  const openURL = (url: string) => {
    Linking.openURL(url).catch((err) => console.error('Error opening URL:', err));
  };

  return (
    <ScrollView style={styles.container}>
      {/* Logo & App Info */}
      <View style={styles.header}>
        <View style={styles.logoContainer}>
          <Text style={styles.logo}>🪙</Text>
        </View>
        <Text style={styles.appName}>TNC Trading</Text>
        <Text style={styles.tagline}>L'or du Burkina, à portée de main</Text>
        <Text style={styles.version}>
          Version {Application.nativeApplicationVersion || '1.0.0'}
        </Text>
      </View>

      {/* Description */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Notre Mission</Text>
        <Text style={styles.cardText}>
          TNC Trading est une plateforme de tokenisation d'or souveraine pour le Burkina Faso.
          Nous permettons aux citoyens d'investir dans l'or national de manière simple, sécurisée
          et transparente.
        </Text>
        <Text style={styles.cardText}>
          Chaque token représente 1 gramme d'or physique stocké par l'État partenaire.
          Aucune spéculation, aucun effet de levier — juste de l'or véritable.
        </Text>
      </View>

      {/* Key Features */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Caractéristiques</Text>
        <View style={styles.featureItem}>
          <Text style={styles.featureIcon}>🔐</Text>
          <View style={styles.featureContent}>
            <Text style={styles.featureTitle}>Sécurisé</Text>
            <Text style={styles.featureText}>Authentification 2FA et biométrie</Text>
          </View>
        </View>
        <View style={styles.featureItem}>
          <Text style={styles.featureIcon}>✓</Text>
          <View style={styles.featureContent}>
            <Text style={styles.featureTitle}>Vérifié</Text>
            <Text style={styles.featureText}>KYC conforme aux normes UEMOA</Text>
          </View>
        </View>
        <View style={styles.featureItem}>
          <Text style={styles.featureIcon}>⚡</Text>
          <View style={styles.featureContent}>
            <Text style={styles.featureTitle}>Rapide</Text>
            <Text style={styles.featureText}>Transactions instantanées via Mobile Money</Text>
          </View>
        </View>
        <View style={styles.featureItem}>
          <Text style={styles.featureIcon}>📊</Text>
          <View style={styles.featureContent}>
            <Text style={styles.featureTitle}>Transparent</Text>
            <Text style={styles.featureText}>Prix basé sur le cours LBMA</Text>
          </View>
        </View>
      </View>

      {/* Links */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Liens</Text>
        <TouchableOpacity
          style={styles.linkItem}
          onPress={() => openURL('https://tnc-trading.com')}
        >
          <Text style={styles.linkIcon}>🌐</Text>
          <Text style={styles.linkText}>Site web</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkItem}
          onPress={() => openURL('https://twitter.com/tnctrading')}
        >
          <Text style={styles.linkIcon}>🐦</Text>
          <Text style={styles.linkText}>Twitter</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkItem}
          onPress={() => openURL('https://facebook.com/tnctrading')}
        >
          <Text style={styles.linkIcon}>📘</Text>
          <Text style={styles.linkText}>Facebook</Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          © 2025 TNC Trading. Tous droits réservés.
        </Text>
        <Text style={styles.footerText}>
          Ouagadougou, Burkina Faso
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
  header: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: 'rgba(212, 175, 55, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logo: {
    fontSize: 40,
  },
  appName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#D4AF37',
    marginBottom: 4,
  },
  tagline: {
    fontSize: 16,
    color: '#9CA3AF',
    marginBottom: 8,
    textAlign: 'center',
  },
  version: {
    fontSize: 14,
    color: '#6B7280',
  },
  card: {
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
  },
  cardText: {
    fontSize: 14,
    color: '#9CA3AF',
    lineHeight: 22,
    marginBottom: 12,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  featureIcon: {
    fontSize: 20,
    marginRight: 12,
    width: 28,
    textAlign: 'center',
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  featureText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  linkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  linkIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  linkText: {
    fontSize: 16,
    color: '#D4AF37',
    fontWeight: '500',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  footerText: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  bottomPadding: {
    height: 32,
  },
});
