import type { Metadata } from 'next';
import { UsersPageContent } from './UsersPageContent';

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
export default function UsersPage() {
  return <UsersPageContent />;
}
