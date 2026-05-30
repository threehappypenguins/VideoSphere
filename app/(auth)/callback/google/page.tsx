'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { safeRedirect } from '@/lib/safe-redirect';

/**
 * OAuth callback page: JWT session cookie is already set by
 * GET /api/auth/oauth/callback after Google OAuth exchange.
 */
export default function GoogleCallbackPage() {
  const searchParams = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get('rd'));
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return;
    doneRef.current = true;

    const destination = redirectTo ?? '/dashboard';

    try {
      // Hard navigation avoids client-router edge cases after OAuth redirects.
      window.location.replace(destination);

      const fallbackId = window.setTimeout(() => {
        window.location.replace(`/login?redirect=${encodeURIComponent(destination)}`);
      }, 5000);

      return () => window.clearTimeout(fallbackId);
    } catch (err: unknown) {
      console.error('[GoogleCallbackPage] redirect failed', err);
      window.location.replace('/login?error=oauth_callback_failed');
    }
  }, [redirectTo]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Signing you in...</h1>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
      </div>
    </div>
  );
}
