/**
 * Maps OAuth error codes to user-facing messages for auth pages.
 * @param code - Error code from query string.
 * @returns Human-readable error message.
 */
export function getOAuthErrorMessage(code: string): string {
  const errorMap: Record<string, string> = {
    oauth_initiation_failed: 'Failed to start Google sign-in. Please try again.',
    oauth_missing_params: 'OAuth callback was incomplete. Please try again.',
    oauth_auth_failed: 'Failed to complete Google authentication. Please try again.',
    oauth_callback_failed: 'An error occurred during Google sign-in. Please try again.',
    oauth_failed: 'Google sign-in failed. Please try again.',
    oauth_setup_completed: 'Setup is already complete. Sign in instead.',
    oauth_setup_invalid: 'Setup link is invalid or expired. Refresh and try again.',
    oauth_setup_failed: 'Could not complete setup with Google. Try email/password instead.',
    oauth_invite_invalid: 'Invite link is invalid or expired.',
    oauth_invite_failed: 'Could not create your account with Google. Try email/password instead.',
    oauth_registration_disabled:
      'Google sign-in is only available for existing accounts. Ask an admin for an invite link.',
  };

  return errorMap[code] || 'An error occurred. Please try again.';
}
