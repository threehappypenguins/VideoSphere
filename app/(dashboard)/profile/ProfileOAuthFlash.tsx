'use client';

import { FlashMessage } from './connections/FlashMessage';
import { getOAuthErrorMessage } from '@/lib/auth/oauth-errors';

interface ProfileOAuthFlashProps {
  success: string | null;
  error: string | null;
}

/**
 * Renders OAuth connect/disconnect feedback from query params supplied by the profile page.
 * Uses {@link FlashMessage}, which strips `success` and `error` from the URL on mount so a
 * full page reload will not show the banner again.
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
