// =============================================================================
// GET /api/platforms/connect/youtube
// =============================================================================
// Initiates the YouTube OAuth2 connection flow. Verifies the user's Appwrite
// session, builds the Google OAuth2 consent URL requesting YouTube upload
// permissions (youtube.upload scope), embeds the userId in the `state`
// parameter, then redirects the browser to Google's consent screen.
//
// Required env vars: YOUTUBE_CLIENT_ID
// Callback URL: http://localhost:3000/api/platforms/callback/youtube
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { Client, Account } from 'node-appwrite';
import { getSessionCookieName } from '@/lib/auth-session-cookie';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
// youtube.upload — allows uploading videos
// youtube.readonly — required to read channel info (name, id) after connection
const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ');

export async function GET(req: NextRequest) {
  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
  const clientId = process.env.YOUTUBE_CLIENT_ID;

  const origin = req.nextUrl.origin;
  const failureUrl = `${origin}/profile/connections?error=youtube`;

  if (!endpoint || !projectId || !clientId) {
    console.error('[GET /api/platforms/connect/youtube] Missing required environment variables');
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

  const redirectUri = `${origin}/api/platforms/callback/youtube`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: YOUTUBE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: userId,
  });

  return NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
}
