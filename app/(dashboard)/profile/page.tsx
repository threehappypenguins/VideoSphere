import type { Metadata } from 'next';
import { ProfileContent } from './ProfileContent';

/**
 * Provides static page metadata for this route segment.
 */
export const metadata: Metadata = {
  title: 'Profile',
  description: 'Manage your account settings and profile.',
};

interface PageProps {
  searchParams: Promise<{ success?: string; error?: string }>;
}

/**
 * Renders the profile page component.
 * @param props - Route search params for OAuth connect/disconnect flash messages.
 * @returns The rendered UI output.
 */
export default async function ProfilePage({ searchParams }: PageProps) {
  const params = await searchParams;
  return <ProfileContent oauthSuccess={params.success ?? null} oauthError={params.error ?? null} />;
}
