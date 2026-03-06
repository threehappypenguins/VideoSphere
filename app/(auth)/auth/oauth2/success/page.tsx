'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Appwrite OAuth2 success handler.
 *
 * Appwrite redirects here with session params (project, key, secret) and sets
 * the session cookie on the response. We rely on that cookie only — no localStorage.
 * Same-origin (app and Appwrite on the same domain) is required for OAuth.
 * This page just redirects to /callback/google to create profile and go to dashboard.
 */
export default function OAuth2SuccessPage() {
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
