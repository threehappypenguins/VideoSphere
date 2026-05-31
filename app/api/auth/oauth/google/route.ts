// =============================================================================
// GET /api/auth/oauth/google
// =============================================================================
// Initiates Google OAuth2 Authorization Code flow (no external auth vendor dependency).
// =============================================================================

import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { safeRedirect } from '@/lib/safe-redirect';
import { GOOGLE_AUTH_OAUTH_STATE_COOKIE } from '@/lib/auth/google-oauth';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_AUTH_SCOPES = ['openid', 'email', 'profile'].join(' ');

function getGoogleClientId(): string | null {
  return (
    process.env.GOOGLE_CLIENT_ID ||
    process.env.GOOGLE_OAUTH_CLIENT_ID ||
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    null
  );
}

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const clientId = getGoogleClientId();
  if (!clientId) {
    console.error('[GET /api/auth/oauth/google] Missing Google OAuth client id env var');
    return NextResponse.redirect(`${origin}/login?error=oauth_initiation_failed`);
  }

  const requestedRedirect = safeRedirect(req.nextUrl.searchParams.get('redirect'));
  const csrfNonce = randomBytes(32).toString('hex');
  const cookieValue = requestedRedirect
    ? `${csrfNonce}|${encodeURIComponent(requestedRedirect)}`
    : csrfNonce;

  const callbackUrl = `${origin}/api/auth/oauth/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: GOOGLE_AUTH_SCOPES,
    state: csrfNonce,
    access_type: 'offline',
  });

  const response = NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  response.cookies.set(GOOGLE_AUTH_OAUTH_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 10,
    path: '/',
  });
  return response;
}
