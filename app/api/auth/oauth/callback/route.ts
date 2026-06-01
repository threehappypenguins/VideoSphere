import { randomUUID } from 'crypto';
import { SignJWT } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import {
  GOOGLE_AUTH_OAUTH_STATE_COOKIE,
  parseGoogleOAuthStateCookie,
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
import { createUser, getUserByEmail } from '@/lib/repositories/users';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

interface GoogleTokenResponse {
  access_token?: string;
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

function oauthErrorRedirect(origin: string, state: GoogleOAuthState | null, code: string): string {
  if (state?.flow === 'setup' && state.setupToken) {
    return `${origin}/setup?token=${encodeURIComponent(state.setupToken)}&error=${code}`;
  }
  if (state?.flow === 'invite' && state.inviteToken) {
    return `${origin}/invite/${encodeURIComponent(state.inviteToken)}?error=${code}`;
  }
  return `${origin}/login?error=${code}`;
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
    return NextResponse.redirect(oauthErrorRedirect(origin, oauthState, 'oauth_auth_failed'));
  }

  if (!code || !state) {
    return NextResponse.redirect(oauthErrorRedirect(origin, oauthState, 'oauth_missing_params'));
  }

  if (!oauthState?.nonce || oauthState.nonce !== state) {
    return NextResponse.redirect(oauthErrorRedirect(origin, oauthState, 'oauth_auth_failed'));
  }

  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  const jwtSecret = process.env.JWT_SECRET;
  if (!clientId || !clientSecret || !jwtSecret) {
    console.error('[GET /api/auth/oauth/callback] Missing required OAuth/JWT env vars');
    return NextResponse.redirect(oauthErrorRedirect(origin, oauthState, 'oauth_callback_failed'));
  }

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
      return NextResponse.redirect(oauthErrorRedirect(origin, oauthState, 'oauth_callback_failed'));
    }

    const tokenData = (await tokenRes.json()) as GoogleTokenResponse;
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return NextResponse.redirect(oauthErrorRedirect(origin, oauthState, 'oauth_callback_failed'));
    }

    const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userInfoRes.ok) {
      const body = await userInfoRes.text();
      console.error('[GET /api/auth/oauth/callback] Userinfo fetch failed:', body);
      return NextResponse.redirect(oauthErrorRedirect(origin, oauthState, 'oauth_callback_failed'));
    }

    const userInfo = (await userInfoRes.json()) as GoogleUserInfoResponse;
    const email = userInfo.email?.trim().toLowerCase();
    const googleSub = userInfo.sub?.trim();
    const googleDisplayName = userInfo.name?.trim();
    if (!email || !googleSub || userInfo.email_verified !== true) {
      return NextResponse.redirect(oauthErrorRedirect(origin, oauthState, 'oauth_auth_failed'));
    }

    let userId: string;
    let role: 'admin' | 'user';

    if (oauthState.flow === 'setup') {
      const setupToken = oauthState.setupToken;
      if (!setupToken) {
        return NextResponse.redirect(oauthErrorRedirect(origin, oauthState, 'oauth_setup_invalid'));
      }

      if (await hasAnyUsers()) {
        return NextResponse.redirect(
          oauthErrorRedirect(origin, oauthState, 'oauth_setup_completed')
        );
      }

      if (!(await isSetupTokenValid(setupToken))) {
        return NextResponse.redirect(oauthErrorRedirect(origin, oauthState, 'oauth_setup_invalid'));
      }

      userId = randomUUID();
      const consumed = await consumeSetupToken(setupToken, userId);
      if (!consumed) {
        return NextResponse.redirect(oauthErrorRedirect(origin, oauthState, 'oauth_setup_invalid'));
      }

      try {
        await createUser({
          userId,
          email,
          name: googleDisplayName || undefined,
          hasCompletedOnboarding: false,
          role: 'admin',
        });
      } catch (error) {
        await releaseSetupToken(setupToken, userId);
        const mongoErr = error as { code?: number; message?: string };
        if (mongoErr.code === 11000 || mongoErr.message?.toLowerCase().includes('duplicate')) {
          return NextResponse.redirect(
            oauthErrorRedirect(origin, oauthState, 'oauth_setup_failed')
          );
        }
        throw error;
      }

      role = 'admin';
    } else if (oauthState.flow === 'invite') {
      const inviteToken = oauthState.inviteToken;
      if (!inviteToken) {
        return NextResponse.redirect(
          oauthErrorRedirect(origin, oauthState, 'oauth_invite_invalid')
        );
      }

      if (!(await isInviteTokenValid(inviteToken))) {
        return NextResponse.redirect(
          oauthErrorRedirect(origin, oauthState, 'oauth_invite_invalid')
        );
      }

      userId = randomUUID();
      const consumed = await consumeInviteToken(inviteToken, userId);
      if (!consumed) {
        return NextResponse.redirect(
          oauthErrorRedirect(origin, oauthState, 'oauth_invite_invalid')
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
        });
      } catch (error) {
        await releaseInviteToken(consumed.releaseSnapshot);
        const mongoErr = error as { code?: number; message?: string };
        if (mongoErr.code === 11000 || mongoErr.message?.toLowerCase().includes('duplicate')) {
          return NextResponse.redirect(
            oauthErrorRedirect(origin, oauthState, 'oauth_invite_failed')
          );
        }
        throw error;
      }

      role = invitedRole;
    } else {
      const existingUser = await getUserByEmail(email);
      if (!existingUser) {
        return NextResponse.redirect(
          oauthErrorRedirect(origin, oauthState, 'oauth_registration_disabled')
        );
      }

      userId = existingUser.userId;
      role = existingUser.role === 'admin' ? 'admin' : 'user';
    }

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
    return NextResponse.redirect(oauthErrorRedirect(origin, oauthState, 'oauth_callback_failed'));
  }
}
