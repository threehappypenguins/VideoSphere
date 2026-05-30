// =============================================================================
// AUTH SESSION COOKIE (SSR)
// =============================================================================
// JWT session cookie helpers for server routes and middleware-compatible flows.
// =============================================================================

/**
 * Returns the configured session cookie name.
 *
 * The optional projectId argument is kept for backward compatibility with
 * existing call sites that previously passed Appwrite project id.
 * @returns The computed result.
 */
export function getSessionCookieName(projectId?: string): string {
  void projectId;
  return process.env.JWT_SESSION_COOKIE_NAME || 'videosphere_session';
}

/**
 * Executes get session cookie options.
 * @returns The computed result.
 */
export function getSessionCookieOptions(): {
  path: string;
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  maxAge: number;
} {
  const isProduction = process.env.NODE_ENV === 'production';
  const defaultMaxAgeSeconds = 60 * 60 * 24 * 7;
  const parsed = Number(process.env.JWT_SESSION_MAX_AGE_SECONDS);
  const maxAge = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : defaultMaxAgeSeconds;
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge,
  };
}
