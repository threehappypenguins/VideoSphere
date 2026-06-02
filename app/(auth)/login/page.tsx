// =============================================================================
// LOGIN PAGE
// =============================================================================
// Email/password: POST /api/auth/login sets session cookie server-side (SSR, no localStorage).
// Google OAuth: initiated via GET /api/auth/oauth/google (server); httpOnly session cookie
//   set in GET /api/auth/oauth/callback, then redirect directly to safe ?redirect or /dashboard.
//
// Email/Password Auth:
//   - Form submission POSTs to /api/auth/login; on success, redirects to ?redirect or /dashboard.
//
// Google OAuth:
//   - "Sign in with Google" navigates to /api/auth/oauth/google (server redirects to Google).
//   - Works for both existing users and new users: callback upserts user_profiles in MongoDB.
//   - Flow: User → Google consent → our /api/auth/oauth/callback (sets JWT cookie)
//     → safe ?redirect or /dashboard.
// =============================================================================

'use client';

import { useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { safeRedirect } from '@/lib/safe-redirect';
import { AuthOAuthDivider, GoogleOAuthButton } from '@/components/auth/GoogleOAuthButton';
import { getOAuthErrorMessage } from '@/lib/auth/oauth-errors';

interface LoginState {
  email: string;
  password: string;
}

interface ErrorState {
  message: string;
  type: 'error' | 'success';
}

const AUTH_TEXT_INPUT_CLASS =
  'mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground placeholder:opacity-45 placeholder:transition-opacity placeholder:duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary focus:placeholder:opacity-65';

/**
 * Renders the login page component.
 * @returns The rendered UI output.
 */
export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get('redirect'));
  const formMessageId = 'login-form-message';

  const [formData, setFormData] = useState<LoginState>({
    email: '',
    password: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<ErrorState | null>(() => {
    const urlError = searchParams.get('error');
    return urlError ? { message: urlError, type: 'error' } : null;
  });
  const submitHandledRef = useRef(false);

  // Email/password login via server (session cookie set by API; no localStorage)
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitHandledRef.current) return;
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
        }),
        credentials: 'include',
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        setError({
          message: data?.error ?? 'Invalid email or password.',
          type: 'error',
        });
        return;
      }

      if (submitHandledRef.current) return;
      submitHandledRef.current = true;
      setError({
        message: 'Login successful! Redirecting...',
        type: 'success',
      });
      setTimeout(() => router.push(redirectTo ?? '/dashboard'), 1000);
    } catch {
      setError({ message: 'An error occurred during login.', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const getErrorMessage = (message: string) =>
    message.startsWith('oauth_') ? getOAuthErrorMessage(message) : message;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground">Welcome back</h1>
          <p className="mt-2 text-sm text-muted-foreground">Log in to your VideoSphere account</p>
        </div>

        {/* Error Message */}
        {error?.type === 'error' && (
          <p
            id={formMessageId}
            className="mt-6 text-sm font-medium text-red-600 dark:text-red-400"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            {getErrorMessage(error.message)}
          </p>
        )}

        {/* Success Message */}
        {error?.type === 'success' && (
          <p
            id={formMessageId}
            className="mt-6 text-sm font-medium text-green-600 dark:text-green-400"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {error.message}
          </p>
        )}

        {/* Email/Password Form */}
        <form
          onSubmit={handleSubmit}
          className="mt-8 space-y-6"
          aria-describedby={error ? formMessageId : undefined}
        >
          {/* Email */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground">
              Email address
            </label>
            <input
              type="email"
              id="email"
              name="email"
              autoComplete="email"
              required
              disabled={isLoading}
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className={AUTH_TEXT_INPUT_CLASS}
              placeholder="you@example.com"
            />
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-foreground">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                name="password"
                autoComplete="current-password"
                required
                disabled={isLoading}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className={`${AUTH_TEXT_INPUT_CLASS} pr-11`}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                aria-controls="password"
                disabled={isLoading}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Logging in...' : 'Log in'}
          </button>
        </form>

        <AuthOAuthDivider />
        <div className="mt-6">
          <GoogleOAuthButton
            label="Sign in with Google"
            redirectTo={redirectTo}
            disabled={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
