'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RegistrationForm } from '@/components/auth/RegistrationForm';

/**
 * Props for the invite signup client page.
 */
export interface InviteSignupClientProps {
  /** Single-use invite token from the URL path. */
  token: string;
}

/**
 * Client-side invite registration form.
 * @param props - Invite signup props including the invite token.
 * @returns The rendered invite signup UI.
 */
export default function InviteSignupClient({ token }: InviteSignupClientProps) {
  const router = useRouter();

  const handleSubmit = async (payload: { name: string; email: string; password: string }) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, inviteToken: token }),
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
  };

  return (
    <>
      <RegistrationForm
        title="Create your account"
        subtitle="You were invited to join VideoSphere"
        formMessageId="invite-form-message"
        submitLabel="Create account"
        submittingLabel="Creating..."
        onSubmit={handleSubmit}
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
