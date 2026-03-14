// =============================================================================
// GET /api/platforms/connect/vimeo
// =============================================================================
// Initiates the Vimeo OAuth2 connection flow. Verifies the user's Appwrite
// session, builds the Vimeo OAuth2 authorization URL, generates a random CSRF
// nonce for the `state` parameter (stored in a short-lived httpOnly cookie),
// then redirects the browser to Vimeo's consent screen.
//
// Required env vars: VIMEO_CLIENT_ID
// Callback URL: http://localhost:3000/api/platforms/callback/vimeo
// =============================================================================

import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Client, Account } from 'node-appwrite';
import { getSessionCookieName } from '@/lib/auth-session-cookie';

export const VIMEO_OAUTH_STATE_COOKIE = 'vimeo_oauth_state';

const VIMEO_AUTH_URL = 'https://api.vimeo.com/oauth/authorize';

export async function GET(req: NextRequest) {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  const clientId = process.env.VIMEO_CLIENT_ID;

  const origin = req.nextUrl.origin;
  const failureUrl = `${origin}/profile/connections?error=vimeo`;

  if (!endpoint || !projectId || !clientId) {
    console.error('[GET /api/platforms/connect/vimeo] Missing required environment variables');
    return NextResponse.redirect(failureUrl);
  }

  // Verify the user has an active Appwrite session
  const cookieName = getSessionCookieName(projectId);
  const sessionSecret = req.cookies.get(cookieName)?.value;

  if (!sessionSecret) {
    return NextResponse.redirect(`${origin}/login`);
  }

  let userId: string;
  try {
    const client = new Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setSession(sessionSecret);

    const account = new Account(client);
    const user = await account.get();
    userId = user.$id;
  } catch {
    return NextResponse.redirect(`${origin}/login`);
  }

  const redirectUri = `${origin}/api/platforms/callback/vimeo`;

  // Generate a cryptographically random CSRF nonce. Stored in a short-lived
  // httpOnly cookie alongside userId so the callback can verify identity
  // without relying on the Appwrite session cookie (which is sameSite=strict
  // and is dropped on the cross-site redirect back from Vimeo).
  // Format: "<nonce>|<userId>".
  const csrfNonce = randomBytes(32).toString('hex');
  const cookieValue = `${csrfNonce}|${userId}`;

  // TODO: Change scope back to 'upload' once Vimeo approves the upload access request.
  // Upload access is currently under review — using 'public' in the meantime.
  // See: https://developer.vimeo.com/apps (Upload Access: "Your upload request is being reviewed.")
  const scope = 'public';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
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
