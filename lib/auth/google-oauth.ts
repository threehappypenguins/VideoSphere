import { safeRedirect } from '@/lib/safe-redirect';

/**
 * Cookie name used to persist Google OAuth CSRF state and flow context.
 */
export const GOOGLE_AUTH_OAUTH_STATE_COOKIE = 'google_auth_oauth_state';

/**
 * OAuth flows supported by the Google auth routes.
 */
export type GoogleOAuthFlow = 'login' | 'setup' | 'invite';

/**
 * Parsed OAuth state stored in the httpOnly cookie during the Google redirect dance.
 */
export interface GoogleOAuthState {
  nonce: string;
  redirectTo: string | null;
  flow: GoogleOAuthFlow;
  setupToken: string | null;
  inviteToken: string | null;
}

/**
 * Input for building the OAuth state cookie value.
 */
export interface BuildGoogleOAuthStateInput {
  nonce: string;
  redirectTo?: string | null;
  setupToken?: string | null;
  inviteToken?: string | null;
}

/**
 * Builds the serialized OAuth state cookie value.
 * @param input - CSRF nonce and optional flow context.
 * @returns Serialized cookie payload.
 */
export function buildGoogleOAuthStateCookie(input: BuildGoogleOAuthStateInput): string {
  const redirectTo = input.redirectTo ? safeRedirect(input.redirectTo) : null;
  const setupToken = input.setupToken?.trim() || null;
  const inviteToken = input.inviteToken?.trim() || null;

  let flow: GoogleOAuthFlow = 'login';
  if (setupToken) flow = 'setup';
  else if (inviteToken) flow = 'invite';

  const payload = {
    r: redirectTo,
    f: flow,
    s: setupToken,
    i: inviteToken,
  };

  return `${input.nonce}|${encodeURIComponent(JSON.stringify(payload))}`;
}

/**
 * Parses the OAuth state cookie set before redirecting to Google.
 * @param cookieValue - Raw cookie value.
 * @returns Parsed state, or null when the cookie is missing or invalid.
 */
export function parseGoogleOAuthStateCookie(cookieValue: string): GoogleOAuthState | null {
  const pipeIndex = cookieValue.indexOf('|');
  if (pipeIndex === -1) return null;

  const nonce = cookieValue.slice(0, pipeIndex);
  if (!nonce) return null;

  const encodedPayload = cookieValue.slice(pipeIndex + 1);
  if (!encodedPayload) {
    return {
      nonce,
      redirectTo: null,
      flow: 'login',
      setupToken: null,
      inviteToken: null,
    };
  }

  try {
    const payload = JSON.parse(decodeURIComponent(encodedPayload)) as {
      r?: unknown;
      f?: unknown;
      s?: unknown;
      i?: unknown;
    };

    const redirectTo = typeof payload.r === 'string' && payload.r ? safeRedirect(payload.r) : null;
    const setupToken = typeof payload.s === 'string' && payload.s.trim() ? payload.s.trim() : null;
    const inviteToken = typeof payload.i === 'string' && payload.i.trim() ? payload.i.trim() : null;

    let flow: GoogleOAuthFlow = 'login';
    if (payload.f === 'setup' || setupToken) flow = 'setup';
    else if (payload.f === 'invite' || inviteToken) flow = 'invite';

    return {
      nonce,
      redirectTo,
      flow,
      setupToken,
      inviteToken,
    };
  } catch {
    return null;
  }
}

/**
 * Builds the Google OAuth initiation URL query string for a given flow.
 * @param input - Optional redirect and registration tokens.
 * @returns Query string including leading `?`, or an empty string.
 */
export function buildGoogleOAuthStartSearchParams(input: {
  redirectTo?: string | null;
  setupToken?: string | null;
  inviteToken?: string | null;
}): string {
  const params = new URLSearchParams();

  const redirectTo = input.redirectTo ? safeRedirect(input.redirectTo) : null;
  if (redirectTo) params.set('redirect', redirectTo);

  const setupToken = input.setupToken?.trim();
  if (setupToken) params.set('setupToken', setupToken);

  const inviteToken = input.inviteToken?.trim();
  if (inviteToken) params.set('inviteToken', inviteToken);

  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Builds a redirect URL for OAuth errors based on setup/invite/login flow context.
 * @param origin - Request origin (scheme + host).
 * @param code - OAuth error code for the `error` query param.
 * @param context - Optional setup or invite token from the initiation request.
 * @returns Absolute redirect URL with a URL-encoded error query param.
 */
export function buildGoogleOAuthErrorRedirect(
  origin: string,
  code: string,
  context: { setupToken?: string | null; inviteToken?: string | null } = {}
): string {
  const encodedError = encodeURIComponent(code);
  const setupToken = context.setupToken?.trim() || null;
  const inviteToken = context.inviteToken?.trim() || null;

  if (setupToken && !inviteToken) {
    return `${origin}/setup?token=${encodeURIComponent(setupToken)}&error=${encodedError}`;
  }
  if (inviteToken && !setupToken) {
    return `${origin}/invite/${encodeURIComponent(inviteToken)}?error=${encodedError}`;
  }
  return `${origin}/login?error=${encodedError}`;
}

const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/**
 * OAuth tokens returned from Google's token endpoint during the auth-code exchange.
 */
export interface GoogleOAuthGrant {
  accessToken?: string;
  refreshToken?: string;
}

/**
 * Revokes Google OAuth tokens so the app is removed from the user's connected-apps list.
 * Failures are logged and do not throw.
 * @param grant - Access and/or refresh token to revoke.
 */
export async function revokeGoogleOAuthTokens(grant: GoogleOAuthGrant): Promise<void> {
  const tokens = [grant.refreshToken, grant.accessToken].filter(
    (token): token is string => typeof token === 'string' && token.length > 0
  );

  for (const token of [...new Set(tokens)]) {
    try {
      const res = await fetch(GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      });
      if (!res.ok) {
        console.warn('[revokeGoogleOAuthTokens] Google revoke returned', res.status);
      }
    } catch (error) {
      console.warn('[revokeGoogleOAuthTokens] Google revoke failed', error);
    }
  }
}
