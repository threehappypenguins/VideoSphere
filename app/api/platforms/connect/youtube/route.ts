// =============================================================================
// GET /api/platforms/connect/youtube
// =============================================================================
// Initiates the YouTube OAuth2 connection flow. Verifies the user's JWT
// session, builds the Google OAuth2 consent URL requesting YouTube upload
// permissions (youtube.upload scope), generates a random CSRF nonce for the
// `state` parameter (stored in a short-lived httpOnly cookie), then redirects
// the browser to Google's consent screen.
//
// Required env vars: YOUTUBE_CLIENT_ID
// Callback URL: http://localhost:3000/api/platforms/callback/youtube
// =============================================================================

import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { YOUTUBE_OAUTH_STATE_COOKIE } from '@/lib/platforms/oauth-state-cookies';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
// youtube.upload — resumable video upload (narrow; does not include playlists.insert)
// youtube.readonly — channel info; playlists.list (read)
// youtube.force-ssl — listed for playlistItems.insert / some write paths
// youtube — manage account including playlists.insert (see API doc); avoids 403 insufficientPermissions
//   when creating playlists. Users must reconnect YouTube after this scope is added.
const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube',
].join(' ');

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.YOUTUBE_CLIENT_ID;

  const origin = req.nextUrl.origin;
  const failureUrl = `${origin}/profile/connections?error=youtube`;

  if (!clientId) {
    console.error('[GET /api/platforms/connect/youtube] Missing required environment variables');
    return NextResponse.redirect(failureUrl);
  }

  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const redirectUri = `${origin}/api/platforms/callback/youtube`;

  // Generate a cryptographically random CSRF nonce. It is stored in a
  // short-lived httpOnly cookie alongside the userId so the callback can
  // verify identity without relying on JWT session cookies
  // (which may be dropped on the cross-site redirect
  // back from Google). Format: "<nonce>|<userId>".
  const csrfNonce = randomBytes(32).toString('hex');
  const cookieValue = `${csrfNonce}|${userId}`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: YOUTUBE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: csrfNonce,
  });

  const response = NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);

  // Store the nonce+userId in a short-lived httpOnly cookie (10 minutes).
  // SameSite=lax so it survives the redirect back from Google.
  response.cookies.set(YOUTUBE_OAUTH_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 10,
    path: '/',
  });

  return response;
}
