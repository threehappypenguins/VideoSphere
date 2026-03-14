// =============================================================================
// SAFE REDIRECT HELPER
// =============================================================================
// Validates a redirect destination to prevent open-redirect attacks.
// Only relative paths that start with "/" (but not "//", which the browser
// would treat as protocol-relative) are considered safe.
// Returns the destination if safe, or null otherwise (fall back to default).
// =============================================================================

/**
 * Returns `destination` if it is a safe same-origin relative path, null otherwise.
 *
 * Safe examples:  /dashboard, /profile/connections
 * Unsafe examples: //evil.com, https://evil.com, javascript:alert(1)
 */
export function safeRedirect(destination: string | null | undefined): string | null {
  if (!destination) return null;
  if (destination.startsWith('/') && !destination.startsWith('//')) return destination;
  return null;
}
