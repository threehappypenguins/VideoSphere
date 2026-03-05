'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Appwrite OAuth2 success handler at /v1/auth/oauth2/success.
 * Same logic as /auth/oauth2/success; then redirects to /callback/google.
 */
export default function OAuth2SuccessV1Page() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const key = searchParams.get('key');
    const secret = searchParams.get('secret');
    const project = searchParams.get('project');

    if (secret && typeof window !== 'undefined') {
      try {
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
