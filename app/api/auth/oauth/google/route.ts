import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  GOOGLE_AUTH_OAUTH_STATE_COOKIE,
  buildGoogleOAuthErrorRedirect,
  buildGoogleOAuthStateCookie,
} from '@/lib/auth/google-oauth';
import { safeRedirect } from '@/lib/safe-redirect';

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
 * @returns Redirect to Google OAuth consent screen.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const setupToken = req.nextUrl.searchParams.get('setupToken')?.trim() || null;
  const inviteToken = req.nextUrl.searchParams.get('inviteToken')?.trim() || null;
  const redirectTo = safeRedirect(req.nextUrl.searchParams.get('redirect'));
  const oauthContext = { setupToken, inviteToken };

  const clientId = getGoogleClientId();
  if (!clientId) {
    console.error('[GET /api/auth/oauth/google] Missing Google OAuth client id env var');
    return NextResponse.redirect(
      buildGoogleOAuthErrorRedirect(origin, 'oauth_initiation_failed', oauthContext)
    );
  }

  if (setupToken && inviteToken) {
    return NextResponse.redirect(
      buildGoogleOAuthErrorRedirect(origin, 'oauth_initiation_failed', oauthContext)
    );
  }

  const csrfNonce = randomBytes(32).toString('hex');
  const cookieValue = buildGoogleOAuthStateCookie({
    nonce: csrfNonce,
    redirectTo,
    setupToken,
    inviteToken,
  });

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
