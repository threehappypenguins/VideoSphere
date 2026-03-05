// =============================================================================
// LOGIN PAGE
// =============================================================================
// Appwrite-based login page with email/password and Google OAuth support.
//
// Email/Password Auth:
//   - Form submission calls POST /api/auth/login
//   - Implemented by the auth team member
//
// Google OAuth:
//   - "Sign in with Google" uses Appwrite SDK createOAuth2Session().
//   - Flow: User → Google consent → Appwrite's callback (on Appwrite's domain; set in GCP)
//     → Appwrite redirects to our success URL with session params → our success page stores
//     them (cookieFallback) → our /callback/google page runs and POSTs to
//     /api/auth/callback/google to ensure a user_profiles document, then redirects to dashboard.
//   - We use custom success/callback URLs so the user lands back in our app and we can
//     create app-specific profile data; Appwrite only handles the OAuth and session.
// ==============================================================================

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const [error, setError] = useState(searchParams.get('error') || '');
  const [isLoading, setIsLoading] = useState(false);

  // Email/password login (calls POST /api/auth/login when implemented)
  const handleEmailPasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    // TODO: Implement POST /api/auth/login endpoint to actually authenticate
    console.log('Email/password login:', formData.email);
    alert('Email/password authentication is not yet implemented.');
    setIsLoading(false);
  };

  // Google OAuth login
  const handleGoogleLogin = async () => {
    try {
      // Use the Appwrite browser SDK to initiate OAuth
      const { Client, Account, OAuthProvider } = await import('appwrite');

      const client = new Client()
        .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
        .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);

      const account = new Account(client);

      // Success path must match Appwrite's default so it appends session params to the URL.
      const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      account.createOAuth2Session({
        provider: OAuthProvider.Google,
        success: new URL('/v1/auth/oauth2/success', base).toString(),
        failure: new URL('/login?error=oauth_failed', base).toString(),
      });
    } catch (err) {
      setError('Failed to initiate Google login');
      console.error(err);
    }
  };

  // Map error codes to user-friendly messages
  const getErrorMessage = (code: string) => {
    const errorMap: Record<string, string> = {
      oauth_initiation_failed: 'Failed to start Google login. Please try again.',
      oauth_missing_params: 'OAuth callback was incomplete. Please try again.',
      oauth_auth_failed: 'Failed to complete Google authentication. Please try again.',
      oauth_callback_failed: 'An error occurred during Google login. Please try again.',
    };
    return errorMap[code] || code;
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground">Welcome back</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to your VideoSphere account</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mt-6 rounded-lg border border-red-300 bg-red-50 p-4">
            <p className="text-sm text-red-700">
              {error.includes('_') ? getErrorMessage(error) : error}
            </p>
          </div>
        )}

        {/* Email/Password Form */}
        <form onSubmit={handleEmailPasswordSubmit} className="mt-8 space-y-6">
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
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              disabled={isLoading}
              className="mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-100 disabled:cursor-not-allowed"
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
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              disabled={isLoading}
              className="mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-100 disabled:cursor-not-allowed"
              placeholder="••••••••"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-primary/50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Signing in...' : 'Log in'}
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
          className="mt-6 w-full flex justify-center items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
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
