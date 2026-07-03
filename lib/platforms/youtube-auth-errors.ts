/** User-facing reconnect guidance for expired or revoked YouTube OAuth sessions. */
export const YOUTUBE_RECONNECT_MESSAGE =
  'Your YouTube connection expired. Reconnect your YouTube account in Settings → Connections.';

/**
 * Returns true when YouTube Data API output indicates invalid or expired OAuth credentials.
 * @param details - Upstream error message or response body text.
 * @returns Whether the failure is an OAuth credential problem.
 */
export function isYouTubeAuthCredentialsError(details: string): boolean {
  const normalized = details.toLowerCase();

  return (
    normalized.includes('invalid authentication credentials') ||
    normalized.includes('invalid credentials') ||
    normalized.includes('access token has been expired') ||
    normalized.includes('access token has expired') ||
    normalized.includes('request had invalid authentication credentials')
  );
}
