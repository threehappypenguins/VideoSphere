// =============================================================================
// GET /api/auth/oauth/callback
// =============================================================================
// Completes Google OAuth2 Authorization Code flow (no external auth vendor dependency).
// =============================================================================

import { SignJWT } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { GOOGLE_AUTH_OAUTH_STATE_COOKIE } from '@/lib/auth/google-oauth';
import { getSessionCookieName, getSessionCookieOptions } from '@/lib/auth-session-cookie';
import { upsertOAuthUserByEmail } from '@/lib/repositories/users';
import { safeRedirect } from '@/lib/safe-redirect';

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

function parseStateCookie(cookieValue: string): { nonce: string; redirectTo: string | null } {
  const pipeIndex = cookieValue.indexOf('|');
  if (pipeIndex === -1) {
    return { nonce: cookieValue, redirectTo: null };
  }

  const nonce = cookieValue.slice(0, pipeIndex);
  const encodedRedirect = cookieValue.slice(pipeIndex + 1);
  if (!encodedRedirect) {
    return { nonce, redirectTo: null };
  }

  try {
    return { nonce, redirectTo: safeRedirect(decodeURIComponent(encodedRedirect)) };
  } catch {
    return { nonce, redirectTo: null };
  }
}

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const oauthError = req.nextUrl.searchParams.get('error');

  if (oauthError) {
    return NextResponse.redirect(`${origin}/login?error=oauth_auth_failed`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/login?error=oauth_missing_params`);
  }

  const cookieValue = req.cookies.get(GOOGLE_AUTH_OAUTH_STATE_COOKIE)?.value;
  if (!cookieValue) {
    return NextResponse.redirect(`${origin}/login?error=oauth_missing_params`);
  }

  const parsedCookie = parseStateCookie(cookieValue);
  if (!parsedCookie.nonce || parsedCookie.nonce !== state) {
    return NextResponse.redirect(`${origin}/login?error=oauth_auth_failed`);
  }

  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  const jwtSecret = process.env.JWT_SECRET;
  if (!clientId || !clientSecret || !jwtSecret) {
    console.error('[GET /api/auth/oauth/callback] Missing required OAuth/JWT env vars');
    return NextResponse.redirect(`${origin}/login?error=oauth_callback_failed`);
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
      return NextResponse.redirect(`${origin}/login?error=oauth_callback_failed`);
    }

    const tokenData = (await tokenRes.json()) as GoogleTokenResponse;
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return NextResponse.redirect(`${origin}/login?error=oauth_callback_failed`);
    }

    const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userInfoRes.ok) {
      const body = await userInfoRes.text();
      console.error('[GET /api/auth/oauth/callback] Userinfo fetch failed:', body);
      return NextResponse.redirect(`${origin}/login?error=oauth_callback_failed`);
    }

    const userInfo = (await userInfoRes.json()) as GoogleUserInfoResponse;
    const email = userInfo.email?.trim().toLowerCase();
    const googleSub = userInfo.sub?.trim();
    const googleDisplayName = userInfo.name?.trim();
    if (!email || !googleSub || userInfo.email_verified !== true) {
      return NextResponse.redirect(`${origin}/login?error=oauth_auth_failed`);
    }

    const user = await upsertOAuthUserByEmail(email, googleDisplayName);

    const token = await new SignJWT({ role: user.role, oauthProvider: 'google' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.userId)
      .setIssuedAt()
      .setExpirationTime(`${getSessionCookieOptions().maxAge}s`)
      .sign(new TextEncoder().encode(jwtSecret));

    const callbackTarget = parsedCookie.redirectTo ?? '/dashboard';

    const response = NextResponse.redirect(new URL(callbackTarget, origin));
    response.cookies.set(getSessionCookieName(), token, getSessionCookieOptions());
    response.cookies.set(GOOGLE_AUTH_OAUTH_STATE_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 0,
      path: '/',
    });
    return response;
  } catch (err) {
    console.error('[GET /api/auth/oauth/callback]', err);
    return NextResponse.redirect(`${origin}/login?error=oauth_callback_failed`);
  }
}
