// =============================================================================
// LOGIN PAGE
// =============================================================================
// User authentication via email and password using Appwrite SDK.
// On successful login, creates a session and redirects to /dashboard.
//
// User Story: UA-01 — Users can register with email and password via Appwrite Auth.
// The login represents the sign-in flow for registered users.
//
// Implementation: Uses the Appwrite browser SDK directly.
// Reference: https://appwrite.io/docs/references/web/client-web/auth
// =============================================================================

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { loginWithEmail } from '@/lib/auth-client';

interface LoginState {
  email: string;
  password: string;
}

interface ErrorState {
  message: string;
  type: 'error' | 'success';
}

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState<LoginState>({
    email: '',
    password: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // Call Appwrite SDK to create session
      await loginWithEmail(formData.email, formData.password);

      // Show success message
      setError({
        message: 'Login successful! Redirecting to dashboard...',
        type: 'success',
      });

      // Redirect to dashboard after brief delay to show success message
      setTimeout(() => {
        router.push('/dashboard');
      }, 1000);
    } catch (err) {
      // Handle login error
      const message = err instanceof Error ? err.message : 'An error occurred during login';
      setError({
        message,
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground">Welcome back</h1>
          <p className="mt-2 text-sm text-muted-foreground">Log in to your VideoSphere account</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          {/* Error/Success Message */}
          {error && (
            <div
              className={`rounded-lg px-4 py-3 text-sm font-medium ${
                error.type === 'error'
                  ? 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-400'
                  : 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-400'
              }`}
              role="alert"
            >
              {error.message}
            </div>
          )}

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
              className="mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="you@example.com"
            />
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-foreground">
              Password
            </label>
            <input
              type="password"
              id="password"
              name="password"
              autoComplete="current-password"
              required
              disabled={isLoading}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="••••••••"
            />
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

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="font-medium text-primary hover:text-primary/90">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
