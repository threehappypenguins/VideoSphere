'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Appwrite OAuth2 success handler at /v1/auth/oauth2/success.
 * Session is established via cookie set by Appwrite (same-origin required).
 * Redirects to /callback/google to create profile and go to dashboard.
 */
export default function OAuth2SuccessV1Page() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/callback/google');
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Completing sign-in...</h1>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
      </div>
    </div>
  );
}
