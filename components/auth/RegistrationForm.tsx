'use client';

import { useState, useCallback, useRef, type FormEvent, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { scorePasswordStrength, validatePassword } from '@/lib/auth/password';
import {
  AUTH_FIELD_ERROR_CLASS,
  AUTH_FORM_ERROR_CLASS,
  authPasswordStrengthLabelClass,
} from '@/lib/auth/auth-ui-classes';

interface FormState {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

type AutoCompleteToken = 'name' | 'email' | 'new-password' | 'off';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Returns whether an element supports the Pointer Events capture API (not available in jsdom).
 * @param target - Event target to inspect.
 * @returns True when capture can be set and released on the element.
 */
function supportsPointerCapture(
  target: EventTarget | null
): target is HTMLElement & {
  setPointerCapture: (pointerId: number) => void;
  hasPointerCapture: (pointerId: number) => boolean;
  releasePointerCapture: (pointerId: number) => void;
} {
  return (
    target instanceof HTMLElement &&
    typeof target.setPointerCapture === 'function' &&
    typeof target.hasPointerCapture === 'function' &&
    typeof target.releasePointerCapture === 'function'
  );
}

/**
 * Validates name, email, password, and confirm-password fields for setup and invite registration forms.
 * @param form - Registration field values to validate.
 * @returns Field-level error messages keyed by input name; an empty object indicates the form is valid.
 */
export function validateRegistrationForm(form: FormState): FieldErrors {
  const errors: FieldErrors = {};

  if (!form.name.trim()) errors.name = 'Name is required.';

  const email = form.email.trim();

  if (!email) {
    errors.email = 'Email is required.';
  } else if (!EMAIL_RE.test(email)) {
    errors.email = 'Please enter a valid email address.';
  }

  if (!form.password) {
    errors.password = 'Password is required.';
  } else {
    const passwordError = validatePassword(form.password);
    if (passwordError) errors.password = passwordError;
  }

  if (!form.confirmPassword) {
    errors.confirmPassword = 'Please confirm your password.';
  } else if (form.password !== form.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  return errors;
}

/**
 * Renders a visual password strength indicator beneath the password field.
 * @param props - Component props.
 * @param props.password - Current password value used to compute strength.
 * @returns Strength bar and label UI, or null when the password is empty.
 */
export function PasswordStrengthBar({ password }: { password: string }) {
  const score = scorePasswordStrength(password);

  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'];

  const filledBarClass = [
    '',
    'bg-destructive',
    'bg-muted-foreground/40',
    'bg-primary/60',
    'bg-primary',
    'bg-primary',
  ] as const;

  if (!password) return null;

  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={[
              'h-1 flex-1 rounded-full transition-all duration-300',
              i <= score ? filledBarClass[score] : 'bg-muted',
            ].join(' ')}
          />
        ))}
      </div>
      <p className={authPasswordStrengthLabelClass(score)}>{labels[score]}</p>
    </div>
  );
}

function InputField({
  id,
  label,
  type,
  value,
  placeholder,
  onChange,
  error,
  autoComplete,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  error?: string;
  autoComplete?: AutoCompleteToken;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword && showPassword ? 'text' : type;
  const errorId = `${id}-error`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={inputType}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete ?? 'off'}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? errorId : undefined}
          className={`w-full rounded-lg border px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground placeholder:opacity-45 placeholder:transition-opacity placeholder:duration-200 outline-none transition-all duration-200
            focus:ring-2 focus:ring-primary focus:border-primary
            focus:placeholder:opacity-65
            ${
              error
                ? 'border-destructive bg-destructive/10 focus:ring-destructive/30 focus:border-destructive'
                : 'border-border bg-background'
            }
            ${isPassword ? 'pr-11' : ''}
          `}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((p) => !p)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} className={AUTH_FIELD_ERROR_CLASS} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Props for the shared account registration form.
 */
export interface RegistrationFormProps {
  /** Page heading shown above the form. */
  title: string;
  /** Supporting copy shown under the heading. */
  subtitle: string;
  /** Accessible id for form-level error announcements. */
  formMessageId: string;
  /** Label for the submit button. */
  submitLabel: string;
  /** Label shown while the form is submitting. */
  submittingLabel: string;
  /** Persists the validated registration payload. */
  onSubmit: (payload: { name: string; email: string; password: string }) => Promise<void>;
  /** Optional error shown above the form (e.g. OAuth callback failures). */
  externalError?: string;
  /** When true, disables the form while an external action is in progress. */
  isLoading?: boolean;
  /** Optional content rendered below the submit button (e.g. OAuth). */
  renderFooter?: (state: { formDisabled: boolean }) => ReactNode;
}

/**
 * Shared email/password registration form used by setup and invite flows.
 * @param props - Registration form configuration and submit handler.
 * @returns The rendered registration form UI.
 */
export function RegistrationForm({
  title,
  subtitle,
  formMessageId,
  submitLabel,
  submittingLabel,
  onSubmit,
  externalError = '',
  isLoading: externalLoading = false,
  renderFooter,
}: RegistrationFormProps) {
  const [form, setForm] = useState<FormState>({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suppressFooterInteraction, setSuppressFooterInteraction] = useState(false);
  const submitPressPendingRef = useRef(false);

  const update = useCallback(
    (field: keyof FormState) => (value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
      setServerError('');
    },
    []
  );

  const formDisabled = isLoading || externalLoading;
  const footerDisabled = formDisabled || suppressFooterInteraction;
  const displayError = serverError || externalError;

  const handleSubmitPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (formDisabled) return;
    submitPressPendingRef.current = true;
    setSuppressFooterInteraction(true);
    if (supportsPointerCapture(event.currentTarget)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const clearPendingSubmitPress = () => {
    submitPressPendingRef.current = false;
    setSuppressFooterInteraction(false);
  };

  const releaseSubmitPointerCapture = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (
      supportsPointerCapture(event.currentTarget) &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleSubmitPointerRelease = (event: React.PointerEvent<HTMLButtonElement>) => {
    releaseSubmitPointerCapture(event);
    if (!submitPressPendingRef.current) return;
    window.setTimeout(() => {
      if (submitPressPendingRef.current) {
        clearPendingSubmitPress();
      }
    }, 0);
  };

  const handleSubmitPointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
    releaseSubmitPointerCapture(event);
    clearPendingSubmitPress();
  };

  const handleSubmitLostPointerCapture = () => {
    if (submitPressPendingRef.current) {
      clearPendingSubmitPress();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitPressPendingRef.current = false;
    setSuppressFooterInteraction(true);

    const errors = validateRegistrationForm(form);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setServerError('');
      setSuppressFooterInteraction(false);
      return;
    }

    setIsLoading(true);
    setServerError('');

    try {
      await onSubmit({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
      });
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : 'Network error. Please check your connection.'
      );
    } finally {
      setIsLoading(false);
      setSuppressFooterInteraction(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
        </div>

        {displayError && (
          <p
            id={formMessageId}
            className={AUTH_FORM_ERROR_CLASS}
            role="alert"
            aria-live="assertive"
          >
            {displayError}
          </p>
        )}

        <form
          className="mt-8 space-y-6"
          onSubmit={handleSubmit}
          aria-describedby={displayError ? formMessageId : undefined}
        >
          <InputField
            id="name"
            label="Full name"
            type="text"
            value={form.name}
            autoComplete="name"
            onChange={update('name')}
            error={fieldErrors.name}
          />
          <InputField
            id="email"
            label="Email"
            type="email"
            value={form.email}
            autoComplete="email"
            onChange={update('email')}
            error={fieldErrors.email}
          />

          <div>
            <InputField
              id="password"
              label="Password"
              type="password"
              value={form.password}
              autoComplete="new-password"
              onChange={update('password')}
              error={fieldErrors.password}
            />
            <PasswordStrengthBar password={form.password} />
          </div>

          <InputField
            id="confirmPassword"
            label="Confirm password"
            type="password"
            value={form.confirmPassword}
            autoComplete="new-password"
            onChange={update('confirmPassword')}
            error={fieldErrors.confirmPassword}
          />

          <button
            type="submit"
            disabled={formDisabled}
            onPointerDown={handleSubmitPointerDown}
            onPointerUp={handleSubmitPointerRelease}
            onPointerCancel={handleSubmitPointerCancel}
            onLostPointerCapture={handleSubmitLostPointerCapture}
            className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {formDisabled ? submittingLabel : submitLabel}
          </button>
        </form>

        {renderFooter ? (
          <div
            className={`mt-8 ${footerDisabled ? 'opacity-60' : ''}`}
            aria-disabled={footerDisabled ? true : undefined}
          >
            {renderFooter({ formDisabled: footerDisabled })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
