'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { InvitesSection } from '@/components/admin/InvitesSection';
import { UsersListSection } from '@/components/admin/UsersListSection';

const USERS_PAGE_PATH = '/dashboard/users';
const LOGIN_HREF = `/login?redirect=${encodeURIComponent(USERS_PAGE_PATH)}`;

/**
 * Admin users page with user management and invite controls.
 * @returns The rendered users page UI.
 */
export function UsersPageContent() {
  const router = useRouter();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [redirectingToLogin, setRedirectingToLogin] = useState(false);

  const redirectToLogin = useCallback(() => {
    setRedirectingToLogin(true);
    router.replace(LOGIN_HREF);
  }, [router]);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setSessionError(null);

    try {
      const res = await fetch('/api/auth/session', { credentials: 'include' });

      if (res.status === 401) {
        redirectToLogin();
        return;
      }

      if (!res.ok) {
        setSessionError('Unable to verify your session. Please try again.');
        return;
      }

      const session = (await res.json()) as { $id?: string };
      if (typeof session.$id !== 'string') {
        redirectToLogin();
        return;
      }

      setCurrentUserId(session.$id);
    } catch (err) {
      console.warn('[UsersPageContent] Failed to load session:', err);
      setSessionError('Unable to load your session. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [redirectToLogin]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (sessionError) {
    return (
      <div className="px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-xl border border-border bg-muted/60 px-4 py-6">
            <h1 className="text-lg font-semibold text-foreground">Unable to load users page</h1>
            <p className="mt-2 text-sm text-muted-foreground">{sessionError}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void loadSession()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Try again
              </button>
              <Link
                href={LOGIN_HREF}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!currentUserId) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {redirectingToLogin ? 'Redirecting to sign in…' : 'Session unavailable. Redirecting…'}
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-bold text-foreground">Users</h1>
        <p className="mt-2 text-muted-foreground">Manage user accounts, roles, and invite links.</p>

        <UsersListSection currentUserId={currentUserId} />
        <InvitesSection />
      </div>
    </div>
  );
}
