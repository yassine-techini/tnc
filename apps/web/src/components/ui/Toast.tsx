/**
 * Toast notification component
 */
import { useState, useEffect, createContext, useContext, useCallback } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string, duration = 5000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, type, message, duration }]);

    if (duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

const toastStyles: Record<ToastType, { bg: string; icon: string; border: string }> = {
  success: {
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
    icon: '✓',
  },
  error: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    icon: '✕',
  },
  warning: {
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
    icon: '⚠',
  },
  info: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    icon: 'ℹ',
  },
};

const iconColors: Record<ToastType, string> = {
  success: 'text-green-400',
  error: 'text-red-400',
  warning: 'text-yellow-400',
  info: 'text-blue-400',
};

function ToastContainer({
  toasts,
  onRemove
}: {
  toasts: Toast[];
  onRemove: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onRemove
}: {
  toast: Toast;
  onRemove: (id: string) => void;
}) {
  const [isLeaving, setIsLeaving] = useState(false);
  const style = toastStyles[toast.type];

  useEffect(() => {
    if (toast.duration && toast.duration > 0) {
      const leaveTimer = setTimeout(() => {
        setIsLeaving(true);
      }, toast.duration - 300);
      return () => clearTimeout(leaveTimer);
    }
  }, [toast.duration]);

  const handleClose = () => {
    setIsLeaving(true);
    setTimeout(() => onRemove(toast.id), 300);
  };

  return (
    <div
      className={`
        ${style.bg} ${style.border} border rounded-lg p-4 shadow-lg backdrop-blur-sm
        flex items-start gap-3 transition-all duration-300
        ${isLeaving ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}
      `}
    >
      <span className={`text-lg ${iconColors[toast.type]}`}>{style.icon}</span>
      <p className="flex-1 text-sm text-white">{toast.message}</p>
      <button
        onClick={handleClose}
        className="text-slate-400 hover:text-white transition-colors"
      >
        ×
      </button>
    </div>
  );
}
