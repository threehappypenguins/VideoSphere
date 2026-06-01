'use client';

import { useEffect, useState } from 'react';
import { InvitesSection } from '@/components/admin/InvitesSection';
import { UsersListSection } from '@/components/admin/UsersListSection';

/**
 * Admin users page with user management and invite controls.
 * @returns The rendered users page UI.
 */
export function UsersPageContent() {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch('/api/auth/session', { credentials: 'include' });
        if (res.ok) {
          const session = (await res.json()) as { $id?: string };
          if (typeof session.$id === 'string') {
            setCurrentUserId(session.$id);
          }
        }
      } catch (err) {
        console.warn('[UsersPageContent] Failed to load session:', err);
      } finally {
        setLoading(false);
      }
    }

    void loadSession();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!currentUserId) return null;

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
