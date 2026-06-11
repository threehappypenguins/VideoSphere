import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { encryptToken, decryptToken } from '@/lib/crypto/token-encryption';
import type { FacebookManagedPage } from '@/lib/platforms/facebook-oauth';

/** httpOnly cookie storing encrypted pending Facebook setup data after OAuth. */
export const FACEBOOK_SETUP_SESSION_COOKIE = 'facebook_setup_session';

/** Setup session lifetime in seconds (10 minutes). */
export const FACEBOOK_SETUP_SESSION_MAX_AGE_SECONDS = 60 * 10;

/**
 * Pending Facebook connection data stored between OAuth callback and target selection.
 * @property userId - VideoSphere user ID.
 * @property userAccessToken - Long-lived Facebook user access token.
 * @property userProfileId - Facebook user ID.
 * @property userProfileName - Facebook user display name.
 * @property pages - Managed Pages with Page access tokens.
 */
export interface FacebookSetupSession {
  userId: string;
  userAccessToken: string;
  userProfileId: string;
  userProfileName: string;
  pages: FacebookManagedPage[];
}

/**
 * Public Page metadata safe to render in the setup UI (no access tokens).
 * @property id - Page ID.
 * @property name - Page display name.
 */
export interface FacebookSetupPagePublic {
  id: string;
  name: string;
}

/**
 * Public setup session shape for client UI (no tokens).
 * @property userProfileId - Facebook user ID.
 * @property userProfileName - Facebook user display name.
 * @property pages - Managed Pages without access tokens.
 */
export interface FacebookSetupSessionPublic {
  userProfileId: string;
  userProfileName: string;
  pages: FacebookSetupPagePublic[];
}

function getSetupCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: FACEBOOK_SETUP_SESSION_MAX_AGE_SECONDS,
    path: '/',
  };
}

/**
 * Persists a Facebook setup session in an encrypted httpOnly cookie on a response.
 * @param response - Next.js response to attach the cookie to.
 * @param session - Pending setup session including tokens.
 */
export function setFacebookSetupSessionCookie(
  response: NextResponse,
  session: FacebookSetupSession
): void {
  const payload = JSON.stringify(session);
  response.cookies.set(
    FACEBOOK_SETUP_SESSION_COOKIE,
    encryptToken(payload),
    getSetupCookieOptions()
  );
}

/**
 * Clears the Facebook setup session cookie on a response.
 * @param response - Next.js response to clear the cookie on.
 */
export function clearFacebookSetupSessionCookie(response: NextResponse): void {
  response.cookies.set(FACEBOOK_SETUP_SESSION_COOKIE, '', {
    ...getSetupCookieOptions(),
    maxAge: 0,
  });
}

/**
 * Reads and decrypts the Facebook setup session from a request cookie.
 * @param req - Incoming request carrying the setup session cookie.
 * @returns Decrypted session or null when missing/invalid.
 */
export function readFacebookSetupSessionFromRequest(req: NextRequest): FacebookSetupSession | null {
  const raw = req.cookies.get(FACEBOOK_SETUP_SESSION_COOKIE)?.value;
  if (!raw) return null;
  return parseFacebookSetupSession(raw);
}

/**
 * Reads and decrypts the Facebook setup session from server component cookies().
 * @returns Decrypted session or null when missing/invalid.
 */
export async function readFacebookSetupSessionFromCookies(): Promise<FacebookSetupSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(FACEBOOK_SETUP_SESSION_COOKIE)?.value;
  if (!raw) return null;
  return parseFacebookSetupSession(raw);
}

function parseFacebookSetupSession(raw: string): FacebookSetupSession | null {
  try {
    const parsed = JSON.parse(decryptToken(raw)) as FacebookSetupSession;
    if (
      !parsed.userId ||
      !parsed.userAccessToken ||
      !parsed.userProfileId ||
      !parsed.userProfileName ||
      !Array.isArray(parsed.pages)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Strips tokens from a setup session for safe client rendering.
 * @param session - Full setup session from the encrypted cookie.
 * @returns Public session metadata without access tokens.
 */
export function toFacebookSetupSessionPublic(
  session: FacebookSetupSession
): FacebookSetupSessionPublic {
  return {
    userProfileId: session.userProfileId,
    userProfileName: session.userProfileName,
    pages: session.pages.map((page) => ({ id: page.id, name: page.name })),
  };
}
