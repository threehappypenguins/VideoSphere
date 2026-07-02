/**
 * Detects OAuth refresh failures that mean the stored grant is no longer valid.
 * @param details - Provider error payload or message from a failed refresh.
 * @returns True when the user must reconnect the platform account.
 */
export function isOAuthRefreshTokenRevokedError(details: unknown): boolean {
  const text =
    typeof details === 'string' ? details : details == null ? '' : JSON.stringify(details);
  const normalized = text.toLowerCase();
  return (
    normalized.includes('invalid_grant') ||
    normalized.includes('token has been expired or revoked') ||
    normalized.includes('token has been revoked')
  );
}
