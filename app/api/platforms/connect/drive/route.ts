import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { GOOGLE_DRIVE_OAUTH_STATE_COOKIE } from '@/lib/platforms/oauth-state-cookies';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
].join(' ');

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;

  const origin = req.nextUrl.origin;
  const failureUrl = `${origin}/profile/connections?error=google_drive`;

  if (!clientId) {
    console.error('[GET /api/platforms/connect/drive] Missing required environment variables');
    return NextResponse.redirect(failureUrl);
  }

  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const redirectUri = `${origin}/api/platforms/callback/drive`;
  const csrfNonce = randomBytes(32).toString('hex');
  const cookieValue = `${csrfNonce}|${userId}`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_DRIVE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: csrfNonce,
  });

  const response = NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  response.cookies.set(GOOGLE_DRIVE_OAUTH_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 10,
    path: '/',
  });

  return response;
}
