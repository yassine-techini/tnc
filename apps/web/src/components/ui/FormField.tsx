import { ReactNode, InputHTMLAttributes, forwardRef, useId } from 'react';

export interface FormFieldProps {
  label?: string;
  error?: string;
  helperText?: string;
  required?: boolean;
  children?: ReactNode;
}

export function FormField({
  label,
  error,
  helperText,
  required,
  children,
}: FormFieldProps) {
  const id = useId();

  return (
    <div className="space-y-1.5">
      {label && (
        <label
          htmlFor={id}
          className="block text-sm font-medium text-slate-300"
        >
          {label}
          {required && <span className="text-red-400 ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        {children}
      </div>
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      {helperText && !error && (
        <p className="text-sm text-slate-500">{helperText}</p>
      )}
    </div>
  );
}

// Input component with FormField integration
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftAddon?: ReactNode;
  rightAddon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      required,
      leftAddon,
      rightAddon,
      className = '',
      ...props
    },
    ref
  ) => {
    const id = useId();
    const inputId = props.id || id;

    const inputClasses = `
      w-full px-4 py-3 bg-slate-800 border rounded-lg
      text-white placeholder-slate-400
      focus:outline-none focus:ring-2 focus:border-transparent
      transition-all duration-200
      ${error ? 'border-red-500 focus:ring-red-500' : 'border-slate-700 focus:ring-gold-500'}
      ${leftAddon ? 'pl-12' : ''}
      ${rightAddon ? 'pr-12' : ''}
      ${className}
    `.trim();

    return (
      <div className="space-y-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-slate-300"
          >
            {label}
            {required && <span className="text-red-400 ml-1">*</span>}
          </label>
        )}
        <div className="relative">
          {leftAddon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              {leftAddon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={inputClasses}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
            {...props}
          />
          {rightAddon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              {rightAddon}
            </div>
          )}
        </div>
        {error && (
          <p id={`${inputId}-error`} className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={`${inputId}-helper`} className="text-sm text-slate-500">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

// Select component
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  options: Array<{ value: string; label: string }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      error,
      helperText,
      required,
      options,
      className = '',
      ...props
    },
    ref
  ) => {
    const id = useId();
    const selectId = props.id || id;

    const selectClasses = `
      w-full px-4 py-3 bg-slate-800 border rounded-lg
      text-white
      focus:outline-none focus:ring-2 focus:border-transparent
      transition-all duration-200 appearance-none cursor-pointer
      ${error ? 'border-red-500 focus:ring-red-500' : 'border-slate-700 focus:ring-gold-500'}
      ${className}
    `.trim();

    return (
      <div className="space-y-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className="block text-sm font-medium text-slate-300"
          >
            {label}
            {required && <span className="text-red-400 ml-1">*</span>}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={selectClasses}
            aria-invalid={!!error}
            {...props}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p className="text-sm text-slate-500">{helperText}</p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';

// Textarea component
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      error,
      helperText,
      required,
      className = '',
      ...props
    },
    ref
  ) => {
    const id = useId();
    const textareaId = props.id || id;

    const textareaClasses = `
      w-full px-4 py-3 bg-slate-800 border rounded-lg
      text-white placeholder-slate-400
      focus:outline-none focus:ring-2 focus:border-transparent
      transition-all duration-200 resize-none
      ${error ? 'border-red-500 focus:ring-red-500' : 'border-slate-700 focus:ring-gold-500'}
      ${className}
    `.trim();

    return (
      <div className="space-y-1.5">
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-sm font-medium text-slate-300"
          >
            {label}
            {required && <span className="text-red-400 ml-1">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={textareaClasses}
          aria-invalid={!!error}
          {...props}
        />
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p className="text-sm text-slate-500">{helperText}</p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

export default FormField;
