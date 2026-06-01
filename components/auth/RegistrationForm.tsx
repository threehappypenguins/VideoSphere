'use client';

import { useState, useCallback, type FormEvent, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';

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
 * Validates name, email, password, and confirm-password fields for setup and invite registration forms.
 * @param form - Registration field values to validate.
 * @returns Field-level error messages keyed by input name; an empty object indicates the form is valid.
 */
export function validateRegistrationForm(form: FormState): FieldErrors {
  const errors: FieldErrors = {};

  if (!form.name.trim()) errors.name = 'Name is required.';

  if (!form.email.trim()) {
    errors.email = 'Email is required.';
  } else if (!EMAIL_RE.test(form.email)) {
    errors.email = 'Please enter a valid email address.';
  }

  if (!form.password) {
    errors.password = 'Password is required.';
  } else if (form.password.length < 8) {
    errors.password = 'Password must be at least 8 characters.';
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
  const score = (() => {
    if (!password) return 0;
    let s = 0;
    if (password.length >= 8) s++;
    if (password.length >= 12) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  })();

  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'];

  const filledBarClass = [
    '',
    'bg-destructive',
    'bg-muted-foreground/40',
    'bg-primary/60',
    'bg-primary',
    'bg-primary',
  ] as const;

  const labelClass = [
    '',
    'text-destructive',
    'text-muted-foreground',
    'text-foreground',
    'text-primary',
    'text-primary',
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
      <p className={`text-xs ${labelClass[score]}`}>{labels[score]}</p>
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
        <p id={errorId} className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
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
  footer?: ReactNode;
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
  footer,
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

  const update = useCallback(
    (field: keyof FormState) => (value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
      setServerError('');
    },
    []
  );

  const formDisabled = isLoading || externalLoading;
  const displayError = serverError || externalError;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const errors = validateRegistrationForm(form);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setServerError('');
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
            className="mt-6 text-sm font-medium text-destructive"
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
            className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {formDisabled ? submittingLabel : submitLabel}
          </button>
        </form>

        {footer ? <div className="mt-6">{footer}</div> : null}
      </div>
    </div>
  );
}
