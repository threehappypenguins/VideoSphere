// =============================================================================
// GET /api/platforms/callback/facebook
// =============================================================================
// Handles the OAuth callback from Facebook after the user grants consent.
// Verifies the CSRF nonce, exchanges the code for short- then long-lived user
// tokens, fetches the user profile, stores a compact pending setup session cookie,
// and uses an HTML landing page before navigating to the setup picker.
// Required env vars: FACEBOOK_APP_ID, FACEBOOK_APP_SECRET
// Callback URL: http://localhost:9624/api/platforms/callback/facebook
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAppBaseUrl } from '@/lib/app-port';
import { FACEBOOK_OAUTH_STATE_COOKIE } from '@/lib/platforms/oauth-state-cookies';
import { htmlRedirect } from '@/lib/api/html-redirect';
import {
  exchangeFacebookCodeForToken,
  exchangeFacebookShortLivedToken,
  fetchFacebookMe,
  getFacebookAppId,
  getFacebookAppSecret,
  getFacebookRedirectUri,
} from '@/lib/platforms/facebook-oauth';
import {
  setFacebookSetupSessionCookie,
  type FacebookSetupSession,
} from '@/lib/platforms/facebook-setup-session';

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns Redirect to setup picker or failure URL.
 */
export async function GET(req: NextRequest) {
  const origin = getAppBaseUrl();
  const setupUrl = `${origin}/profile/connections/facebook-setup`;
  const failureUrl = `${origin}/profile/connections?error=facebook`;

  if (!getFacebookAppId() || !getFacebookAppSecret()) {
    console.error(
      '[GET /api/platforms/callback/facebook] Missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET'
    );
    return htmlRedirect(failureUrl);
  }

  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    console.error('[GET /api/platforms/callback/facebook] OAuth error from Facebook:', error);
    return htmlRedirect(failureUrl);
  }

  if (!code || !stateParam) {
    console.error('[GET /api/platforms/callback/facebook] Missing code or state');
    return htmlRedirect(failureUrl);
  }

  const cookieValue = req.cookies.get(FACEBOOK_OAUTH_STATE_COOKIE)?.value;
  if (!cookieValue) {
    console.error('[GET /api/platforms/callback/facebook] CSRF state cookie missing');
    return htmlRedirect(failureUrl);
  }

  const pipeIndex = cookieValue.indexOf('|');
  if (pipeIndex === -1) {
    console.error('[GET /api/platforms/callback/facebook] Malformed state cookie');
    return htmlRedirect(failureUrl);
  }

  const storedNonce = cookieValue.slice(0, pipeIndex);
  const userId = cookieValue.slice(pipeIndex + 1);

  if (storedNonce !== stateParam || !userId) {
    console.error('[GET /api/platforms/callback/facebook] CSRF state mismatch');
    return htmlRedirect(failureUrl);
  }

  try {
    const redirectUri = getFacebookRedirectUri(origin);

    const shortLived = await exchangeFacebookCodeForToken(code, redirectUri);
    if (!shortLived.access_token) {
      console.error(
        '[GET /api/platforms/callback/facebook] Token exchange failed:',
        shortLived.error?.message ?? 'no access_token'
      );
      return htmlRedirect(failureUrl);
    }

    const longLived = await exchangeFacebookShortLivedToken(shortLived.access_token);
    if (!longLived.access_token) {
      console.error(
        '[GET /api/platforms/callback/facebook] Long-lived token exchange failed:',
        longLived.error?.message ?? 'no access_token'
      );
      return htmlRedirect(failureUrl);
    }

    const profile = await fetchFacebookMe(longLived.access_token);

    if (!profile) {
      console.error('[GET /api/platforms/callback/facebook] Failed to fetch Facebook profile');
      return htmlRedirect(failureUrl);
    }

    const setupSession: FacebookSetupSession = {
      userId,
      userAccessToken: longLived.access_token,
      userTokenExpiresIn: longLived.expires_in,
      userProfileId: profile.id,
      userProfileName: profile.name,
    };

    const landing = htmlRedirect(setupUrl, FACEBOOK_OAUTH_STATE_COOKIE);
    const response = new NextResponse(landing.body, {
      status: landing.status,
      statusText: landing.statusText,
      headers: landing.headers,
    });
    setFacebookSetupSessionCookie(response, setupSession);
    return response;
  } catch (err) {
    console.error('[GET /api/platforms/callback/facebook] Unexpected error:', err);
    return htmlRedirect(failureUrl, FACEBOOK_OAUTH_STATE_COOKIE);
  }
}
