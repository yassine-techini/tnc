/**
 * Statistics card component with trend indicator
 */
import { Skeleton } from './Skeleton';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: {
    value: number;
    label?: string;
    isPositive?: boolean;
  };
  icon?: React.ReactNode;
  variant?: 'default' | 'gold' | 'success' | 'warning' | 'error';
  isLoading?: boolean;
  className?: string;
}

const variantStyles = {
  default: 'card',
  gold: 'card-gold',
  success: 'card border-green-500/30',
  warning: 'card border-yellow-500/30',
  error: 'card border-red-500/30',
};

const valueColors = {
  default: 'text-white',
  gold: 'text-gold-500',
  success: 'text-green-400',
  warning: 'text-yellow-400',
  error: 'text-red-400',
};

export function StatCard({
  title,
  value,
  subtitle,
  trend,
  icon,
  variant = 'default',
  isLoading = false,
  className = '',
}: StatCardProps) {
  if (isLoading) {
    return (
      <div className={`${variantStyles[variant]} ${className}`}>
        <Skeleton className="h-4 w-24 mb-2" />
        <Skeleton className="h-10 w-32 mb-1" />
        <Skeleton className="h-4 w-20" />
      </div>
    );
  }

  return (
    <div className={`${variantStyles[variant]} ${className} transition-transform hover:scale-[1.02]`}>
      <div className="flex items-start justify-between">
        <p className="text-sm text-slate-400 mb-1">{title}</p>
        {icon && <span className="text-xl opacity-60">{icon}</span>}
      </div>

      <p className={`text-3xl font-bold ${valueColors[variant]}`}>
        {value}
      </p>

      {(subtitle || trend) && (
        <div className="flex items-center gap-2 mt-1">
          {trend && (
            <span
              className={`text-sm font-medium ${
                trend.isPositive !== false && trend.value >= 0
                  ? 'text-green-400'
                  : 'text-red-400'
              }`}
            >
              {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value).toFixed(2)}%
              {trend.label && <span className="text-slate-400 ml-1">{trend.label}</span>}
            </span>
          )}
          {subtitle && <span className="text-sm text-slate-400">{subtitle}</span>}
        </div>
      )}
    </div>
  );
}

interface StatGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
}

export function StatGrid({ children, columns = 4 }: StatGridProps) {
  const gridCols = {
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  };

  return (
    <div className={`grid ${gridCols[columns]} gap-6`}>
      {children}
    </div>
  );
}
