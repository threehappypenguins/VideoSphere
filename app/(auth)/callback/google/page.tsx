'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { clearCookieFallback } from '@/lib/auth-client';
import { safeRedirect } from '@/lib/safe-redirect';

/**
 * OAuth callback page: session cookie was already set by GET /api/auth/oauth/callback.
 * We get the user via our API (server forwards cookie to Appwrite) so the cookie
 * is sent to our origin only, not cross-origin to Appwrite.
 */
export default function GoogleCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get('rd'));
  const [error, setError] = useState<string | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const handleCallback = async () => {
      if (doneRef.current) return;
      doneRef.current = true;
      try {
        const sessionRes = await fetch('/api/auth/session', { credentials: 'include' });
        if (!sessionRes.ok) {
          setError('Session not found. Please try signing in again.');
          setTimeout(() => router.push('/login?error=oauth_callback_failed'), 3000);
          return;
        }
        const user = await sessionRes.json();

        const response = await fetch('/api/auth/callback/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.$id, email: user.email }),
        });

        const data = await response.json();
        if (!response.ok) {
          setError(data.error || 'Failed to create user profile');
          return;
        }
        clearCookieFallback();
        router.push(redirectTo ?? '/dashboard');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(`Authentication failed: ${message}`);
        setTimeout(() => router.push('/login?error=oauth_callback_failed'), 5000);
      }
    };
    handleCallback();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        {error ? (
          <>
            <h1 className="text-xl font-bold text-red-600 mb-4">Authentication Error</h1>
            <p className="text-gray-600 mb-4">{error}</p>
            <p className="text-sm text-gray-500">Redirecting to login...</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-4">Signing you in...</h1>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          </>
        )}
      </div>
    </div>
  );
}
