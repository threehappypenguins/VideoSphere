import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  GOOGLE_AUTH_OAUTH_STATE_COOKIE,
  buildGoogleOAuthErrorRedirect,
  buildGoogleOAuthStateCookie,
} from '@/lib/auth/google-oauth';
import { getAuthenticatedSessionUserId } from '@/lib/api/auth';
import { getUserById } from '@/lib/repositories/users';

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
 * Initiates Google OAuth to link a Google account to the logged-in password user.
 * @param req - The incoming request object.
 * @returns Redirect to Google OAuth consent screen.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;

  const userId = await getAuthenticatedSessionUserId(req);
  if (!userId) {
    return NextResponse.redirect(
      buildGoogleOAuthErrorRedirect(origin, 'oauth_initiation_failed', { connect: true })
    );
  }

  const profile = await getUserById(userId);
  if (!profile) {
    return NextResponse.redirect(
      buildGoogleOAuthErrorRedirect(origin, 'oauth_initiation_failed', { connect: true })
    );
  }

  if (profile.authProvider === 'google') {
    return NextResponse.redirect(
      buildGoogleOAuthErrorRedirect(origin, 'oauth_connect_already_linked', { connect: true })
    );
  }

  const clientId = getGoogleClientId();
  if (!clientId) {
    console.error('[GET /api/auth/oauth/connect] Missing Google OAuth client id env var');
    return NextResponse.redirect(
      buildGoogleOAuthErrorRedirect(origin, 'oauth_initiation_failed', { connect: true })
    );
  }

  const csrfNonce = randomBytes(32).toString('hex');
  const cookieValue = buildGoogleOAuthStateCookie({
    nonce: csrfNonce,
    flow: 'connect',
    userId,
    redirectTo: '/profile?success=google_connected',
  });

  const callbackUrl = `${origin}/api/auth/oauth/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: GOOGLE_AUTH_SCOPES,
    state: csrfNonce,
    access_type: 'offline',
    prompt: 'consent',
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
