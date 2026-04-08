import type { Metadata } from 'next';
import { ProfileContent } from './ProfileContent';

/**
 * Provides static page metadata for this route segment.
 */
export const metadata: Metadata = {
  title: 'Profile',
  description: 'Manage your account settings and profile.',
};

/**
 * Renders the profile page component.
 * @returns The rendered UI output.
 */
export default function ProfilePage() {
  return <ProfileContent />;
}
