'use client';

import { InvitesSection } from '@/components/admin/InvitesSection';
import { UsersListSection } from '@/components/admin/UsersListSection';

/**
 * Props for {@link UsersPageContent}.
 */
export interface UsersPageContentProps {
  /** Authenticated admin user id resolved server-side from the session cookie. */
  currentUserId: string;
}

/**
 * Admin users page with user management and invite controls.
 * @param props - Component props.
 * @returns The rendered users page UI.
 */
export function UsersPageContent({ currentUserId }: UsersPageContentProps) {
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
