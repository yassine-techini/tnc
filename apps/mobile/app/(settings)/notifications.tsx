import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, ActivityIndicator } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationPreferencesData } from '@tnc-trading/shared/contracts';
import { useAuthStore } from '../../stores/auth';
import api from '../../lib/api';
import InlineMessage from '../../components/InlineMessage';

/**
 * Preferences de notification — SERVEUR, pas appareil.
 *
 * Cet ecran ecrivait dans SecureStore et n'appelait jamais l'API. Or c'est le
 * serveur qui decide quoi envoyer : couper « alertes de prix » ne changeait rien,
 * les notifications continuaient d'arriver, et les reglages ne suivaient pas
 * l'utilisateur sur un nouveau telephone.
 *
 * Les bascules « Actualites » et « Securite » ont disparu : aucune colonne ne
 * leur correspondait cote serveur. Elles ne faisaient rien, et les garder aurait
 * conserve le mensonge plutot que de le corriger. Les cinq preferences ci-dessous
 * sont exactement celles que l'API connait, les memes que sur le web.
 */

interface Bascule {
  clef: keyof NotificationPreferencesData;
  titre: string;
  description: string;
}

const SECTIONS: Array<{ titre: string; bascules: Bascule[] }> = [
  {
    titre: 'Canaux',
    bascules: [
      { clef: 'email', titre: 'Email', description: 'Recevoir les notifications par email' },
      { clef: 'sms', titre: 'SMS', description: 'Recevoir les notifications par SMS' },
    ],
  },
  {
    titre: 'Transactions',
    bascules: [
      {
        clef: 'transactionAlerts',
        titre: 'Achats et ventes',
        description: "Confirmation de vos achats et ventes d'or",
      },
    ],
  },
  {
    titre: "Prix de l'or",
    bascules: [
      {
        clef: 'priceAlerts',
        titre: 'Alertes de prix',
        description: 'Notifications quand le prix atteint vos objectifs',
      },
    ],
  },
  {
    titre: 'Actualites',
    bascules: [
      {
        clef: 'marketingEmails',
        titre: 'Offres promotionnelles',
        description: 'Promotions et offres speciales',
      },
    ],
  },
];

export default function NotificationsScreen() {
  const { tokens } = useAuthStore();
  const queryClient = useQueryClient();
  const [permissionStatus, setPermissionStatus] = useState<string>('unknown');
  const [message, setMessage] = useState<{ type: 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    Notifications.getPermissionsAsync().then(({ status }) => setPermissionStatus(status));
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['notificationPreferences'],
    queryFn: () => api.getNotificationPreferences(tokens!.accessToken),
    enabled: Boolean(tokens?.accessToken),
  });

  const preferences = data?.data;

  const mutation = useMutation({
    mutationFn: (partiel: Partial<NotificationPreferencesData>) =>
      api.updateNotificationPreferences(partiel, tokens!.accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationPreferences'] });
    },
    onError: (err: Error) => {
      // Un reglage qu'on croit enregistre et qui ne l'est pas est pire que pas
      // de reglage du tout : on le dit.
      setMessage({
        type: 'error',
        text: err.message || "Le reglage n'a pas pu etre enregistre. Reessayez.",
      });
      queryClient.invalidateQueries({ queryKey: ['notificationPreferences'] });
    },
  });

  const basculer = (clef: keyof NotificationPreferencesData, valeur: boolean) => {
    setMessage(null);
    mutation.mutate({ [clef]: valeur });
  };

  if (isLoading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color="#D4AF37" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {permissionStatus !== 'granted' && (
        <View style={styles.warningCard}>
          <Text style={styles.warningIcon}>⚠️</Text>
          <View style={styles.warningContent}>
            <Text style={styles.warningTitle}>Notifications desactivees sur cet appareil</Text>
            <Text style={styles.warningText}>
              Les reglages ci-dessous restent enregistres sur votre compte, mais ce telephone
              n'affichera rien tant que l'autorisation systeme n'est pas accordee.
            </Text>
          </View>
        </View>
      )}

      {isError && (
        <InlineMessage
          type="error"
          message="Vos preferences n'ont pas pu etre chargees. Ce qui s'affiche n'est pas votre reglage reel."
        />
      )}

      {message && (
        <InlineMessage
          type={message.type}
          message={message.text}
          onDismiss={() => setMessage(null)}
        />
      )}

      {SECTIONS.map((section) => (
        <View key={section.titre} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.titre}</Text>
          {section.bascules.map((bascule) => (
            <View key={bascule.clef} style={styles.settingItem}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>{bascule.titre}</Text>
                <Text style={styles.settingDescription}>{bascule.description}</Text>
              </View>
              <Switch
                testID={`preference-${bascule.clef}`}
                value={Boolean(preferences?.[bascule.clef])}
                onValueChange={(valeur) => basculer(bascule.clef, valeur)}
                trackColor={{ false: '#374151', true: 'rgba(212, 175, 55, 0.5)' }}
                thumbColor={preferences?.[bascule.clef] ? '#D4AF37' : '#9CA3AF'}
                disabled={mutation.isPending || isError}
              />
            </View>
          ))}
        </View>
      ))}

      <View style={styles.infoBox}>
        <Text style={styles.infoIcon}>ℹ️</Text>
        <Text style={styles.infoText}>
          Ces reglages sont enregistres sur votre compte et s'appliquent sur tous vos appareils.
        </Text>
      </View>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F0F1A' },
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
