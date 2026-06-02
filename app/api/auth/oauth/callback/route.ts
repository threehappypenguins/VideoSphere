import { randomUUID } from 'crypto';
import { SignJWT } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import {
  GOOGLE_AUTH_OAUTH_STATE_COOKIE,
  parseGoogleOAuthStateCookie,
  revokeGoogleOAuthTokens,
  type GoogleOAuthGrant,
  type GoogleOAuthState,
} from '@/lib/auth/google-oauth';
import { getSessionCookieName, getSessionCookieOptions } from '@/lib/auth-session-cookie';
import {
  consumeInviteToken,
  consumeSetupToken,
  hasAnyUsers,
  isInviteTokenValid,
  isSetupTokenValid,
  releaseInviteToken,
  releaseSetupToken,
} from '@/lib/repositories/invites';
import {
  createUser,
  getUserByEmail,
  getUserById,
  getUserPasswordAuthStateById,
  persistGoogleAuthForUser,
} from '@/lib/repositories/users';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
}

interface GoogleUserInfoResponse {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

function getGoogleClientId(): string | null {
  return (
    process.env.GOOGLE_CLIENT_ID ||
    process.env.GOOGLE_OAUTH_CLIENT_ID ||
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    null
  );
}

function getGoogleClientSecret(): string | null {
  return process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || null;
}

const LOGIN_OAUTH_ERROR_CODES = new Set(['oauth_setup_completed']);

function oauthErrorRedirect(origin: string, state: GoogleOAuthState | null, code: string): string {
  const encodedError = encodeURIComponent(code);
  if (state?.flow === 'connect') {
    return `${origin}/profile?error=${encodedError}`;
  }
  if (LOGIN_OAUTH_ERROR_CODES.has(code)) {
    return `${origin}/login?error=${encodedError}`;
  }
  if (state?.flow === 'setup' && state.setupToken) {
    return `${origin}/setup?token=${encodeURIComponent(state.setupToken)}&error=${encodedError}`;
  }
  if (state?.flow === 'invite' && state.inviteToken) {
    return `${origin}/invite/${encodeURIComponent(state.inviteToken)}?error=${encodedError}`;
  }
  return `${origin}/login?error=${encodedError}`;
}

function clearOAuthStateCookie(response: NextResponse): void {
  response.cookies.set(GOOGLE_AUTH_OAUTH_STATE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
    path: '/',
  });
}

function oauthErrorResponse(
  origin: string,
  state: GoogleOAuthState | null,
  code: string
): NextResponse {
  const response = NextResponse.redirect(oauthErrorRedirect(origin, state, code));
  clearOAuthStateCookie(response);
  return response;
}

/**
 * Revokes an unused Google grant, then redirects with the OAuth error code.
 * @param origin - Request origin.
 * @param state - Parsed OAuth state cookie.
 * @param code - Error code for the redirect query string.
 * @param grant - Google tokens to revoke when the user will not receive a session.
 * @returns Redirect response with the OAuth state cookie cleared.
 */
async function oauthErrorResponseAfterGrant(
  origin: string,
  state: GoogleOAuthState | null,
  code: string,
  grant?: GoogleOAuthGrant
): Promise<NextResponse> {
  if (grant?.accessToken || grant?.refreshToken) {
    await revokeGoogleOAuthTokens(grant);
  }
  return oauthErrorResponse(origin, state, code);
}

function googleGrantFromTokenResponse(tokenData: GoogleTokenResponse): GoogleOAuthGrant {
  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
  };
}

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns Redirect with session cookie on success.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const oauthError = req.nextUrl.searchParams.get('error');

  const cookieValue = req.cookies.get(GOOGLE_AUTH_OAUTH_STATE_COOKIE)?.value;
  const oauthState = cookieValue ? parseGoogleOAuthStateCookie(cookieValue) : null;

  if (oauthError) {
    return oauthErrorResponse(origin, oauthState, 'oauth_auth_failed');
  }

  if (!code || !state) {
    return oauthErrorResponse(origin, oauthState, 'oauth_missing_params');
  }

  if (!oauthState?.nonce) {
    return oauthErrorResponse(origin, oauthState, 'oauth_missing_params');
  }

  if (oauthState.nonce !== state) {
    return oauthErrorResponse(origin, oauthState, 'oauth_auth_failed');
  }

  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  const jwtSecret = process.env.JWT_SECRET;
  if (!clientId || !clientSecret || !jwtSecret) {
    console.error('[GET /api/auth/oauth/callback] Missing required OAuth/JWT env vars');
    return oauthErrorResponse(origin, oauthState, 'oauth_callback_failed');
  }

  let pendingGoogleGrant: GoogleOAuthGrant | undefined;

  try {
    const callbackUrl = `${origin}/api/auth/oauth/callback`;
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error('[GET /api/auth/oauth/callback] Token exchange failed:', body);
      return oauthErrorResponse(origin, oauthState, 'oauth_callback_failed');
    }

    const tokenData = (await tokenRes.json()) as GoogleTokenResponse;
    const googleGrant = googleGrantFromTokenResponse(tokenData);
    pendingGoogleGrant = googleGrant;
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return oauthErrorResponseAfterGrant(origin, oauthState, 'oauth_callback_failed', googleGrant);
    }

    const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userInfoRes.ok) {
      const body = await userInfoRes.text();
      console.error('[GET /api/auth/oauth/callback] Userinfo fetch failed:', body);
      return oauthErrorResponseAfterGrant(origin, oauthState, 'oauth_callback_failed', googleGrant);
    }

    const userInfo = (await userInfoRes.json()) as GoogleUserInfoResponse;
    const email = userInfo.email?.trim().toLowerCase();
    const googleSub = userInfo.sub?.trim();
    const googleDisplayName = userInfo.name?.trim();
    if (!email || !googleSub || userInfo.email_verified !== true) {
      return oauthErrorResponseAfterGrant(origin, oauthState, 'oauth_auth_failed', googleGrant);
    }

    if (oauthState.flow === 'connect') {
      const connectUserId = oauthState.userId;
      if (!connectUserId) {
        return oauthErrorResponseAfterGrant(
          origin,
          oauthState,
          'oauth_connect_failed',
          googleGrant
        );
      }

      const profile = await getUserById(connectUserId);
      if (!profile) {
        return oauthErrorResponseAfterGrant(
          origin,
          oauthState,
          'oauth_connect_failed',
          googleGrant
        );
      }

      const profileEmail = profile.email.trim().toLowerCase();
      if (profileEmail !== email) {
        return oauthErrorResponseAfterGrant(
          origin,
          oauthState,
          'oauth_connect_email_mismatch',
          googleGrant
        );
      }

      await persistGoogleAuthForUser(connectUserId, tokenData.refresh_token, {
        unsetPasswordHash: true,
      });

      pendingGoogleGrant = undefined;

      const connectTarget = oauthState.redirectTo ?? '/profile?success=google_connected';
      const response = NextResponse.redirect(new URL(connectTarget, origin));
      clearOAuthStateCookie(response);
      return response;
    }

    let userId: string;
    let role: 'admin' | 'user';

    if (oauthState.flow === 'setup') {
      const setupToken = oauthState.setupToken;
      if (!setupToken) {
        return oauthErrorResponseAfterGrant(origin, oauthState, 'oauth_setup_invalid', googleGrant);
      }

      if (await hasAnyUsers()) {
        return oauthErrorResponseAfterGrant(
          origin,
          oauthState,
          'oauth_setup_completed',
          googleGrant
        );
      }

      if (!(await isSetupTokenValid(setupToken))) {
        return oauthErrorResponseAfterGrant(origin, oauthState, 'oauth_setup_invalid', googleGrant);
      }

      userId = randomUUID();
      const consumed = await consumeSetupToken(setupToken, userId);
      if (!consumed) {
        return oauthErrorResponseAfterGrant(origin, oauthState, 'oauth_setup_invalid', googleGrant);
      }

      try {
        await createUser({
          userId,
          email,
          name: googleDisplayName || undefined,
          hasCompletedOnboarding: false,
          role: 'admin',
          authProvider: 'google',
          googleRefreshToken: tokenData.refresh_token,
        });
      } catch (error) {
        await releaseSetupToken(setupToken, userId);
        const mongoErr = error as { code?: number; message?: string };
        if (mongoErr.code === 11000 || mongoErr.message?.toLowerCase().includes('duplicate')) {
          return oauthErrorResponseAfterGrant(
            origin,
            oauthState,
            'oauth_setup_failed',
            googleGrant
          );
        }
        throw error;
      }

      role = 'admin';
    } else if (oauthState.flow === 'invite') {
      const inviteToken = oauthState.inviteToken;
      if (!inviteToken) {
        return oauthErrorResponseAfterGrant(
          origin,
          oauthState,
          'oauth_invite_invalid',
          googleGrant
        );
      }

      if (!(await isInviteTokenValid(inviteToken))) {
        return oauthErrorResponseAfterGrant(
          origin,
          oauthState,
          'oauth_invite_invalid',
          googleGrant
        );
      }

      userId = randomUUID();
      const consumed = await consumeInviteToken(inviteToken, userId);
      if (!consumed) {
        return oauthErrorResponseAfterGrant(
          origin,
          oauthState,
          'oauth_invite_invalid',
          googleGrant
        );
      }

      const invitedRole = consumed.grantedRole;

      try {
        await createUser({
          userId,
          email,
          name: googleDisplayName || undefined,
          hasCompletedOnboarding: false,
          role: invitedRole,
          authProvider: 'google',
          googleRefreshToken: tokenData.refresh_token,
        });
      } catch (error) {
        await releaseInviteToken(consumed.releaseSnapshot);
        const mongoErr = error as { code?: number; message?: string };
        if (mongoErr.code === 11000 || mongoErr.message?.toLowerCase().includes('duplicate')) {
          return oauthErrorResponseAfterGrant(
            origin,
            oauthState,
            'oauth_invite_failed',
            googleGrant
          );
        }
        throw error;
      }

      role = invitedRole;
    } else {
      const existingUser = await getUserByEmail(email);
      if (!existingUser) {
        return oauthErrorResponseAfterGrant(
          origin,
          oauthState,
          'oauth_registration_disabled',
          googleGrant
        );
      }

      userId = existingUser.userId;
      role = existingUser.role === 'admin' ? 'admin' : 'user';
      const authState = await getUserPasswordAuthStateById(userId);
      await persistGoogleAuthForUser(userId, tokenData.refresh_token, {
        unsetPasswordHash: authState?.supportsPasswordReset ?? false,
      });
    }

    pendingGoogleGrant = undefined;

    const token = await new SignJWT({ role, oauthProvider: 'google' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${getSessionCookieOptions().maxAge}s`)
      .sign(new TextEncoder().encode(jwtSecret));

    const callbackTarget = oauthState.redirectTo ?? '/dashboard';

    const response = NextResponse.redirect(new URL(callbackTarget, origin));
    response.cookies.set(getSessionCookieName(), token, getSessionCookieOptions());
    clearOAuthStateCookie(response);
    return response;
  } catch (err) {
    console.error('[GET /api/auth/oauth/callback]', err);
    return oauthErrorResponseAfterGrant(
      origin,
      oauthState,
      'oauth_callback_failed',
      pendingGoogleGrant
    );
  }
}
