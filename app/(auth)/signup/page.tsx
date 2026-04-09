'use client';

// =============================================================================
// /signup — Registration page
// =============================================================================

import { useState, useCallback, useEffect, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(form: FormState): FieldErrors {
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

// ── Sub-components ────────────────────────────────────────────────────────────

function PasswordStrengthBar({ password }: { password: string }) {
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

// ── Main Page ─────────────────────────────────────────────────────────────────

/**
 * Renders the sign up page component.
 * @returns The rendered UI output.
 */
export default function SignUpPage() {
  const router = useRouter();
  const formMessageId = 'signup-form-message';

  const [form, setForm] = useState<FormState>({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const searchParams = useSearchParams();

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // Map error codes to user-friendly messages
  const getErrorMessage = (message: string) => {
    const errorMap: Record<string, string> = {
      oauth_initiation_failed: 'Failed to start Google sign-up. Please try again.',
      oauth_missing_params: 'OAuth callback was incomplete. Please try again.',
      oauth_auth_failed: 'Failed to complete Google authentication. Please try again.',
      oauth_callback_failed: 'An error occurred during Google sign-up. Please try again.',
      oauth_failed: 'Google sign-up failed. Please try again.',
    };
    return errorMap[message] || 'An error occurred. Please try again.';
  };

  useEffect(() => {
    const error = searchParams.get('error');
    if (error) {
      setServerError(getErrorMessage(error));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [searchParams]);

  const update = useCallback(
    (field: keyof FormState) => (value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
      setServerError('');
    },
    []
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const errors = validate(form);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setServerError('');
      return;
    }

    setIsLoading(true);
    setServerError('');

    try {
      const registerPayload = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
      };

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registerPayload),
      });

      if (!res.ok) {
        const contentType = res.headers.get('content-type') ?? '';
        const statusText = res.statusText.trim();
        let message = statusText
          ? `${statusText}. Please try again.`
          : 'Something went wrong. Please try again.';

        if (contentType.includes('application/json')) {
          try {
            const data = (await res.json()) as { error?: unknown };
            if (typeof data?.error === 'string' && data.error.trim()) {
              message = data.error;
            }
          } catch {
            // Fall back to generic message when response body is invalid.
          }
        }

        setServerError(message);
        return;
      }

      router.push('/dashboard');
    } catch {
      setServerError('Network error. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignup = () => {
    setServerError('');
    setIsGoogleLoading(true);
    window.location.href = '/api/auth/oauth/google';
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground">Create your account</h1>
          <p className="mt-2 text-sm text-muted-foreground">Join VideoSphere and start sharing</p>
        </div>

        {serverError && (
          <p
            id={formMessageId}
            className="mt-6 text-sm font-medium text-destructive"
            role="alert"
            aria-live="assertive"
          >
            {serverError}
          </p>
        )}

        <form
          className="mt-8 space-y-6"
          onSubmit={handleSubmit}
          aria-describedby={serverError ? formMessageId : undefined}
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
            disabled={isLoading}
            className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Creating...' : 'Create account'}
          </button>
        </form>

        <div className="relative mt-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGoogleSignup}
          disabled={isGoogleLoading || isLoading}
          className="mt-6 w-full flex justify-center items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          {isGoogleLoading ? 'Redirecting…' : 'Sign up with Google'}
        </button>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="text-primary hover:text-primary/90">
            Sign in
          </Link>
        </p>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          By creating an account you agree to our{' '}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
