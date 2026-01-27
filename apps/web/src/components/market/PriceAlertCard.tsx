import { useState } from 'react';
import { formatCurrency } from '../../lib/formatters';
import { ALERT_TYPES, type AlertType } from '../../lib/constants';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { FormField, Input, Select } from '../ui/FormField';

export interface PriceAlert {
  id: string;
  type: AlertType;
  targetPrice: number;
  currentPrice: number;
  isActive: boolean;
  createdAt: string;
  triggeredAt?: string;
}

export interface PriceAlertCardProps {
  alert: PriceAlert;
  onDelete: (id: string) => void;
  onToggle: (id: string, isActive: boolean) => void;
  isDeleting?: boolean;
}

/**
 * Price Alert Card Component
 */
export function PriceAlertCard({
  alert,
  onDelete,
  onToggle,
  isDeleting = false,
}: PriceAlertCardProps) {
  const alertType = ALERT_TYPES[alert.type];
  const progress = alert.type === 'ABOVE'
    ? Math.min((alert.currentPrice / alert.targetPrice) * 100, 100)
    : Math.min((alert.targetPrice / alert.currentPrice) * 100, 100);

  const isTriggered = alert.triggeredAt !== undefined;

  return (
    <div
      className={`
        p-4 rounded-lg border transition-all
        ${isTriggered
          ? 'bg-green-500/10 border-green-500/30'
          : alert.isActive
            ? 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
            : 'bg-slate-800/30 border-slate-700/50 opacity-60'
        }
      `}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          {/* Alert Type Icon */}
          <div
            className={`
              p-2 rounded-lg
              ${alertType.color === 'green' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}
            `}
          >
            {alert.type === 'ABOVE' ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            )}
          </div>

          {/* Alert Info */}
          <div>
            <p className="font-medium text-white">
              {alertType.label} {formatCurrency(alert.targetPrice, 'XOF')}
            </p>
            <p className="text-sm text-slate-400 mt-1">
              Prix actuel: {formatCurrency(alert.currentPrice, 'XOF')}
            </p>

            {/* Progress Bar */}
            <div className="mt-2 w-32">
              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    alertType.color === 'green' ? 'bg-green-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">{progress.toFixed(0)}%</p>
            </div>

            {isTriggered && (
              <p className="text-xs text-green-400 mt-2">
                Declenche le {new Date(alert.triggeredAt!).toLocaleDateString('fr-FR')}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Toggle Switch */}
          <button
            onClick={() => onToggle(alert.id, !alert.isActive)}
            className={`
              relative inline-flex h-6 w-11 items-center rounded-full transition-colors
              ${alert.isActive ? 'bg-amber-500' : 'bg-slate-600'}
            `}
            disabled={isTriggered}
          >
            <span
              className={`
                inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                ${alert.isActive ? 'translate-x-6' : 'translate-x-1'}
              `}
            />
          </button>

          {/* Delete Button */}
          <button
            onClick={() => onDelete(alert.id)}
            disabled={isDeleting}
            className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
            title="Supprimer l'alerte"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export interface PriceAlertListProps {
  alerts: PriceAlert[];
  currentPrice: number;
  onDelete: (id: string) => void;
  onToggle: (id: string, isActive: boolean) => void;
  onCreate: (alert: { type: AlertType; targetPrice: number }) => void;
  isDeleting?: boolean;
  isCreating?: boolean;
}

/**
 * Price Alert List Component
 */
export function PriceAlertList({
  alerts,
  currentPrice,
  onDelete,
  onToggle,
  onCreate,
  isDeleting = false,
  isCreating = false,
}: PriceAlertListProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Alertes de prix</h3>
          <p className="text-sm text-slate-400">
            {alerts.filter((a) => a.isActive).length} alerte{alerts.filter((a) => a.isActive).length > 1 ? 's' : ''} active{alerts.filter((a) => a.isActive).length > 1 ? 's' : ''}
          </p>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowCreateModal(true)}
          leftIcon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          }
        >
          Nouvelle alerte
        </Button>
      </div>

      {/* Alert Cards */}
      <div className="space-y-3">
        {alerts.map((alert) => (
          <PriceAlertCard
            key={alert.id}
            alert={{ ...alert, currentPrice }}
            onDelete={onDelete}
            onToggle={onToggle}
            isDeleting={isDeleting}
          />
        ))}

        {alerts.length === 0 && (
          <div className="text-center py-8 text-slate-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <p>Aucune alerte de prix configurée</p>
            <p className="text-sm mt-1">Créez une alerte pour être notifié des variations de prix</p>
          </div>
        )}
      </div>

      {/* Create Alert Modal */}
      <CreateAlertModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={(alert) => {
          onCreate(alert);
          setShowCreateModal(false);
        }}
        currentPrice={currentPrice}
        isCreating={isCreating}
      />
    </div>
  );
}

interface CreateAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (alert: { type: AlertType; targetPrice: number }) => void;
  currentPrice: number;
  isCreating?: boolean;
}

function CreateAlertModal({
  isOpen,
  onClose,
  onCreate,
  currentPrice,
  isCreating = false,
}: CreateAlertModalProps) {
  const [type, setType] = useState<AlertType>('ABOVE');
  const [targetPrice, setTargetPrice] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const price = parseFloat(targetPrice);

    if (isNaN(price) || price <= 0) {
      setError('Veuillez entrer un prix valide');
      return;
    }

    if (type === 'ABOVE' && price <= currentPrice) {
      setError('Le prix cible doit être supérieur au prix actuel');
      return;
    }

    if (type === 'BELOW' && price >= currentPrice) {
      setError('Le prix cible doit être inférieur au prix actuel');
      return;
    }

    setError('');
    onCreate({ type, targetPrice: price });
    setTargetPrice('');
    setType('ABOVE');
  };

  const suggestedPrices = type === 'ABOVE'
    ? [
        { label: '+5%', value: currentPrice * 1.05 },
        { label: '+10%', value: currentPrice * 1.1 },
        { label: '+20%', value: currentPrice * 1.2 },
      ]
    : [
        { label: '-5%', value: currentPrice * 0.95 },
        { label: '-10%', value: currentPrice * 0.9 },
        { label: '-20%', value: currentPrice * 0.8 },
      ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Nouvelle alerte de prix"
      size="sm"
    >
      <div className="space-y-6">
        {/* Current Price */}
        <div className="p-4 bg-slate-800/50 rounded-lg text-center">
          <p className="text-sm text-slate-400">Prix actuel</p>
          <p className="text-2xl font-bold text-white">{formatCurrency(currentPrice, 'XOF')}</p>
        </div>

        {/* Alert Type */}
        <FormField label="Type d'alerte">
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value as AlertType);
              setTargetPrice('');
              setError('');
            }}
          >
            <option value="ABOVE">Au-dessus de...</option>
            <option value="BELOW">En-dessous de...</option>
          </Select>
        </FormField>

        {/* Target Price */}
        <FormField
          label="Prix cible (FCFA)"
          error={error}
          helperText={type === 'ABOVE'
            ? `Doit être supérieur à ${formatCurrency(currentPrice, 'XOF')}`
            : `Doit être inférieur à ${formatCurrency(currentPrice, 'XOF')}`
          }
        >
          <Input
            type="number"
            value={targetPrice}
            onChange={(e) => {
              setTargetPrice(e.target.value);
              setError('');
            }}
            placeholder="Entrez le prix cible"
          />
        </FormField>

        {/* Suggested Prices */}
        <div>
          <p className="text-sm text-slate-400 mb-2">Suggestions:</p>
          <div className="flex gap-2">
            {suggestedPrices.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                onClick={() => setTargetPrice(Math.round(suggestion.value).toString())}
                className="px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            fullWidth
            onClick={handleSubmit}
            isLoading={isCreating}
            loadingText="Création..."
            disabled={!targetPrice}
          >
            Créer l'alerte
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default PriceAlertCard;
