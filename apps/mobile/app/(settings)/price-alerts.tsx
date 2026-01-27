import { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import InlineMessage from '../../components/InlineMessage';
import ConfirmDialog from '../../components/ConfirmDialog';

interface PriceAlert {
  id: string;
  type: 'above' | 'below';
  price: number;
  enabled: boolean;
}

const PRICE_ALERTS_STORAGE_KEY = 'tnc_price_alerts';

export default function PriceAlertsScreen() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [newAlertPrice, setNewAlertPrice] = useState('');
  const [newAlertType, setNewAlertType] = useState<'above' | 'below'>('above');
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'error' | 'success' | 'warning'; text: string } | null>(null);
  const [deleteAlertId, setDeleteAlertId] = useState<string | null>(null);

  const { data: priceData } = useQuery({
    queryKey: ['price'],
    queryFn: () => api.getPrice(),
  });

  const currentPrice = priceData?.data?.priceXof || 0;

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    try {
      const stored = await SecureStore.getItemAsync(PRICE_ALERTS_STORAGE_KEY);
      if (stored) {
        setAlerts(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error loading alerts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveAlerts = async (newAlerts: PriceAlert[]) => {
    try {
      await SecureStore.setItemAsync(PRICE_ALERTS_STORAGE_KEY, JSON.stringify(newAlerts));
      setAlerts(newAlerts);
    } catch (error) {
      console.error('Error saving alerts:', error);
    }
  };

  const addAlert = () => {
    const price = parseInt(newAlertPrice);
    if (!price || price <= 0) {
      setMessage({ type: 'error', text: 'Veuillez entrer un prix valide' });
      return;
    }

    if (alerts.length >= 5) {
      setMessage({ type: 'warning', text: 'Vous ne pouvez pas avoir plus de 5 alertes' });
      return;
    }

    const newAlert: PriceAlert = {
      id: Date.now().toString(),
      type: newAlertType,
      price,
      enabled: true,
    };

    saveAlerts([...alerts, newAlert]);
    setNewAlertPrice('');
    setMessage({ type: 'success', text: 'Alerte creee avec succes' });
  };

  const toggleAlert = (id: string) => {
    const newAlerts = alerts.map((alert) =>
      alert.id === id ? { ...alert, enabled: !alert.enabled } : alert
    );
    saveAlerts(newAlerts);
  };

  const deleteAlert = (id: string) => {
    setDeleteAlertId(id);
  };

  const confirmDeleteAlert = () => {
    if (deleteAlertId) {
      const newAlerts = alerts.filter((alert) => alert.id !== deleteAlertId);
      saveAlerts(newAlerts);
      setDeleteAlertId(null);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#D4AF37" />
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
              style={[styles.typeButton, newAlertType === 'above' && styles.typeButtonActive]}
              onPress={() => setNewAlertType('above')}
            >
              <Text style={[styles.typeButtonText, newAlertType === 'above' && styles.typeButtonTextActive]}>
                Au-dessus de
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeButton, newAlertType === 'below' && styles.typeButtonActive]}
              onPress={() => setNewAlertType('below')}
            >
              <Text style={[styles.typeButtonText, newAlertType === 'below' && styles.typeButtonTextActive]}>
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

          <TouchableOpacity style={styles.addButton} onPress={addAlert}>
            <Text style={styles.addButtonText}>Créer l'alerte</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Existing Alerts */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mes alertes ({alerts.length}/5)</Text>
        {alerts.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🔔</Text>
            <Text style={styles.emptyText}>Aucune alerte configurée</Text>
            <Text style={styles.emptySubtext}>
              Créez une alerte pour être notifié quand le prix atteint votre objectif
            </Text>
          </View>
        ) : (
          alerts.map((alert) => (
            <View key={alert.id} style={[styles.alertCard, !alert.enabled && styles.alertCardDisabled]}>
              <View style={styles.alertInfo}>
                <Text style={styles.alertType}>
                  {alert.type === 'above' ? '↑' : '↓'} {alert.type === 'above' ? 'Au-dessus' : 'En-dessous'} de
                </Text>
                <Text style={[styles.alertPrice, !alert.enabled && styles.alertPriceDisabled]}>
                  {alert.price.toLocaleString()} XOF/g
                </Text>
              </View>
              <View style={styles.alertActions}>
                <TouchableOpacity onPress={() => toggleAlert(alert.id)}>
                  <Text style={styles.toggleButton}>{alert.enabled ? '🔔' : '🔕'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteAlert(alert.id)}>
                  <Text style={styles.deleteButton}>🗑️</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Info */}
      <View style={styles.infoBox}>
        <Text style={styles.infoIcon}>ℹ️</Text>
        <Text style={styles.infoText}>
          Les alertes de prix vous envoient une notification push lorsque le prix de l'or atteint
          le seuil que vous avez défini. Assurez-vous que les notifications sont activées.
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
  alertInfo: {
    flex: 1,
  },
  alertType: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 2,
  },
  alertPrice: {
    fontSize: 18,
    fontWeight: '700',
    color: '#D4AF37',
  },
  alertPriceDisabled: {
    color: '#6B7280',
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
