// =============================================================================
// GET /api/platforms/connect/vimeo
// =============================================================================
// Initiates the Vimeo OAuth2 connection flow. Verifies the user's authenticated
// session, builds the Vimeo OAuth2 authorization URL, generates a random CSRF
// nonce for the `state` parameter (stored in a short-lived httpOnly cookie),
// then redirects the browser to Vimeo's consent screen.
//
// Required env vars: VIMEO_CLIENT_ID
// Callback URL: http://localhost:3000/api/platforms/callback/vimeo
// =============================================================================

import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { VIMEO_OAUTH_STATE_COOKIE } from '@/lib/platforms/oauth-state-cookies';

const VIMEO_AUTH_URL = 'https://api.vimeo.com/oauth/authorize';
const VIMEO_SCOPES = ['upload', 'edit', 'public', 'private'].join(' ');

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.VIMEO_CLIENT_ID;

  const origin = req.nextUrl.origin;
  const failureUrl = `${origin}/profile/connections?error=vimeo`;

  if (!clientId) {
    console.error('[GET /api/platforms/connect/vimeo] Missing required environment variables');
    return NextResponse.redirect(failureUrl);
  }

  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const redirectUri = `${origin}/api/platforms/callback/vimeo`;

  // Generate a cryptographically random CSRF nonce. Stored in a short-lived
  // httpOnly cookie alongside userId so the callback can verify identity
  // without relying on the authenticated session cookie. Binding identity to
  // the OAuth state cookie keeps callback verification robust across browser
  // same-site behavior changes and cookie policy adjustments.
  // Format: "<nonce>|<userId>".
  const csrfNonce = randomBytes(32).toString('hex');
  const cookieValue = `${csrfNonce}|${userId}`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: VIMEO_SCOPES,
    state: csrfNonce,
  });

  const response = NextResponse.redirect(`${VIMEO_AUTH_URL}?${params.toString()}`);

  // Store the nonce+userId in a short-lived httpOnly cookie (10 minutes).
  // SameSite=lax so it survives the redirect back from Vimeo.
  response.cookies.set(VIMEO_OAUTH_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 10,
    path: '/',
  });

  return response;
}
