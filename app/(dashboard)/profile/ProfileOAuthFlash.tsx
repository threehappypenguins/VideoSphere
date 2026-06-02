'use client';

import { FlashMessage } from './connections/FlashMessage';
import { getOAuthErrorMessage } from '@/lib/auth/oauth-errors';

interface ProfileOAuthFlashProps {
  success: string | null;
  error: string | null;
}

/**
 * Renders one-time OAuth connect/disconnect feedback from query params.
 * @param props - Success and error codes from the profile page URL.
 * @returns Flash banner or null when no message applies.
 */
export function ProfileOAuthFlash({ success, error }: ProfileOAuthFlashProps) {
  if (success === 'google_connected') {
    return <FlashMessage type="success" message="Google sign-in connected successfully." />;
  }

  if (error) {
    const message = error.startsWith('oauth_')
      ? getOAuthErrorMessage(error)
      : 'Something went wrong. Please try again.';
    return <FlashMessage type="error" message={message} />;
  }

  return null;
}
