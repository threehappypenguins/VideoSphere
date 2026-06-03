'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { isValidEmail, normalizeEmail } from '@/lib/auth/email';
import type { UserAuthProvider } from '@/types';

interface ProfileInformationSectionProps {
  authProvider: UserAuthProvider;
  initialName: string;
  initialEmail: string;
  onProfileUpdated: (updates: { name?: string; email?: string }) => void;
}

const INPUT_CLASS =
  'mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

const READONLY_INPUT_CLASS =
  'mt-2 block w-full rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground';

/**
 * Profile name and email editing controls for the account settings page.
 * @param props - Current profile values and update callback.
 * @returns Profile information form section.
 */
export function ProfileInformationSection({
  authProvider,
  initialName,
  initialEmail,
  onProfileUpdated,
}: ProfileInformationSectionProps) {
  const [name, setName] = useState(initialName);
  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [nameLoading, setNameLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);

  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  const handleSaveName = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setNameError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError('Name cannot be empty.');
      return;
    }

    setNameLoading(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: trimmedName }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        name?: string;
      };

      if (!res.ok) {
        setNameError(data.error ?? 'Failed to save name.');
        return;
      }

      const savedName = typeof data.name === 'string' ? data.name : trimmedName;
      setName(savedName);
      onProfileUpdated({ name: savedName });
      toast.success('Name updated successfully.');
    } catch {
      setNameError('An unexpected error occurred. Please try again.');
    } finally {
      setNameLoading(false);
    }
  };

  const handleChangeEmail = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEmailError(null);

    const trimmedNew = newEmail.trim();
    const trimmedConfirm = confirmEmail.trim();

    if (!trimmedNew) {
      setEmailError('New email is required.');
      return;
    }
    if (!isValidEmail(trimmedNew)) {
      setEmailError('Please enter a valid email address.');
      return;
    }
    if (!trimmedConfirm) {
      setEmailError('Please confirm your new email address.');
      return;
    }
    if (trimmedNew !== trimmedConfirm) {
      setEmailError('Email addresses do not match.');
      return;
    }

    const normalized = normalizeEmail(trimmedNew);
    if (normalized === normalizeEmail(initialEmail)) {
      setEmailError('That is already your current email address.');
      return;
    }

    setEmailLoading(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: normalized }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        email?: string;
      };

      if (!res.ok) {
        setEmailError(data.error ?? 'Failed to change email.');
        return;
      }

      const savedEmail = typeof data.email === 'string' ? data.email : normalized;
      setNewEmail('');
      setConfirmEmail('');
      onProfileUpdated({ email: savedEmail });
      toast.success('Email updated successfully.');
    } catch {
      setEmailError('An unexpected error occurred. Please try again.');
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <section className="mt-8 rounded-xl border border-border bg-background p-6">
      <h2 className="text-xl font-semibold text-foreground">Profile Information</h2>
      <div className="mt-6 space-y-6">
        <form onSubmit={handleSaveName} className="max-w-md space-y-4">
          <div>
            <label htmlFor="profile-name" className="block text-sm font-medium text-foreground">
              Full name
            </label>
            <input
              type="text"
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className={INPUT_CLASS}
            />
          </div>

          {nameError ? (
            <p className="text-sm text-destructive" role="alert">
              {nameError}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={nameLoading}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {nameLoading ? 'Saving…' : 'Save name'}
          </button>
        </form>

        {authProvider === 'google' ? (
          <div>
            <label htmlFor="profile-email" className="block text-sm font-medium text-foreground">
              Email address
            </label>
            <input
              type="email"
              id="profile-email"
              value={initialEmail}
              readOnly
              className={READONLY_INPUT_CLASS}
            />
            <p className="mt-2 text-sm text-muted-foreground">
              Your email is managed by your Google sign-in. To change it, disconnect Google in the{' '}
              <a
                href="#profile-sign-in-method"
                className="text-primary underline underline-offset-2"
              >
                Sign-in method
              </a>{' '}
              section below.
            </p>
          </div>
        ) : (
          <div className="max-w-md space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground">Email address</p>
              <p className="mt-1 text-sm text-muted-foreground">{initialEmail}</p>
            </div>

            <div className="border-t border-border pt-4">
              <h3 className="text-sm font-medium text-foreground">Change email</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter your new email address twice to confirm the change.
              </p>

              <form onSubmit={handleChangeEmail} className="mt-4 space-y-4">
                <div>
                  <label
                    htmlFor="profile-new-email"
                    className="block text-sm font-medium text-foreground"
                  >
                    New email address
                  </label>
                  <input
                    type="email"
                    id="profile-new-email"
                    autoComplete="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="new@example.com"
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label
                    htmlFor="profile-confirm-email"
                    className="block text-sm font-medium text-foreground"
                  >
                    Confirm new email address
                  </label>
                  <input
                    type="email"
                    id="profile-confirm-email"
                    autoComplete="email"
                    value={confirmEmail}
                    onChange={(e) => setConfirmEmail(e.target.value)}
                    placeholder="new@example.com"
                    className={INPUT_CLASS}
                  />
                </div>

                {emailError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {emailError}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={emailLoading}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {emailLoading ? 'Saving…' : 'Change email'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
