'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Appwrite OAuth2 success handler.
 *
 * Appwrite only appends session params (project, key, secret) to the redirect URL
 * when the success path is exactly /auth/oauth2/success. The session cookie is
 * set on Appwrite's domain, so from localhost it's not sent (cross-origin).
 * This page receives the params, stores them in localStorage as cookieFallback
 * (so the Appwrite SDK can send X-Fallback-Cookies), then redirects to
 * /callback/google to create profile and go to dashboard.
 */
export default function OAuth2SuccessPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const key = searchParams.get('key');
    const secret = searchParams.get('secret');
    const project = searchParams.get('project');

    if (secret && typeof window !== 'undefined') {
      try {
        // SDK looks up cookieFallback['a_session_<projectId>']
        const sessionKey = key ?? (project ? `a_session_${project}` : null);
        if (sessionKey) {
          const cookieFallback: Record<string, string> = { [sessionKey]: secret };
          window.localStorage.setItem('cookieFallback', JSON.stringify(cookieFallback));
        }
      } catch (e) {
        console.error('[OAuth2Success] Failed to store session fallback', e);
        router.replace('/login?error=oauth_callback_failed');
        return;
      }
    }

    router.replace('/callback/google');
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Completing sign-in...</h1>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
      </div>
    </div>
  );
}
