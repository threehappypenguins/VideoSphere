import type { Metadata } from 'next';
import { ProfileContent } from './ProfileContent';

export const metadata: Metadata = {
  title: 'Profile',
  description: 'Manage your account settings and profile.',
};

export default function ProfilePage() {
  return <ProfileContent />;
}
