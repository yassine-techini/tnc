import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import InlineMessage from '../../components/InlineMessage';
import ConfirmDialog from '../../components/ConfirmDialog';

interface PriceAlert {
  id: string;
  alertType: 'ABOVE' | 'BELOW';
  targetPrice: number;
  currency: 'XOF' | 'USD';
  notificationMethod: 'PUSH' | 'EMAIL' | 'SMS' | 'ALL';
  isActive: boolean;
  triggered: boolean;
  triggeredAt: string | null;
  triggeredPrice: number | null;
  note: string | null;
  createdAt: string;
}

export default function PriceAlertsScreen() {
  const { tokens } = useAuthStore();
  const queryClient = useQueryClient();
  const [newAlertPrice, setNewAlertPrice] = useState('');
  const [newAlertType, setNewAlertType] = useState<'ABOVE' | 'BELOW'>('ABOVE');
  const [message, setMessage] = useState<{ type: 'error' | 'success' | 'warning'; text: string } | null>(null);
  const [deleteAlertId, setDeleteAlertId] = useState<string | null>(null);

  // Fetch price alerts from API
  const { data: alertsData, isLoading, error } = useQuery({
    queryKey: ['priceAlerts'],
    queryFn: () => api.getPriceAlerts(tokens?.accessToken || '', true),
    enabled: !!tokens?.accessToken,
  });

  // Fetch current price
  const { data: priceData } = useQuery({
    queryKey: ['price'],
    queryFn: () => api.getPrice(),
  });

  const currentPrice = priceData?.data?.priceXof || alertsData?.data?.currentPrice?.priceXof || 0;
  const alerts: PriceAlert[] = alertsData?.data?.items || [];

  // Create alert mutation
  const createAlertMutation = useMutation({
    mutationFn: (data: { alertType: 'ABOVE' | 'BELOW'; targetPrice: number }) =>
      api.createPriceAlert(
        { alertType: data.alertType, targetPrice: data.targetPrice, notificationMethod: 'ALL' },
        tokens?.accessToken || ''
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['priceAlerts'] });
      setNewAlertPrice('');
      setMessage({ type: 'success', text: 'Alerte creee avec succes' });
    },
    onError: (err: Error) => {
      setMessage({ type: 'error', text: err.message || 'Erreur lors de la creation de l\'alerte' });
    },
  });

  // Toggle alert mutation
  const toggleAlertMutation = useMutation({
    mutationFn: ({ alertId, isActive }: { alertId: string; isActive: boolean }) =>
      api.updatePriceAlert(alertId, { isActive }, tokens?.accessToken || ''),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['priceAlerts'] });
    },
    onError: (err: Error) => {
      setMessage({ type: 'error', text: err.message || 'Erreur lors de la mise a jour' });
    },
  });

  // Delete alert mutation
  const deleteAlertMutation = useMutation({
    mutationFn: (alertId: string) => api.deletePriceAlert(alertId, tokens?.accessToken || ''),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['priceAlerts'] });
      setDeleteAlertId(null);
      setMessage({ type: 'success', text: 'Alerte supprimee' });
    },
    onError: (err: Error) => {
      setMessage({ type: 'error', text: err.message || 'Erreur lors de la suppression' });
    },
  });

  const addAlert = () => {
    const price = parseInt(newAlertPrice);
    if (!price || price <= 0) {
      setMessage({ type: 'error', text: 'Veuillez entrer un prix valide' });
      return;
    }

    // Validate against current price
    if (newAlertType === 'ABOVE' && price <= currentPrice) {
      setMessage({ type: 'error', text: 'Le prix doit etre superieur au prix actuel' });
      return;
    }

    if (newAlertType === 'BELOW' && price >= currentPrice) {
      setMessage({ type: 'error', text: 'Le prix doit etre inferieur au prix actuel' });
      return;
    }

    createAlertMutation.mutate({ alertType: newAlertType, targetPrice: price });
  };

  const toggleAlert = (alert: PriceAlert) => {
    toggleAlertMutation.mutate({ alertId: alert.id, isActive: !alert.isActive });
  };

  const confirmDeleteAlert = () => {
    if (deleteAlertId) {
      deleteAlertMutation.mutate(deleteAlertId);
    }
  };

  // Filter active alerts
  const activeAlerts = alerts.filter(a => !a.triggered);
  const triggeredAlerts = alerts.filter(a => a.triggered);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#D4AF37" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Erreur lors du chargement des alertes</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => queryClient.invalidateQueries({ queryKey: ['priceAlerts'] })}
        >
          <Text style={styles.retryButtonText}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
        {/* Current Price */}
        <View style={styles.priceCard}>
          <Text style={styles.priceLabel}>Prix actuel de l'or</Text>
          <Text style={styles.priceValue}>{currentPrice.toLocaleString()} XOF/g</Text>
        </View>

        {message && (
          <InlineMessage type={message.type} message={message.text} onDismiss={() => setMessage(null)} />
        )}

        {/* Add Alert */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Nouvelle alerte</Text>
          <View style={styles.addAlertCard}>
            <View style={styles.typeSelector}>
              <TouchableOpacity
                style={[styles.typeButton, newAlertType === 'ABOVE' && styles.typeButtonActive]}
                onPress={() => setNewAlertType('ABOVE')}
              >
                <Text style={[styles.typeButtonText, newAlertType === 'ABOVE' && styles.typeButtonTextActive]}>
                  Au-dessus de
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeButton, newAlertType === 'BELOW' && styles.typeButtonActive]}
                onPress={() => setNewAlertType('BELOW')}
              >
                <Text style={[styles.typeButtonText, newAlertType === 'BELOW' && styles.typeButtonTextActive]}>
                  En-dessous de
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.priceInputContainer}>
              <TextInput
                style={styles.priceInput}
                placeholder="Prix en XOF"
                placeholderTextColor="#6B7280"
                value={newAlertPrice}
                onChangeText={setNewAlertPrice}
                keyboardType="number-pad"
              />
              <Text style={styles.currencyLabel}>XOF/g</Text>
            </View>

            <TouchableOpacity
              style={[styles.addButton, createAlertMutation.isPending && styles.addButtonDisabled]}
              onPress={addAlert}
              disabled={createAlertMutation.isPending}
            >
              {createAlertMutation.isPending ? (
                <ActivityIndicator size="small" color="#0F0F1A" />
              ) : (
                <Text style={styles.addButtonText}>Créer l'alerte</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Active Alerts */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Mes alertes ({activeAlerts.length}/10)</Text>
          {activeAlerts.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🔔</Text>
              <Text style={styles.emptyText}>Aucune alerte active</Text>
              <Text style={styles.emptySubtext}>
                Créez une alerte pour être notifié quand le prix atteint votre objectif
              </Text>
            </View>
          ) : (
            activeAlerts.map((alert) => (
              <View key={alert.id} style={[styles.alertCard, !alert.isActive && styles.alertCardDisabled]}>
                <View style={styles.alertInfo}>
                  <View style={styles.alertTypeContainer}>
                    <Text style={[
                      styles.alertTypeIcon,
                      alert.alertType === 'ABOVE' ? styles.alertTypeIconUp : styles.alertTypeIconDown
                    ]}>
                      {alert.alertType === 'ABOVE' ? '↑' : '↓'}
                    </Text>
                    <Text style={styles.alertType}>
                      {alert.alertType === 'ABOVE' ? 'Au-dessus de' : 'En-dessous de'}
                    </Text>
                  </View>
                  <Text style={[styles.alertPrice, !alert.isActive && styles.alertPriceDisabled]}>
                    {alert.targetPrice.toLocaleString()} {alert.currency}/g
                  </Text>
                  {alert.note && (
                    <Text style={styles.alertNote}>{alert.note}</Text>
                  )}
                </View>
                <View style={styles.alertActions}>
                  <TouchableOpacity
                    onPress={() => toggleAlert(alert)}
                    disabled={toggleAlertMutation.isPending}
                  >
                    <Text style={styles.toggleButton}>{alert.isActive ? '🔔' : '🔕'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setDeleteAlertId(alert.id)}>
                    <Text style={styles.deleteButton}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Triggered Alerts */}
        {triggeredAlerts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Alertes déclenchées</Text>
            {triggeredAlerts.map((alert) => (
              <View key={alert.id} style={[styles.alertCard, styles.alertCardTriggered]}>
                <View style={styles.alertInfo}>
                  <View style={styles.alertTypeContainer}>
                    <Text style={styles.triggeredIcon}>✓</Text>
                    <Text style={styles.alertType}>
                      {alert.alertType === 'ABOVE' ? 'Au-dessus de' : 'En-dessous de'}
                    </Text>
                  </View>
                  <Text style={styles.alertPriceTriggered}>
                    {alert.targetPrice.toLocaleString()} {alert.currency}/g
                  </Text>
                  {alert.triggeredAt && (
                    <Text style={styles.triggeredDate}>
                      Déclenché le {new Date(alert.triggeredAt).toLocaleDateString('fr-FR')}
                      {alert.triggeredPrice && ` à ${alert.triggeredPrice.toLocaleString()} XOF`}
                    </Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => setDeleteAlertId(alert.id)}>
                  <Text style={styles.deleteButton}>🗑️</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Info */}
        <View style={styles.infoBox}>
          <Text style={styles.infoIcon}>ℹ️</Text>
          <Text style={styles.infoText}>
            Les alertes de prix vous envoient une notification lorsque le prix de l'or atteint
            le seuil que vous avez défini. Vous pouvez recevoir des notifications par email, SMS ou push.
          </Text>
        </View>

        {deleteAlertId && (
          <ConfirmDialog
            title="Supprimer l'alerte"
            message="Voulez-vous vraiment supprimer cette alerte ?"
            confirmText="Supprimer"
            cancelText="Annuler"
            onConfirm={confirmDeleteAlert}
            onCancel={() => setDeleteAlertId(null)}
            destructive
          />
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1A',
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0F0F1A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 16,
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#D4AF37',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#0F0F1A',
    fontWeight: '600',
  },
  priceCard: {
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    alignItems: 'center',
  },
  priceLabel: {
    fontSize: 14,
    color: '#9CA3AF',
    marginBottom: 4,
  },
  priceValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#D4AF37',
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
  addAlertCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    padding: 20,
  },
  typeSelector: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  typeButton: {
    flex: 1,
    backgroundColor: '#0F0F1A',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  typeButtonActive: {
    borderColor: '#D4AF37',
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
  },
  typeButtonText: {
    color: '#9CA3AF',
    fontSize: 14,
    fontWeight: '500',
  },
  typeButtonTextActive: {
    color: '#D4AF37',
  },
  priceInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F0F1A',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  priceInput: {
    flex: 1,
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    paddingVertical: 16,
  },
  currencyLabel: {
    color: '#9CA3AF',
    fontSize: 14,
    fontWeight: '500',
  },
  addButton: {
    backgroundColor: '#D4AF37',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  addButtonDisabled: {
    opacity: 0.7,
  },
  addButtonText: {
    color: '#0F0F1A',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyState: {
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  alertCardDisabled: {
    opacity: 0.5,
  },
  alertCardTriggered: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  alertInfo: {
    flex: 1,
  },
  alertTypeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  alertTypeIcon: {
    fontSize: 14,
    fontWeight: '700',
  },
  alertTypeIconUp: {
    color: '#22C55E',
  },
  alertTypeIconDown: {
    color: '#EF4444',
  },
  triggeredIcon: {
    fontSize: 14,
    color: '#22C55E',
    fontWeight: '700',
  },
  alertType: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  alertPrice: {
    fontSize: 18,
    fontWeight: '700',
    color: '#D4AF37',
  },
  alertPriceDisabled: {
    color: '#6B7280',
  },
  alertPriceTriggered: {
    fontSize: 18,
    fontWeight: '700',
    color: '#22C55E',
  },
  alertNote: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
  triggeredDate: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
  alertActions: {
    flexDirection: 'row',
    gap: 16,
  },
  toggleButton: {
    fontSize: 24,
  },
  deleteButton: {
    fontSize: 24,
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
