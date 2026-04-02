'use client';

// =============================================================================
// /signup — Registration page
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
    'bg-muted',
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
          className={`w-full rounded-xl border px-4 py-3 text-sm
            bg-background text-foreground placeholder:text-muted-foreground
            border-border
            focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary
            transition-all duration-200
            ${
              error
                ? 'border-destructive focus:ring-destructive'
                : 'hover:border-muted-foreground/50'
            }
            ${isPassword ? 'pr-11' : ''}
          `}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((p) => !p)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showPassword ? '🙈' : '👁️'}
          </button>
        )}
      </div>
      {error && <p className="flex items-center gap-1.5 text-xs text-destructive">{error}</p>}
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
  const [serverError, setServerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  useEffect(() => {
    if (searchParams.get('error')) {
      setServerError('Google sign-up failed. Please try again.');
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

  const handleSubmit = async () => {
    const errors = validate(form);
    if (Object.keys(errors).length) return setFieldErrors(errors);

    setIsLoading(true);
    setServerError('');

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        setServerError('Something went wrong.');
        return;
      }

      router.push('/dashboard');
    } catch {
      setServerError('Network error.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignup = () => {
    setIsGoogleLoading(true);
    window.location.href = '/api/auth/oauth/google';
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card text-card-foreground border border-border shadow-sm rounded-2xl p-8">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold">Create your account</h1>
            <p className="text-sm text-muted-foreground">Join VideoSphere and start sharing</p>
          </div>

          {serverError && (
            <div className="mb-5 rounded-xl bg-destructive/10 border border-destructive px-4 py-3 text-sm text-destructive">
              {serverError}
            </div>
          )}

          <div className="space-y-5">
            <InputField
              id="name"
              label="Full name"
              type="text"
              value={form.name}
              onChange={update('name')}
              error={fieldErrors.name}
            />
            <InputField
              id="email"
              label="Email"
              type="email"
              value={form.email}
              onChange={update('email')}
              error={fieldErrors.email}
            />

            <div>
              <InputField
                id="password"
                label="Password"
                type="password"
                value={form.password}
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
              onChange={update('confirmPassword')}
              error={fieldErrors.confirmPassword}
            />

            <button
              onClick={handleSubmit}
              disabled={isLoading}
              className="w-full rounded-xl px-4 py-3.5 text-sm font-semibold
                bg-primary text-primary-foreground
                hover:bg-primary/90
                transition
                disabled:opacity-60"
            >
              {isLoading ? 'Creating...' : 'Create account'}
            </button>
          </div>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <button
            onClick={handleGoogleSignup}
            disabled={isGoogleLoading}
            className="w-full border border-border bg-background text-foreground hover:bg-muted rounded-xl py-3"
          >
            {isGoogleLoading ? 'Redirecting...' : 'Sign up with Google'}
          </button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          By creating an account you agree to our{' '}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}
