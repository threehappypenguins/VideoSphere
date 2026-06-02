'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { RegistrationForm } from '@/components/auth/RegistrationForm';
import {
  AuthOAuthDivider,
  AUTH_GOOGLE_PLATFORM_ACCOUNT_NOTE,
  GoogleOAuthButton,
} from '@/components/auth/GoogleOAuthButton';
import { getOAuthErrorMessage } from '@/lib/auth/oauth-errors';

/**
 * Props for the first-run setup client page.
 */
export interface SetupPageClientProps {
  /** One-time setup token from the query string. */
  token: string;
}

/**
 * Client-side first-run admin account creation form.
 * @param props - Setup page props including the setup token.
 * @returns The rendered setup UI.
 */
export default function SetupPageClient({ token }: SetupPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [oauthError, setOauthError] = useState('');
  const [isFormLoading, setIsFormLoading] = useState(false);

  useEffect(() => {
    const error = searchParams.get('error');
    if (error) {
      setOauthError(getOAuthErrorMessage(error));
      window.history.replaceState({}, '', `/setup?token=${encodeURIComponent(token)}`);
    }
  }, [searchParams, token]);

  const handleSubmit = async (payload: { name: string; email: string; password: string }) => {
    setIsFormLoading(true);
    setOauthError('');

    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, token }),
      });

      if (!res.ok) {
        const contentType = res.headers.get('content-type') ?? '';
        let message = 'Something went wrong. Please try again.';

        if (contentType.includes('application/json')) {
          try {
            const data = (await res.json()) as { error?: unknown };
            if (typeof data?.error === 'string' && data.error.trim()) {
              message = data.error;
            }
          } catch {
            // Fall back to generic message when response body is invalid.
          }
        }

        throw new Error(message);
      }

      router.push('/dashboard');
    } finally {
      setIsFormLoading(false);
    }
  };

  return (
    <>
      <RegistrationForm
        title="Set up VideoSphere"
        subtitle="Create the first admin account for this instance"
        formMessageId="setup-form-message"
        submitLabel="Create admin account"
        submittingLabel="Creating..."
        onSubmit={handleSubmit}
        externalError={oauthError}
        isLoading={isFormLoading}
        renderFooter={({ formDisabled }) => (
          <>
            <AuthOAuthDivider />
            <div className="mt-6">
              <GoogleOAuthButton
                label="Set up with Google"
                setupToken={token}
                disabled={formDisabled}
                helperText={AUTH_GOOGLE_PLATFORM_ACCOUNT_NOTE}
              />
            </div>
          </>
        )}
      />

      <p className="pb-12 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="text-primary hover:text-primary/90">
          Sign in
        </Link>
      </p>
    </>
  );
}
