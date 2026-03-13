// =============================================================================
// GET /api/platforms/callback/youtube
// =============================================================================
// Handles the OAuth2 callback from Google after the user grants consent.
// Verifies the CSRF nonce (state param vs. youtube_oauth_state cookie), then
// verifies the Appwrite session to derive the userId — the state parameter is
// NOT trusted for identity. Exchanges the code for access and refresh tokens,
// fetches the user's YouTube channel name, and stores the connection using
// createConnectedAccount (tokens are encrypted at rest by the repository).
//
// Required env vars: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET
// Callback URL: http://localhost:3000/api/platforms/callback/youtube
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { Client, Account } from 'node-appwrite';
import { getSessionCookieName } from '@/lib/auth-session-cookie';
import { YOUTUBE_OAUTH_STATE_COOKIE } from '@/app/api/platforms/connect/youtube/route';
import {
  createConnectedAccount,
  getConnectedAccount,
  updateTokens,
} from '@/lib/repositories/connected-accounts';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_CHANNELS_URL =
  'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

interface YouTubeChannelSnippet {
  title: string;
}

interface YouTubeChannel {
  id: string;
  snippet: YouTubeChannelSnippet;
}

interface YouTubeChannelsResponse {
  items?: YouTubeChannel[];
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const successUrl = `${origin}/profile/connections?success=youtube`;
  const failureUrl = `${origin}/profile/connections?error=youtube`;

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      '[GET /api/platforms/callback/youtube] Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET'
    );
    return NextResponse.redirect(failureUrl);
  }

  const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
  const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;

  if (!endpoint || !projectId) {
    console.error('[GET /api/platforms/callback/youtube] Missing Appwrite environment variables');
    return NextResponse.redirect(failureUrl);
  }

  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    console.error('[GET /api/platforms/callback/youtube] OAuth error from Google:', error);
    return NextResponse.redirect(failureUrl);
  }

  if (!code || !stateParam) {
    console.error('[GET /api/platforms/callback/youtube] Missing code or state');
    return NextResponse.redirect(failureUrl);
  }

  // Verify CSRF nonce: state param must match the cookie set in the connect route.
  const storedNonce = req.cookies.get(YOUTUBE_OAUTH_STATE_COOKIE)?.value;
  if (!storedNonce || storedNonce !== stateParam) {
    console.error('[GET /api/platforms/callback/youtube] CSRF state mismatch');
    return NextResponse.redirect(failureUrl);
  }

  // Verify the Appwrite session to get the userId — never trust the state param for identity.
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

  try {
    // Exchange authorization code for access + refresh tokens
    const redirectUri = `${origin}/api/platforms/callback/youtube`;

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error('[GET /api/platforms/callback/youtube] Token exchange failed:', body);
      return NextResponse.redirect(failureUrl);
    }

    const tokens = (await tokenRes.json()) as GoogleTokenResponse;

    if (!tokens.access_token) {
      console.error('[GET /api/platforms/callback/youtube] No access_token in response');
      return NextResponse.redirect(failureUrl);
    }

    // Fetch the user's YouTube channel info
    const channelRes = await fetch(YOUTUBE_CHANNELS_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!channelRes.ok) {
      const body = await channelRes.text();
      console.error('[GET /api/platforms/callback/youtube] Channel fetch failed:', body);
      return NextResponse.redirect(failureUrl);
    }

    const channelData = (await channelRes.json()) as YouTubeChannelsResponse;
    const channel = channelData.items?.[0];

    if (!channel) {
      console.error('[GET /api/platforms/callback/youtube] No YouTube channel found for user');
      return NextResponse.redirect(failureUrl);
    }

    const platformUserId = channel.id;
    const platformName = channel.snippet.title;

    // Calculate token expiry from expires_in (seconds)
    const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Upsert: update tokens if a connection already exists, otherwise create.
    // (One connection per user per platform — see repository comment.)
    const existing = await getConnectedAccount(userId, 'youtube');
    if (existing) {
      await updateTokens(existing.id, tokens.access_token, tokens.refresh_token ?? '', tokenExpiry);
    } else {
      await createConnectedAccount({
        userId,
        platform: 'youtube',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? '',
        tokenExpiry,
        platformUserId,
        platformName,
      });
    }

    const successResponse = NextResponse.redirect(successUrl);
    // Clear the CSRF nonce cookie — it's single-use.
    successResponse.cookies.delete(YOUTUBE_OAUTH_STATE_COOKIE);
    return successResponse;
  } catch (err) {
    console.error('[GET /api/platforms/callback/youtube] Unexpected error:', err);
    return NextResponse.redirect(failureUrl);
  }
}
