// =============================================================================
// GET /api/platforms/callback/youtube
// =============================================================================
// Handles the OAuth2 callback from Google after the user grants consent.
// Verifies the CSRF nonce (state param vs. youtube_oauth_state cookie) and
// extracts the userId from the cookie value — the Appwrite session cookie is
// sameSite=strict and is dropped on the cross-site Google redirect, so identity
// is carried securely in the server-set OAuth state cookie instead.
// Exchanges the code for tokens, fetches the YouTube channel name, and upserts
// the connection (tokens encrypted at rest by the repository).
//
// Required env vars: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET
// Callback URL: http://localhost:3000/api/platforms/callback/youtube
// =============================================================================

import { NextRequest } from 'next/server';
import { YOUTUBE_OAUTH_STATE_COOKIE } from '@/app/api/platforms/connect/youtube/route';
import { htmlRedirect } from '@/lib/api/html-redirect';
import {
  createConnectedAccount,
  getConnectedAccountWithTokens,
  updateConnection,
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
    return htmlRedirect(failureUrl);
  }

  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    console.error('[GET /api/platforms/callback/youtube] OAuth error from Google:', error);
    return htmlRedirect(failureUrl);
  }

  if (!code || !stateParam) {
    console.error('[GET /api/platforms/callback/youtube] Missing code or state');
    return htmlRedirect(failureUrl);
  }

  // Verify CSRF nonce and extract userId from the server-set OAuth state cookie.
  // Cookie format: "<nonce>|<userId>" — set during the connect step while the
  // user was authenticated. The Appwrite session cookie (sameSite=strict) is not
  // available here because this route is reached via a cross-site redirect from Google.
  const cookieValue = req.cookies.get(YOUTUBE_OAUTH_STATE_COOKIE)?.value;
  if (!cookieValue) {
    console.error('[GET /api/platforms/callback/youtube] CSRF state cookie missing');
    return htmlRedirect(failureUrl);
  }
  const pipeIndex = cookieValue.indexOf('|');
  if (pipeIndex === -1) {
    console.error('[GET /api/platforms/callback/youtube] Malformed state cookie');
    return htmlRedirect(failureUrl);
  }
  const storedNonce = cookieValue.slice(0, pipeIndex);
  const userId = cookieValue.slice(pipeIndex + 1);

  if (storedNonce !== stateParam || !userId) {
    console.error('[GET /api/platforms/callback/youtube] CSRF state mismatch');
    return htmlRedirect(failureUrl);
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
      return htmlRedirect(failureUrl);
    }

    const tokens = (await tokenRes.json()) as GoogleTokenResponse;

    if (!tokens.access_token) {
      console.error('[GET /api/platforms/callback/youtube] No access_token in response');
      return htmlRedirect(failureUrl);
    }

    // Fetch the user's YouTube channel info
    const channelRes = await fetch(YOUTUBE_CHANNELS_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!channelRes.ok) {
      const body = await channelRes.text();
      console.error('[GET /api/platforms/callback/youtube] Channel fetch failed:', body);
      return htmlRedirect(failureUrl);
    }

    const channelData = (await channelRes.json()) as YouTubeChannelsResponse;
    const channel = channelData.items?.[0];

    if (!channel) {
      console.error('[GET /api/platforms/callback/youtube] No YouTube channel found for user');
      return htmlRedirect(failureUrl);
    }

    const platformUserId = channel.id;
    const platformName = channel.snippet.title;

    // Calculate token expiry from expires_in (seconds)
    const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Upsert: update all fields if a connection already exists, otherwise create.
    // updateConnection also refreshes platformName/platformUserId so a renamed
    // channel is reflected immediately on reconnect.
    const existing = await getConnectedAccountWithTokens(userId, 'youtube');
    const refreshTokenToStore = tokens.refresh_token ?? existing?.refreshToken ?? '';
    if (existing) {
      await updateConnection(
        existing.id,
        tokens.access_token,
        refreshTokenToStore,
        tokenExpiry,
        platformUserId,
        platformName
      );
    } else {
      await createConnectedAccount({
        userId,
        platform: 'youtube',
        accessToken: tokens.access_token,
        refreshToken: refreshTokenToStore,
        tokenExpiry,
        platformUserId,
        platformName,
      });
    }

    // Clear the CSRF nonce cookie and break the cross-site redirect chain.
    return htmlRedirect(successUrl, YOUTUBE_OAUTH_STATE_COOKIE);
  } catch (err) {
    console.error('[GET /api/platforms/callback/youtube] Unexpected error:', err);
    return htmlRedirect(failureUrl);
  }
}
