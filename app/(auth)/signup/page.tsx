'use client';

// =============================================================================
// /signup — Registration page
// =============================================================================
// Renders an email + password + confirm-password form.
// Validates client-side, calls POST /api/auth/register, then redirects to
// /dashboard on success or shows an inline error on failure.
// =============================================================================

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

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

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {};

  if (!form.name.trim()) {
    errors.name = 'Name is required.';
  }

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

  // Tailwind classes keyed by score — no hard-coded hex values.
  // Empty segments use muted/border tokens so they adapt in dark mode.
  const filledBarClass = [
    '',
    'bg-red-500', // 1 – Weak
    'bg-orange-500', // 2 – Fair
    'bg-yellow-500', // 3 – Good
    'bg-green-500', // 4 – Strong
    'bg-emerald-500', // 5 – Very strong
  ] as const;

  const labelClass = [
    '',
    'text-red-500',
    'text-orange-500',
    'text-yellow-700 dark:text-yellow-400',
    'text-green-500',
    'text-emerald-500',
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
  autoComplete?: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword && showPassword ? 'text' : type;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={inputType}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg border px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground placeholder:transition-opacity placeholder:duration-200 outline-none transition-all duration-200
            focus:ring-2 focus:ring-primary focus:border-primary
            focus:placeholder:opacity-50
            ${
              error
                ? 'border-red-400 bg-red-50 dark:bg-red-950 focus:ring-red-300/30 focus:border-red-400'
                : 'border-border bg-background'
            }
            ${isPassword ? 'pr-11' : ''}
          `}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((p) => !p)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              // eye-off icon
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              // eye icon
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        )}
      </div>
      {error && (
        <p className="flex items-center gap-1.5 text-xs text-red-600">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SignUpPage() {
  const router = useRouter();

  const [form, setForm] = useState<FormState>({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const searchParams = useSearchParams();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState(() => {
    const err = searchParams.get('error');
    return err === 'oauth_failed'
      ? 'Google sign-up was cancelled or failed. Please try again.'
      : '';
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // Clear URL error param from address bar without adding history entry
  useEffect(() => {
    if (searchParams.get('error')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [searchParams]);

  const update = useCallback(
    (field: keyof FormState) => (value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      // Clear the error for this field as user types
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
      setServerError('');
    },
    []
  );

  const handleSubmit = async () => {
    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsLoading(true);
    setServerError('');

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          password: form.password,
        }),
      });

      const contentType = res.headers.get('content-type');
      let data: any = null;

      if (contentType && contentType.includes('application/json')) {
        try {
          data = await res.json();
        } catch {
          // Ignore JSON parse errors; fall back to a generic message below.
        }
      }

      if (!res.ok) {
        const messageFromBody =
          data && typeof data === 'object' && typeof (data as any).error === 'string'
            ? (data as any).error
            : undefined;

        const fallbackMessage =
          res.statusText && res.statusText !== 'OK'
            ? res.statusText
            : 'Something went wrong. Please try again.';

        setServerError(messageFromBody ?? fallbackMessage);
        return;
      }

      // Session cookie is set by the API (server-side; no localStorage).
      router.push('/dashboard');
    } catch {
      setServerError('Network error. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Sign up with Google: server-side OAuth (admin client), same as login
  const handleGoogleSignup = () => {
    setServerError('');
    setIsGoogleLoading(true);
    window.location.href = '/api/auth/oauth/google';
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground">Create your account</h1>
          <p className="mt-2 text-sm text-muted-foreground">Join VideoSphere and start sharing</p>
        </div>

        {/* Server-level error banner */}
        {serverError && (
          <p className="mt-6 text-sm font-medium text-red-600 dark:text-red-400" role="alert">
            {serverError}
          </p>
        )}

        {/* Form */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
          className="mt-8 space-y-6"
        >
          <InputField
            id="name"
            label="Full name"
            type="text"
            value={form.name}
            placeholder="Jane Smith"
            onChange={update('name')}
            error={fieldErrors.name}
            autoComplete="name"
          />

          <InputField
            id="email"
            label="Email address"
            type="email"
            value={form.email}
            placeholder="jane@example.com"
            onChange={update('email')}
            error={fieldErrors.email}
            autoComplete="email"
          />

          <div>
            <InputField
              id="password"
              label="Password"
              type="password"
              value={form.password}
              placeholder="Min. 8 characters"
              onChange={update('password')}
              error={fieldErrors.password}
              autoComplete="new-password"
            />
            <PasswordStrengthBar password={form.password} />
          </div>

          <InputField
            id="confirmPassword"
            label="Confirm password"
            type="password"
            value={form.confirmPassword}
            placeholder="Re-enter your password"
            onChange={update('confirmPassword')}
            error={fieldErrors.confirmPassword}
            autoComplete="new-password"
          />

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="animate-spin"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Creating account…
              </span>
            ) : (
              'Create account'
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="relative mt-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
          </div>
        </div>

        {/* Sign up with Google */}
        <button
          type="button"
          onClick={handleGoogleSignup}
          disabled={isGoogleLoading || isLoading}
          className="mt-6 w-full flex justify-center items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
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

        {/* Sign in link */}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary hover:text-primary/90">
            Sign in
          </Link>
        </p>

        {/* Fine print */}
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
