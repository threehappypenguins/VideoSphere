// =============================================================================
// PROFILE PAGE
// =============================================================================
// User account settings and profile information.
// Displays real subscription status and handles the ?upgrade=success redirect
// from Stripe Checkout.
// =============================================================================

import type { Metadata } from 'next';
import { ProfileContent } from './ProfileContent';

export const metadata: Metadata = {
  title: 'Profile',
  description: 'Manage your account settings and profile.',
};

export default function ProfilePage() {
  return <ProfileContent />;
}
