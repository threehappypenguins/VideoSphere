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

  // Google OAuth: server-side flow (admin client), same pattern as email/password
  const handleGoogleLogin = () => {
    const params = redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : '';
    window.location.href = `/api/auth/oauth/google${params}`;
  };

  // Map error codes to user-friendly messages
  const getErrorMessage = (message: string) => {
    const errorMap: Record<string, string> = {
      oauth_initiation_failed: 'Failed to start Google login. Please try again.',
      oauth_missing_params: 'OAuth callback was incomplete. Please try again.',
      oauth_auth_failed: 'Failed to complete Google authentication. Please try again.',
      oauth_callback_failed: 'An error occurred during Google login. Please try again.',
      oauth_failed: 'Google sign-in failed. Please try again.',
      oauth_registration_disabled:
        'Google sign-in is only available for existing accounts. Ask an admin for an invite link.',
    };
    return errorMap[message] || message;
  };

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

        {/* Divider */}
        <div className="relative mt-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
          </div>
        </div>

        {/* Google Sign In Button */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          className="mt-6 w-full flex justify-center items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-primary"
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
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
