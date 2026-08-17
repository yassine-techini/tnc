import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationView } from '@tnc-trading/shared/contracts';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import InlineMessage from '../../components/InlineMessage';
import { formatRelativeTime } from '@tnc-trading/shared';
import api from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { useThemeColors } from '../../stores/theme';

/**
 * Boite de reception des notifications.
 *
 * `GET /users/me/notifications` existait depuis le debut, la table se
 * remplissait — et AUCUN client ne la lisait. Une notification manquee etait
 * donc perdue pour de bon : il ne restait que la banniere systeme, ephemere.
 * `CLAUDE.md` prevoyait pourtant cet ecran dans le `HomeStack`.
 */

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

/** Icone et couleur par type, avec un repli explicite pour l'inconnu. */
function apparence(type: string): { icone: IoniconsName; couleur: string } {
  const t = type.toUpperCase();
  if (t.includes('TRANSACTION') || t.includes('BUY') || t.includes('SELL')) {
    return { icone: 'swap-horizontal', couleur: '#3B82F6' };
  }
  if (t.includes('PRICE') || t.includes('ALERT')) {
    return { icone: 'trending-up', couleur: '#D4AF37' };
  }
  if (t.includes('KYC')) return { icone: 'shield-checkmark', couleur: '#10B981' };
  if (t.includes('SECURITY') || t.includes('LOGIN')) {
    return { icone: 'lock-closed', couleur: '#EF4444' };
  }
  if (t.includes('WITHDRAW') || t.includes('DEPOSIT')) {
    return { icone: 'cash', couleur: '#10B981' };
  }
  return { icone: 'notifications', couleur: '#9CA3AF' };
}


export default function NotificationsScreen() {
  const c = useThemeColors();
  const { tokens } = useAuthStore();
  const queryClient = useQueryClient();
  const [erreur, setErreur] = useState('');

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.getNotifications(tokens!.accessToken),
    enabled: Boolean(tokens?.accessToken),
  });

  const items = data?.data?.items ?? [];
  const nonLues = data?.data?.unread ?? 0;

  const marquerLu = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id, tokens!.accessToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (e: Error) => setErreur(e.message),
  });

  const toutMarquer = useMutation({
    mutationFn: () => api.markAllNotificationsRead(tokens!.accessToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (e: Error) => setErreur(e.message),
  });

  if (isLoading) {
    return (
      <View style={[styles.centre, { backgroundColor: c.background }]}>
        <ActivityIndicator color="#D4AF37" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={styles.entete}>
        <Text testID="notifications-titre" style={[styles.titre, { color: c.text }]}>
          Notifications
        </Text>
        {nonLues > 0 && (
          <TouchableOpacity
            testID="notifications-tout-marquer"
            onPress={() => toutMarquer.mutate()}
            disabled={toutMarquer.isPending}
          >
            <Text style={styles.action}>Tout marquer comme lu ({nonLues})</Text>
          </TouchableOpacity>
        )}
      </View>

      {isError && (
        <InlineMessage
          type="error"
          message="Vos notifications n'ont pas pu etre chargees. Cette liste est incomplete."
        />
      )}

      {erreur ? (
        <InlineMessage type="error" message={erreur} onDismiss={() => setErreur('')} />
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(n: NotificationView) => n.id}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#D4AF37" />
        }
        ListEmptyComponent={
          isError ? null : (
            <View style={styles.vide}>
              <Ionicons name="notifications-off-outline" size={40} color={c.textTertiary} />
              <Text style={[styles.videTexte, { color: c.textSecondary }]}>
                Aucune notification pour le moment.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const { icone, couleur } = apparence(item.type);
          return (
            <TouchableOpacity
              testID={`notification-${item.id}`}
              style={[
                styles.ligne,
                { backgroundColor: c.surface, borderColor: c.border },
                !item.read && styles.ligneNonLue,
              ]}
              onPress={() => !item.read && marquerLu.mutate(item.id)}
              activeOpacity={item.read ? 1 : 0.7}
            >
              <View style={[styles.pastille, { backgroundColor: `${couleur}22` }]}>
                <Ionicons name={icone} size={18} color={couleur} />
              </View>
              <View style={styles.contenu}>
                <Text style={[styles.ligneTitre, { color: c.text }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[styles.ligneCorps, { color: c.textSecondary }]}>{item.body}</Text>
                <Text style={[styles.date, { color: c.textTertiary }]}>{formatRelativeTime(item.createdAt)}</Text>
              </View>
              {/* Le point ne disparait qu'une fois le serveur d'accord : marquer
                  lu localement ferait croire a un etat qui n'existe pas. */}
              {!item.read && <View style={styles.point} />}
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={items.length === 0 ? styles.listeVide : styles.liste}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  entete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  titre: { fontSize: 26, fontWeight: '700' },
  action: { color: '#D4AF37', fontSize: 13 },
  liste: { padding: 16, gap: 10 },
  listeVide: { flexGrow: 1, justifyContent: 'center' },
  vide: { alignItems: 'center', gap: 10 },
  videTexte: { fontSize: 14 },
  ligne: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  ligneNonLue: { borderColor: 'rgba(212, 175, 55, 0.4)' },
  pastille: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  contenu: { flex: 1, gap: 3 },
  ligneTitre: { fontSize: 15, fontWeight: '600' },
  ligneCorps: { fontSize: 13, lineHeight: 18 },
  date: { fontSize: 11, marginTop: 2 },
  point: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D4AF37', marginTop: 6 },
});
