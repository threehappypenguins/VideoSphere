// =============================================================================
// AUTH SESSION COOKIE (SSR)
// =============================================================================
// JWT session cookie helpers for server routes and middleware-compatible flows.
// =============================================================================

/**
 * Whether auth cookies should include the Secure attribute.
 * Browsers reject Secure cookies on plain HTTP — common for homelab LAN deploys.
 * @returns True when cookies should be marked Secure.
 */
function shouldUseSecureCookies(): boolean {
  const explicit = process.env.JWT_SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) {
    return appUrl.startsWith('https://');
  }

  return process.env.NODE_ENV === 'production';
}

/**
 * Returns the configured session cookie name.
 *
 * The optional projectId argument is kept for backward compatibility with
 * existing call sites that previously passed an auth provider project id.
 * @param projectId - Backward-compatibility argument from older call sites; ignored.
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
  const defaultMaxAgeSeconds = 60 * 60 * 24 * 7;
  const parsed = Number(process.env.JWT_SESSION_MAX_AGE_SECONDS);
  const maxAge = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : defaultMaxAgeSeconds;
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(),
    maxAge,
  };
}

/** Max-age values for TOTP "remember this device" trust cookies. */
export const TOTP_TRUST_MAX_AGE_SECONDS = {
  '30d': 60 * 60 * 24 * 30,
  '1y': 60 * 60 * 24 * 365,
} as const;

/** Supported remember-device durations for TOTP trust cookies. */
export type TotpRememberDeviceDuration = keyof typeof TOTP_TRUST_MAX_AGE_SECONDS | 'none';

/**
 * Returns the configured TOTP trust cookie name.
 * @returns Cookie name used for remembered-device TOTP bypass.
 */
export function getTotpTrustCookieName(): string {
  return process.env.TOTP_TRUST_COOKIE_NAME || 'videosphere_totp_trust';
}

/**
 * Cookie options for the TOTP trust cookie, mirroring session cookie attributes.
 * @param maxAgeSeconds - Trust duration in seconds.
 * @returns Cookie attributes for `NextResponse.cookies.set`.
 */
export function getTotpTrustCookieOptions(maxAgeSeconds: number): {
  path: string;
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  maxAge: number;
} {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(),
    maxAge: maxAgeSeconds,
  };
}

/**
 * Clears the TOTP trust cookie on a response (e.g. when switching to Google sign-in).
 * @param response - Response whose cookies should be updated.
 */
export function clearTotpTrustCookie(response: {
  cookies: {
    set: (
      name: string,
      value: string,
      options: ReturnType<typeof getTotpTrustCookieOptions>
    ) => void;
  };
}): void {
  response.cookies.set(getTotpTrustCookieName(), '', {
    ...getTotpTrustCookieOptions(0),
    maxAge: 0,
  });
}
