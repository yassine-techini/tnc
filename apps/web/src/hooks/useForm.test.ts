import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useForm, validators } from './useForm';

describe('validators', () => {
  describe('required', () => {
    it('returns error message for empty string', () => {
      expect(validators.required('')).toBe('Ce champ est requis');
    });

    it('returns error message for undefined', () => {
      expect(validators.required(undefined)).toBe('Ce champ est requis');
    });

    it('returns error message for null', () => {
      expect(validators.required(null)).toBe('Ce champ est requis');
    });

    it('returns undefined for valid value', () => {
      expect(validators.required('test')).toBeUndefined();
    });

    it('uses custom message when provided', () => {
      expect(validators.required('', 'Requis!')).toBe('Requis!');
    });
  });

  describe('email', () => {
    it('returns error for invalid email', () => {
      expect(validators.email('not-an-email')).toBe('Email invalide');
    });

    it('returns undefined for valid email', () => {
      expect(validators.email('test@example.com')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(validators.email('')).toBeUndefined();
    });
  });

  describe('minLength', () => {
    it('returns error for short string', () => {
      const validate = validators.minLength(5);
      expect(validate('ab')).toBe('Minimum 5 caracteres');
    });

    it('returns undefined for valid length', () => {
      const validate = validators.minLength(5);
      expect(validate('abcdef')).toBeUndefined();
    });
  });

  describe('maxLength', () => {
    it('returns error for long string', () => {
      const validate = validators.maxLength(5);
      expect(validate('abcdefgh')).toBe('Maximum 5 caracteres');
    });

    it('returns undefined for valid length', () => {
      const validate = validators.maxLength(5);
      expect(validate('abc')).toBeUndefined();
    });
  });

  describe('phone', () => {
    it('returns error for invalid phone', () => {
      expect(validators.phone('123')).toBe('Numéro de téléphone invalide');
    });

    it('returns undefined for valid 8-digit phone', () => {
      expect(validators.phone('70123456')).toBeUndefined();
    });

    it('returns undefined for valid phone with country code', () => {
      expect(validators.phone('+22670123456')).toBeUndefined();
    });
  });

  describe('match', () => {
    it('returns error when values do not match', () => {
      const validate = validators.match('password', 'abc123');
      expect(validate('different')).toBe('Ne correspond pas a password');
    });

    it('returns undefined when values match', () => {
      const validate = validators.match('password', 'abc123');
      expect(validate('abc123')).toBeUndefined();
    });
  });
});

describe('useForm', () => {
  it('initializes with initial values', () => {
    const { result } = renderHook(() =>
      useForm({
        initialValues: { email: '', password: '' },
        onSubmit: vi.fn(),
      })
    );

    expect(result.current.values).toEqual({ email: '', password: '' });
    expect(result.current.errors).toEqual({});
    expect(result.current.touched).toEqual({});
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.isDirty).toBe(false);
  });

  it('setFieldValue updates value', () => {
    const { result } = renderHook(() =>
      useForm({
        initialValues: { email: '' },
        onSubmit: vi.fn(),
      })
    );

    act(() => {
      result.current.setFieldValue('email', 'test@example.com');
    });

    expect(result.current.values.email).toBe('test@example.com');
    expect(result.current.isDirty).toBe(true);
  });

  it('setFieldError sets error', () => {
    const { result } = renderHook(() =>
      useForm({
        initialValues: { email: '' },
        onSubmit: vi.fn(),
      })
    );

    act(() => {
      result.current.setFieldError('email', 'Email invalide');
    });

    expect(result.current.errors.email).toBe('Email invalide');
    expect(result.current.isValid).toBe(false);
  });

  it('setFieldTouched marks field as touched', () => {
    const { result } = renderHook(() =>
      useForm({
        initialValues: { email: '' },
        onSubmit: vi.fn(),
      })
    );

    act(() => {
      result.current.setFieldTouched('email', true);
    });

    expect(result.current.touched.email).toBe(true);
  });

  it('resetForm resets to initial state', () => {
    const { result } = renderHook(() =>
      useForm({
        initialValues: { email: '' },
        onSubmit: vi.fn(),
      })
    );

    act(() => {
      result.current.setFieldValue('email', 'test@example.com');
      result.current.setFieldError('email', 'Error');
      result.current.setFieldTouched('email', true);
    });

    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.resetForm();
    });

    expect(result.current.values.email).toBe('');
    expect(result.current.errors).toEqual({});
    expect(result.current.touched).toEqual({});
    expect(result.current.isDirty).toBe(false);
  });

  it('validateForm runs validation and sets errors', () => {
    const { result } = renderHook(() =>
      useForm({
        initialValues: { email: '' },
        validate: (values) => {
          const errors: Partial<Record<keyof typeof values, string>> = {};
          if (!values.email) {
            errors.email = 'Email requis';
          }
          return errors;
        },
        onSubmit: vi.fn(),
      })
    );

    let isValid: boolean;
    act(() => {
      isValid = result.current.validateForm();
    });

    expect(isValid!).toBe(false);
    expect(result.current.errors.email).toBe('Email requis');
  });

  it('handleSubmit calls onSubmit when valid', async () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useForm({
        initialValues: { email: 'test@example.com' },
        onSubmit,
      })
    );

    const mockEvent = {
      preventDefault: vi.fn(),
    } as unknown as React.FormEvent<HTMLFormElement>;

    await act(async () => {
      await result.current.handleSubmit(mockEvent);
    });

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith({ email: 'test@example.com' });
  });

  it('handleSubmit does not call onSubmit when validation fails', async () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useForm({
        initialValues: { email: '' },
        validate: (values) => {
          const errors: Partial<Record<keyof typeof values, string>> = {};
          if (!values.email) {
            errors.email = 'Email requis';
          }
          return errors;
        },
        onSubmit,
      })
    );

    const mockEvent = {
      preventDefault: vi.fn(),
    } as unknown as React.FormEvent<HTMLFormElement>;

    await act(async () => {
      await result.current.handleSubmit(mockEvent);
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.errors.email).toBe('Email requis');
  });
});
