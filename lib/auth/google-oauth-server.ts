import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  GOOGLE_AUTH_OAUTH_STATE_COOKIE,
  buildGoogleOAuthStateCookie,
  type BuildGoogleOAuthStateInput,
} from '@/lib/auth/google-oauth';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_AUTH_SCOPES = ['openid', 'email', 'profile'].join(' ');
const GOOGLE_OAUTH_STATE_COOKIE_MAX_AGE_SEC = 60 * 10;

/**
 * Resolves the Google OAuth client id from environment variables.
 * @returns Client id when configured, otherwise null.
 */
export function getGoogleOAuthClientId(): string | null {
  return (
    process.env.GOOGLE_CLIENT_ID ||
    process.env.GOOGLE_OAUTH_CLIENT_ID ||
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    null
  );
}

/**
 * Inputs for starting a Google OAuth redirect (CSRF nonce is generated when omitted).
 */
export type CreateGoogleOAuthStartRedirectInput = Omit<BuildGoogleOAuthStateInput, 'nonce'> & {
  nonce?: string;
};

/**
 * Optional parameters for the Google authorize URL.
 * @property promptConsent - When true, adds `prompt=consent` (e.g. connect flow refresh token).
 */
export interface CreateGoogleOAuthStartRedirectOptions {
  promptConsent?: boolean;
}

/**
 * Builds a redirect to Google's OAuth consent screen and sets the CSRF state cookie.
 * @param origin - Request origin (scheme + host).
 * @param state - Flow-specific OAuth state cookie inputs.
 * @param options - Optional authorize URL parameters.
 * @returns Redirect response, or null when the Google client id is not configured.
 */
export function createGoogleOAuthStartRedirect(
  origin: string,
  state: CreateGoogleOAuthStartRedirectInput,
  options: CreateGoogleOAuthStartRedirectOptions = {}
): NextResponse | null {
  const clientId = getGoogleOAuthClientId();
  if (!clientId) return null;

  const csrfNonce = state.nonce ?? randomBytes(32).toString('hex');
  const cookieValue = buildGoogleOAuthStateCookie({ ...state, nonce: csrfNonce });

  const callbackUrl = `${origin}/api/auth/oauth/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: GOOGLE_AUTH_SCOPES,
    state: csrfNonce,
    access_type: 'offline',
  });
  if (options.promptConsent) {
    params.set('prompt', 'consent');
  }

  const response = NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  response.cookies.set(GOOGLE_AUTH_OAUTH_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: GOOGLE_OAUTH_STATE_COOKIE_MAX_AGE_SEC,
    path: '/',
  });
  return response;
}
