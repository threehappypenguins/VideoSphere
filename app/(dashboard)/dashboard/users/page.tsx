import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUserIdFromCookies } from '@/lib/auth/get-current-user-id-from-cookies';
import { UsersPageContent } from './UsersPageContent';

const USERS_PAGE_PATH = '/dashboard/users';

/**
 * Provides static page metadata for this route segment.
 */
export const metadata: Metadata = {
  title: 'Users',
  description: 'Manage users, roles, and invite links.',
};

/**
 * Renders the admin users page.
 * @returns The rendered UI output.
 */
export default async function UsersPage() {
  const currentUserId = await getCurrentUserIdFromCookies();
  if (!currentUserId) {
    redirect(`/login?redirect=${encodeURIComponent(USERS_PAGE_PATH)}`);
  }

  return <UsersPageContent currentUserId={currentUserId} />;
}
