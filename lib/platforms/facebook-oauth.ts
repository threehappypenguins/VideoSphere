/**
 * Facebook Graph API v25.0 OAuth helpers for platform connection flows.
 */

/** Facebook Login OAuth dialog base URL. */
export const FACEBOOK_OAUTH_DIALOG_URL = 'https://www.facebook.com/v25.0/dialog/oauth';

/** Facebook Graph API base URL. */
export const FACEBOOK_GRAPH_API_BASE = 'https://graph.facebook.com/v25.0';

/** Scopes required for Page video publishing via the Video API. */
export const FACEBOOK_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
].join(',');

/** Page access tokens from long-lived user tokens do not expire — store far-future expiry. */
export const FACEBOOK_PAGE_TOKEN_EXPIRY_MS = 100 * 365 * 24 * 60 * 60 * 1000;

/** Long-lived user tokens last ~60 days. */
export const FACEBOOK_PROFILE_TOKEN_EXPIRY_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Returns the Facebook App ID from environment variables.
 * @returns App ID or null when unset.
 */
export function getFacebookAppId(): string | null {
  const value = process.env.FACEBOOK_APP_ID?.trim();
  return value ? value : null;
}

/**
 * Returns the Facebook App Secret from environment variables.
 * @returns App secret or null when unset.
 */
export function getFacebookAppSecret(): string | null {
  const value = process.env.FACEBOOK_APP_SECRET?.trim();
  return value ? value : null;
}

/**
 * Builds the OAuth redirect URI for the Facebook platform callback.
 * @param origin - Request origin (e.g. `https://app.example.com`).
 * @returns Fully-qualified callback URL.
 */
export function getFacebookRedirectUri(origin: string): string {
  return `${origin}/api/platforms/callback/facebook`;
}

interface FacebookTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; type?: string; code?: number };
}

/**
 * A Facebook Page returned by `GET /me/accounts`.
 * @property id - Page ID.
 * @property name - Page display name.
 * @property access_token - Never-expiring Page access token.
 */
export interface FacebookManagedPage {
  id: string;
  name: string;
  access_token: string;
}

interface FacebookAccountsResponse {
  data?: FacebookManagedPage[];
  error?: { message?: string };
}

interface FacebookMeResponse {
  id?: string;
  name?: string;
  error?: { message?: string };
}

/**
 * Exchanges an authorization code for a short-lived user access token.
 * @param code - Authorization code from the OAuth callback.
 * @param redirectUri - Registered redirect URI.
 * @returns Short-lived access token response.
 */
export async function exchangeFacebookCodeForToken(
  code: string,
  redirectUri: string
): Promise<FacebookTokenResponse> {
  const clientId = getFacebookAppId();
  const clientSecret = getFacebookAppSecret();
  if (!clientId || !clientSecret) {
    throw new Error('Facebook OAuth credentials are not configured.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch(`${FACEBOOK_GRAPH_API_BASE}/oauth/access_token?${params.toString()}`);
  return (await res.json()) as FacebookTokenResponse;
}

/**
 * Exchanges a short-lived user token for a long-lived user token (~60 days).
 * @param shortLivedToken - Short-lived user access token.
 * @returns Long-lived access token response.
 */
export async function exchangeFacebookShortLivedToken(
  shortLivedToken: string
): Promise<FacebookTokenResponse> {
  const clientId = getFacebookAppId();
  const clientSecret = getFacebookAppSecret();
  if (!clientId || !clientSecret) {
    throw new Error('Facebook OAuth credentials are not configured.');
  }

  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: clientId,
    client_secret: clientSecret,
    fb_exchange_token: shortLivedToken,
  });

  const res = await fetch(`${FACEBOOK_GRAPH_API_BASE}/oauth/access_token?${params.toString()}`);
  return (await res.json()) as FacebookTokenResponse;
}

/**
 * Fetches the authenticated Facebook user's profile (`GET /me`).
 * @param accessToken - User access token.
 * @returns User ID and display name.
 */
export async function fetchFacebookMe(
  accessToken: string
): Promise<{ id: string; name: string } | null> {
  const params = new URLSearchParams({
    fields: 'id,name',
    access_token: accessToken,
  });
  const res = await fetch(`${FACEBOOK_GRAPH_API_BASE}/me?${params.toString()}`);
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as FacebookMeResponse;
  if (!data.id || !data.name) {
    return null;
  }
  return { id: data.id, name: data.name };
}

/**
 * Fetches Pages the user manages (`GET /me/accounts`).
 * @param accessToken - Long-lived user access token.
 * @returns Managed Pages including per-Page access tokens.
 */
export async function fetchFacebookManagedPages(
  accessToken: string
): Promise<FacebookManagedPage[]> {
  const params = new URLSearchParams({
    fields: 'id,name,access_token',
    access_token: accessToken,
  });
  const res = await fetch(`${FACEBOOK_GRAPH_API_BASE}/me/accounts?${params.toString()}`);
  if (!res.ok) {
    return [];
  }
  const data = (await res.json()) as FacebookAccountsResponse;
  return (data.data ?? []).filter((page): page is FacebookManagedPage =>
    Boolean(page.id && page.name && page.access_token)
  );
}

/**
 * Computes token expiry ISO string for a Facebook connection target.
 * @param targetType - Page or personal profile target.
 * @returns ISO 8601 expiry timestamp.
 */
export function getFacebookTokenExpiry(targetType: 'page' | 'profile'): string {
  const ms =
    targetType === 'page' ? FACEBOOK_PAGE_TOKEN_EXPIRY_MS : FACEBOOK_PROFILE_TOKEN_EXPIRY_MS;
  return new Date(Date.now() + ms).toISOString();
}
