interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: 'gold' | 'white' | 'current';
  className?: string;
}

const sizeClasses = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-3',
};

const colorClasses = {
  gold: 'border-gold-500',
  white: 'border-white',
  current: 'border-current',
};

export function Spinner({ size = 'md', color = 'gold', className = '' }: SpinnerProps) {
  return (
    <div
      className={`${sizeClasses[size]} ${colorClasses[color]} border-t-transparent rounded-full animate-spin ${className}`}
      role="status"
      aria-label="Chargement"
    >
      <span className="sr-only">Chargement...</span>
    </div>
  );
}

// Inline spinner for buttons/text
export function InlineSpinner({ size = 'sm', className = '' }: { size?: 'sm' | 'md'; className?: string }) {
  const inlineSizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
  };

  return (
    <span className={`inline-block ${inlineSizes[size]} ${className}`}>
      <Spinner size={size} color="current" />
    </span>
  );
}

// Full page loading overlay
export function LoadingOverlay({ message = 'Chargement...' }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" />
        <p className="text-white font-medium">{message}</p>
      </div>
    </div>
  );
}

// Centered spinner for content areas
export function LoadingState({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <Spinner size="lg" />
      {message && <p className="text-slate-400">{message}</p>}
    </div>
  );
}

export default Spinner;
