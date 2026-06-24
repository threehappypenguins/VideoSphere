// =============================================================================
// GET /api/platforms/connect/facebook
// =============================================================================
// Initiates the Facebook OAuth connection flow. Verifies the user's JWT
// session, builds the Facebook Login consent URL, generates a random CSRF
// nonce for the `state` parameter (stored in a short-lived httpOnly cookie),
// then redirects the browser to Facebook's consent screen.
//
// Required env vars: FACEBOOK_APP_ID
// Callback URL: http://localhost:9624/api/platforms/callback/facebook
// =============================================================================

import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAppBaseUrl } from '@/lib/app-port';
import { getSessionCookieOptions } from '@/lib/auth-session-cookie';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { FACEBOOK_OAUTH_STATE_COOKIE } from '@/lib/platforms/oauth-state-cookies';
import {
  FACEBOOK_OAUTH_DIALOG_URL,
  FACEBOOK_SCOPES,
  getFacebookAppId,
  getFacebookRedirectUri,
} from '@/lib/platforms/facebook-oauth';

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns Redirect to Facebook OAuth consent or failure URL.
 */
export async function GET(req: NextRequest) {
  const origin = getAppBaseUrl();
  const failureUrl = `${origin}/profile/connections?error=facebook`;

  if (!getFacebookAppId()) {
    console.error('[GET /api/platforms/connect/facebook] Missing FACEBOOK_APP_ID');
    return NextResponse.redirect(failureUrl);
  }

  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const redirectUri = getFacebookRedirectUri(origin);
  const csrfNonce = randomBytes(32).toString('hex');
  const cookieValue = `${csrfNonce}|${userId}`;

  const params = new URLSearchParams({
    client_id: getFacebookAppId()!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: FACEBOOK_SCOPES,
    state: csrfNonce,
  });

  const response = NextResponse.redirect(`${FACEBOOK_OAUTH_DIALOG_URL}?${params.toString()}`);

  response.cookies.set(FACEBOOK_OAUTH_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getSessionCookieOptions().secure,
    maxAge: 60 * 10,
    path: '/',
  });

  return response;
}
