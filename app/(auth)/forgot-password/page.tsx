'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  AUTH_FORM_ERROR_CLASS,
  AUTH_INLINE_LINK_CLASS,
  AUTH_NOTICE_PANEL_CLASS,
} from '@/lib/auth/auth-ui-classes';

const AUTH_TEXT_INPUT_CLASS =
  'mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground placeholder:opacity-45 placeholder:transition-opacity placeholder:duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary focus:placeholder:opacity-65';

/**
 * Renders the forgot-password page where users request a log-based recovery token.
 * @returns The rendered forgot-password UI.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const formMessageId = 'forgot-password-form-message';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        setError(data.error ?? 'Unable to process your request. Please try again.');
        return;
      }

      setSubmitted(true);
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground">Forgot password</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your email address to request a password reset link.
          </p>
        </div>

        {error ? (
          <p
            id={formMessageId}
            className={AUTH_FORM_ERROR_CLASS}
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            {error}
          </p>
        ) : null}

        {submitted ? (
          <div className={`mt-8 ${AUTH_NOTICE_PANEL_CLASS}`} role="status" aria-live="polite">
            <p>
              If that address is registered, a recovery link has been generated. Ask your
              administrator to check the server logs.
            </p>
            <p className="mt-4">
              <Link href="/login" className={AUTH_INLINE_LINK_CLASS}>
                Back to login
              </Link>
            </p>
          </div>
        ) : (
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="mt-8 space-y-6"
            aria-describedby={error ? formMessageId : undefined}
          >
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
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={AUTH_TEXT_INPUT_CLASS}
                placeholder="you@example.com"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? 'Submitting…' : 'Request reset link'}
            </button>

            <p className="text-center text-sm text-muted-foreground">
              <Link href="/login" className={AUTH_INLINE_LINK_CLASS}>
                Back to login
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
