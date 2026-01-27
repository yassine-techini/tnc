import { ReactNode } from 'react';

export interface BadgeProps {
  variant?: 'success' | 'warning' | 'error' | 'info' | 'default';
  size?: 'sm' | 'md';
  children: ReactNode;
  dot?: boolean;
  className?: string;
}

const variantClasses = {
  success: 'bg-green-500/20 text-green-400',
  warning: 'bg-yellow-500/20 text-yellow-400',
  error: 'bg-red-500/20 text-red-400',
  info: 'bg-blue-500/20 text-blue-400',
  default: 'bg-slate-500/20 text-slate-400',
};

const dotColors = {
  success: 'bg-green-400',
  warning: 'bg-yellow-400',
  error: 'bg-red-400',
  info: 'bg-blue-400',
  default: 'bg-slate-400',
};

const sizeClasses = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-0.5 text-sm',
};

export function Badge({
  variant = 'default',
  size = 'md',
  children,
  dot = false,
  className = '',
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`} />}
      {children}
    </span>
  );
}

// Status Badge with icon
export interface StatusBadgeProps {
  status: 'active' | 'inactive' | 'pending' | 'verified' | 'rejected' | 'expired';
  label?: string;
  showIcon?: boolean;
}

const statusConfig = {
  active: { variant: 'success' as const, icon: '✓', defaultLabel: 'Actif' },
  inactive: { variant: 'default' as const, icon: '○', defaultLabel: 'Inactif' },
  pending: { variant: 'warning' as const, icon: '◷', defaultLabel: 'En attente' },
  verified: { variant: 'success' as const, icon: '✓', defaultLabel: 'Vérifié' },
  rejected: { variant: 'error' as const, icon: '✕', defaultLabel: 'Rejete' },
  expired: { variant: 'error' as const, icon: '!', defaultLabel: 'Expire' },
};

export function StatusBadge({ status, label, showIcon = true }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <Badge variant={config.variant}>
      {showIcon && <span>{config.icon}</span>}
      {label || config.defaultLabel}
    </Badge>
  );
}

// KYC Level Badge
export interface KycBadgeProps {
  level: 'BASIC' | 'STANDARD' | 'VERIFIED';
}

const kycConfig = {
  BASIC: { variant: 'default' as const, label: 'Basique' },
  STANDARD: { variant: 'info' as const, label: 'Standard' },
  VERIFIED: { variant: 'success' as const, label: 'Vérifié' },
};

export function KycBadge({ level }: KycBadgeProps) {
  const config = kycConfig[level];

  return (
    <Badge variant={config.variant} dot>
      {config.label}
    </Badge>
  );
}

// Transaction Type Badge
export interface TransactionTypeBadgeProps {
  type: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL' | 'FEE';
}

const transactionConfig = {
  BUY: { variant: 'success' as const, label: 'Achat', icon: '↓' },
  SELL: { variant: 'error' as const, label: 'Vente', icon: '↑' },
  DEPOSIT: { variant: 'info' as const, label: 'Depot', icon: '↓' },
  WITHDRAWAL: { variant: 'warning' as const, label: 'Retrait', icon: '↑' },
  FEE: { variant: 'default' as const, label: 'Frais', icon: '−' },
};

export function TransactionTypeBadge({ type }: TransactionTypeBadgeProps) {
  const config = transactionConfig[type];

  return (
    <Badge variant={config.variant}>
      <span>{config.icon}</span>
      {config.label}
    </Badge>
  );
}

export default Badge;
