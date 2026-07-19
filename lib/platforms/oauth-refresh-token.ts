/**
 * Helpers for OAuth refresh-token values returned by providers.
 */

/**
 * Returns the first non-empty refresh token among the candidates.
 * Providers may omit `refresh_token` or return `""`; callers must not treat
 * empty strings as a new grant that should overwrite a stored token.
 * @param candidates - Candidate refresh token values in priority order.
 * @returns The first trimmed non-empty value, or `''` when none are usable.
 */
export function coalesceOAuthRefreshToken(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}
