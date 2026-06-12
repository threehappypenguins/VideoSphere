/**
 * Facebook Graph API v25.0 OAuth helpers for platform connection flows.
 */

import { createHmac } from 'node:crypto';

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

/** Long-lived user tokens last ~60 days when Meta omits `expires_in`. */
export const FACEBOOK_PROFILE_TOKEN_EXPIRY_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Stored expiry for Page connections. Page access tokens do not expire; this sentinel
 * keeps Page rows out of the OAuth refresh path while the user token remains in `refreshToken`.
 */
export const FACEBOOK_PAGE_TOKEN_EXPIRY_ISO = '2099-01-01T00:00:00.000Z';

/**
 * Computes ISO expiry for a long-lived Facebook user token.
 * @param expiresInSeconds - Lifetime in seconds from Meta's token response.
 * @returns ISO 8601 expiry timestamp.
 */
export function getFacebookUserTokenExpiry(expiresInSeconds?: number): string {
  const ms =
    expiresInSeconds != null && expiresInSeconds > 0
      ? expiresInSeconds * 1000
      : FACEBOOK_PROFILE_TOKEN_EXPIRY_MS;
  return new Date(Date.now() + ms).toISOString();
}

/**
 * Refreshed Facebook Page connection tokens after extending the user token.
 * @property pageAccessToken - Page access token used for Graph API calls.
 * @property userAccessToken - Extended long-lived user access token stored for refresh.
 * @property tokenExpiry - Far-future sentinel for the non-expiring Page access token.
 */
export interface RefreshedFacebookPageTokens {
  pageAccessToken: string;
  userAccessToken: string;
  tokenExpiry: string;
}

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
 * Builds the `appsecret_proof` parameter for server-side Graph API calls.
 * @param accessToken - User or Page access token used on the request.
 * @returns HMAC-SHA256 proof, or undefined when the app secret is not configured.
 */
export function buildFacebookAppSecretProof(accessToken: string): string | undefined {
  const secret = getFacebookAppSecret();
  if (!secret) return undefined;
  return createHmac('sha256', secret).update(accessToken).digest('hex');
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

/**
 * Maximum Pages returned per Graph API request for `/me/accounts`.
 */
export const FACEBOOK_MANAGED_PAGES_PAGE_SIZE = 100;

interface FacebookAccountsResponse {
  data?: FacebookManagedPage[];
  error?: { message?: string; type?: string; code?: number };
  paging?: {
    cursors?: { after?: string; before?: string };
    next?: string;
  };
}

interface FacebookMeResponse {
  id?: string;
  name?: string;
  error?: { message?: string };
}

/**
 * Builds fetch options for authenticated Graph API requests.
 * Uses a Bearer token (not query params) and disables Next.js fetch caching.
 * @param accessToken - OAuth access token for the request.
 * @param init - Optional fetch init (method, etc.).
 * @returns RequestInit with Authorization header and `cache: 'no-store'`.
 */
export function facebookGraphApiFetchInit(
  accessToken: string,
  init: RequestInit = {}
): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  return {
    ...init,
    cache: 'no-store',
    headers,
  };
}

/** Disables Next.js fetch caching for OAuth token exchange responses. */
const FACEBOOK_OAUTH_FETCH_INIT: RequestInit = { cache: 'no-store' };

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

  const res = await fetch(
    `${FACEBOOK_GRAPH_API_BASE}/oauth/access_token?${params.toString()}`,
    FACEBOOK_OAUTH_FETCH_INIT
  );
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

  const res = await fetch(
    `${FACEBOOK_GRAPH_API_BASE}/oauth/access_token?${params.toString()}`,
    FACEBOOK_OAUTH_FETCH_INIT
  );
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
  });
  const res = await fetch(
    `${FACEBOOK_GRAPH_API_BASE}/me?${params.toString()}`,
    facebookGraphApiFetchInit(accessToken)
  );
  if (!res.ok) {
    const body = await res.text();
    console.error('[fetchFacebookMe] Graph API GET /me failed:', res.status, body);
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
 * Follows Graph API cursor pagination so users with many Pages see the full list.
 * @param accessToken - Long-lived user access token.
 * @returns Managed Pages including per-Page access tokens.
 */
export async function fetchFacebookManagedPages(
  accessToken: string
): Promise<FacebookManagedPage[]> {
  const pages: FacebookManagedPage[] = [];
  let after: string | undefined;
  let pageIndex = 0;

  while (true) {
    const params = new URLSearchParams({
      fields: 'id,name,access_token',
      limit: String(FACEBOOK_MANAGED_PAGES_PAGE_SIZE),
    });
    if (after) {
      params.set('after', after);
    }

    const res = await fetch(
      `${FACEBOOK_GRAPH_API_BASE}/me/accounts?${params.toString()}`,
      facebookGraphApiFetchInit(accessToken)
    );
    if (!res.ok) {
      const body = await res.text();
      console.error(
        '[fetchFacebookManagedPages] Graph API GET /me/accounts failed:',
        res.status,
        body
      );
      return pageIndex === 0 ? [] : pages;
    }

    const data = (await res.json()) as FacebookAccountsResponse;
    if (data.error) {
      console.error(
        '[fetchFacebookManagedPages] Graph API GET /me/accounts returned error:',
        data.error
      );
      return pageIndex === 0 ? [] : pages;
    }

    pages.push(
      ...(data.data ?? []).filter((page): page is FacebookManagedPage =>
        Boolean(page.id && page.name && page.access_token)
      )
    );
    pageIndex += 1;

    if (!data.paging?.next) {
      break;
    }

    after = data.paging.cursors?.after;
    if (!after) {
      break;
    }
  }

  return pages;
}

/**
 * Resolves a Page access token for a managed Page using a long-lived user token.
 * @param userAccessToken - Long-lived Facebook user access token.
 * @param pageId - Facebook Page ID to resolve.
 * @returns Page metadata with access token, or null when not found.
 */
export async function resolveFacebookPageAccessToken(
  userAccessToken: string,
  pageId: string
): Promise<FacebookManagedPage | null> {
  const pages = await fetchFacebookManagedPages(userAccessToken);
  return pages.find((page) => page.id === pageId) ?? null;
}

/**
 * Computes token expiry ISO string stored on the connection row.
 * Page connections use a far-future sentinel because Page access tokens do not expire.
 * Profile connections track long-lived user token expiry for refresh scheduling.
 * @param targetType - Page or personal profile target.
 * @param userTokenExpiresIn - Long-lived user token lifetime in seconds from Meta.
 * @returns ISO 8601 expiry timestamp.
 */
export function getFacebookTokenExpiry(
  targetType: 'page' | 'profile',
  userTokenExpiresIn?: number
): string {
  if (targetType === 'page') {
    return FACEBOOK_PAGE_TOKEN_EXPIRY_ISO;
  }
  return getFacebookUserTokenExpiry(userTokenExpiresIn);
}

/**
 * Extends a long-lived user token for a personal profile connection.
 * @param longLivedUserToken - Stored long-lived user access token.
 * @returns Extended user token bundle, or an error message.
 */
export async function refreshFacebookProfileConnection(
  longLivedUserToken: string
): Promise<{ userAccessToken: string; tokenExpiry: string } | { error: string }> {
  const exchanged = await exchangeFacebookShortLivedToken(longLivedUserToken);
  if (!exchanged.access_token) {
    return {
      error: exchanged.error?.message ?? 'Failed to extend Facebook user token.',
    };
  }

  return {
    userAccessToken: exchanged.access_token,
    tokenExpiry: getFacebookUserTokenExpiry(exchanged.expires_in),
  };
}

/**
 * Extends a long-lived user token and re-fetches a Page access token for the given Page ID.
 * @param longLivedUserToken - Stored long-lived user access token.
 * @param pageId - Facebook Page ID to refresh.
 * @returns Refreshed Page and user tokens, or an error message.
 */
/**
 * Resolves the Facebook Page ID for Page-target connections.
 * Profile connections and Page rows missing `facebookPageId` cannot use Page APIs.
 * @param account - Connected Facebook account fields used for Page resolution.
 * @returns Trimmed Page ID when the connection targets a Page with `facebookPageId` set.
 */
export function resolveFacebookPageId(account: {
  facebookTargetType?: 'page' | 'profile';
  facebookPageId?: string;
}): string | null {
  if (account.facebookTargetType === 'profile') {
    return null;
  }
  const pageId = account.facebookPageId?.trim();
  return pageId ? pageId : null;
}

export async function refreshFacebookPageConnection(
  longLivedUserToken: string,
  pageId: string
): Promise<RefreshedFacebookPageTokens | { error: string }> {
  const exchanged = await exchangeFacebookShortLivedToken(longLivedUserToken);
  if (!exchanged.access_token) {
    return {
      error: exchanged.error?.message ?? 'Failed to extend Facebook user token.',
    };
  }

  const pages = await fetchFacebookManagedPages(exchanged.access_token);
  const page = pages.find((entry) => entry.id === pageId);
  if (!page) {
    return {
      error: `Facebook Page ${pageId} is no longer accessible with the stored credentials.`,
    };
  }

  return {
    pageAccessToken: page.access_token,
    userAccessToken: exchanged.access_token,
    tokenExpiry: FACEBOOK_PAGE_TOKEN_EXPIRY_ISO,
  };
}

/**
 * Revokes all permissions the token holder has granted to this Meta app (`DELETE /me/permissions`).
 * Call with a long-lived **user** access token to remove VideoSphere from Business Integrations.
 * @param accessToken - User or Page access token for the identity revoking access.
 * @returns True when Meta accepts the revocation request.
 */
export async function revokeFacebookAppAuthorization(accessToken: string): Promise<boolean> {
  const res = await fetch(
    `${FACEBOOK_GRAPH_API_BASE}/me/permissions`,
    facebookGraphApiFetchInit(accessToken, { method: 'DELETE' })
  );
  return res.ok;
}
