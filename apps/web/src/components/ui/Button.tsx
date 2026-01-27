import { ButtonHTMLAttributes, ReactNode, forwardRef } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  loadingText?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

const variantClasses = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  outline: 'btn-outline',
  danger: 'btn-danger',
  ghost: 'bg-transparent text-slate-300 hover:text-white hover:bg-slate-700/50 focus:ring-slate-500',
};

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2',
  lg: 'px-6 py-3 text-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      loadingText,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      children,
      className = '',
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || isLoading;

    // Base classes from btn
    const baseClasses = 'rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 inline-flex items-center justify-center gap-2';

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
        {...props}
      >
        {isLoading ? (
          <>
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            {loadingText || children}
          </>
        ) : (
          <>
            {leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
            {children}
            {rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';

// Icon Button variant
export interface IconButtonProps extends Omit<ButtonProps, 'leftIcon' | 'rightIcon' | 'loadingText'> {
  icon: ReactNode;
  'aria-label': string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, size = 'md', className = '', ...props }, ref) => {
    const iconSizeClasses = {
      sm: 'p-1.5',
      md: 'p-2',
      lg: 'p-3',
    };

    return (
      <Button
        ref={ref}
        size={size}
        className={`${iconSizeClasses[size]} ${className}`}
        {...props}
      >
        {icon}
      </Button>
    );
  }
);

IconButton.displayName = 'IconButton';

export default Button;
