// =============================================================================
// GET /api/platforms/callback/vimeo
// =============================================================================
// Handles the OAuth2 callback from Vimeo after the user grants consent.
// Verifies the CSRF nonce (state param vs. vimeo_oauth_state cookie) and
// extracts the userId from the cookie value — the Appwrite session cookie is
// sameSite=strict and is dropped on the cross-site Vimeo redirect, so identity
// is carried securely in the server-set OAuth state cookie instead.
// Exchanges the code for an access token via Basic auth (base64 of
// clientId:clientSecret). Vimeo's token response includes the user object with
// name and URI, so no separate API call is needed for the channel name.
//
// Vimeo tokens do not expire by default, so tokenExpiry is set 10 years ahead.
// The connection is stored via createConnectedAccount (tokens encrypted at rest).
//
// Required env vars: VIMEO_CLIENT_ID, VIMEO_CLIENT_SECRET
// Callback URL: http://localhost:3000/api/platforms/callback/vimeo
// =============================================================================

import { NextRequest } from 'next/server';
import { VIMEO_OAUTH_STATE_COOKIE } from '@/app/api/platforms/connect/vimeo/route';
import { htmlRedirect } from '@/lib/api/html-redirect';
import {
  createConnectedAccount,
  getConnectedAccount,
  updateConnection,
} from '@/lib/repositories/connected-accounts';

const VIMEO_TOKEN_URL = 'https://api.vimeo.com/oauth/access_token';

interface VimeoUser {
  name: string;
  uri: string;
}

interface VimeoTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  user: VimeoUser;
}

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const successUrl = `${origin}/profile/connections?success=vimeo`;
  const failureUrl = `${origin}/profile/connections?error=vimeo`;

  const clientId = process.env.VIMEO_CLIENT_ID;
  const clientSecret = process.env.VIMEO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      '[GET /api/platforms/callback/vimeo] Missing VIMEO_CLIENT_ID or VIMEO_CLIENT_SECRET'
    );
    return htmlRedirect(failureUrl);
  }

  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    console.error('[GET /api/platforms/callback/vimeo] OAuth error from Vimeo:', error);
    return htmlRedirect(failureUrl);
  }

  if (!code || !stateParam) {
    console.error('[GET /api/platforms/callback/vimeo] Missing code or state');
    return htmlRedirect(failureUrl);
  }

  // Verify CSRF nonce and extract userId from the server-set OAuth state cookie.
  // Cookie format: "<nonce>|<userId>" — set during the connect step while the
  // user was authenticated. The Appwrite session cookie (sameSite=strict) is not
  // available here because this route is reached via a cross-site redirect from Vimeo.
  const cookieValue = req.cookies.get(VIMEO_OAUTH_STATE_COOKIE)?.value;
  if (!cookieValue) {
    console.error('[GET /api/platforms/callback/vimeo] CSRF state cookie missing');
    return htmlRedirect(failureUrl);
  }
  const pipeIndex = cookieValue.indexOf('|');
  if (pipeIndex === -1) {
    console.error('[GET /api/platforms/callback/vimeo] Malformed state cookie');
    return htmlRedirect(failureUrl);
  }
  const storedNonce = cookieValue.slice(0, pipeIndex);
  const userId = cookieValue.slice(pipeIndex + 1);

  if (storedNonce !== stateParam || !userId) {
    console.error('[GET /api/platforms/callback/vimeo] CSRF state mismatch');
    return htmlRedirect(failureUrl);
  }

  try {
    const redirectUri = `${origin}/api/platforms/callback/vimeo`;

    // Exchange authorization code for access token using HTTP Basic auth.
    // Vimeo requires Basic auth with clientId:clientSecret base64-encoded.
    // The Vimeo API expects a JSON body (not form-encoded) for this endpoint.
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const tokenRes = await fetch(VIMEO_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.vimeo.*+json;version=3.4',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error('[GET /api/platforms/callback/vimeo] Token exchange failed:', body);
      return htmlRedirect(failureUrl);
    }

    const tokens = (await tokenRes.json()) as VimeoTokenResponse;

    if (!tokens.access_token) {
      console.error('[GET /api/platforms/callback/vimeo] No access_token in response');
      return htmlRedirect(failureUrl);
    }

    if (!tokens.user) {
      console.error('[GET /api/platforms/callback/vimeo] No user object in token response');
      return htmlRedirect(failureUrl);
    }

    const grantedScopes = (tokens.scope || '').split(/\s+/).filter(Boolean);
    if (!grantedScopes.includes('upload')) {
      console.error(
        '[GET /api/platforms/callback/vimeo] Missing required upload scope in token response:',
        tokens.scope
      );
      return htmlRedirect(failureUrl);
    }

    // Extract platformUserId from the user URI (e.g. "/users/12345678" → "12345678")
    const platformUserId = tokens.user.uri.split('/').pop() ?? tokens.user.uri;
    const platformName = tokens.user.name;

    // Vimeo tokens do not expire by default — set expiry 10 years from now.
    const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1000;
    const tokenExpiry = new Date(Date.now() + tenYearsMs).toISOString();

    // Upsert: update all fields if a connection already exists, otherwise create.
    const existing = await getConnectedAccount(userId, 'vimeo');
    if (existing) {
      await updateConnection(
        existing.id,
        tokens.access_token,
        '', // Vimeo tokens do not use refresh tokens
        tokenExpiry,
        platformUserId,
        platformName
      );
    } else {
      await createConnectedAccount({
        userId,
        platform: 'vimeo',
        accessToken: tokens.access_token,
        refreshToken: '',
        tokenExpiry,
        platformUserId,
        platformName,
      });
    }

    // Clear the CSRF nonce cookie and break the cross-site redirect chain.
    return htmlRedirect(successUrl, VIMEO_OAUTH_STATE_COOKIE);
  } catch (err) {
    console.error('[GET /api/platforms/callback/vimeo] Unexpected error:', err);
    return htmlRedirect(failureUrl);
  }
}
