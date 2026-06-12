import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  FACEBOOK_PAGE_TOKEN_EXPIRY_ISO,
  refreshFacebookPageConnection,
} from '@/lib/platforms/facebook-oauth';
import {
  isFacebookGraphTokenError,
  searchFacebookPlacesWithFallback,
  type FacebookPlacesSearchResult,
} from '@/lib/platforms/facebook-places';
import { getConnectedAccountWithTokens, updateTokens } from '@/lib/repositories/connected-accounts';
import type { ConnectedAccount, ApiError } from '@/types';

/** User-facing message when Facebook tokens cannot be refreshed. */
export const FACEBOOK_RECONNECT_MESSAGE =
  'Your Facebook connection has expired. Please reconnect your Facebook account in Settings → Connections.';

type FacebookConnectionResult =
  | { ok: true; account: ConnectedAccount }
  | { ok: false; response: NextResponse };

/**
 * Resolves the authenticated user's Facebook Page connection for API proxy routes.
 * @param req - Incoming request (session auth).
 * @returns Connected account with tokens, or an error response.
 */
export async function requireFacebookConnection(
  req: NextRequest
): Promise<FacebookConnectionResult> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return { ok: false, response: NextResponse.json(errRes, { status: 401 }) };
  }

  const account = await getConnectedAccountWithTokens(userId, 'facebook');
  if (!account) {
    const errRes: ApiError = {
      error: 'Not Found',
      message: 'Facebook is not connected',
      statusCode: 404,
    };
    return { ok: false, response: NextResponse.json(errRes, { status: 404 }) };
  }

  const pageId = account.facebookPageId?.trim() || account.platformUserId.trim();
  if (!pageId) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'Facebook Page ID is missing on the connected account',
      statusCode: 400,
    };
    return { ok: false, response: NextResponse.json(errRes, { status: 400 }) };
  }

  const userToken = account.refreshToken.trim();
  if (!userToken) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: FACEBOOK_RECONNECT_MESSAGE,
      statusCode: 400,
    };
    return { ok: false, response: NextResponse.json(errRes, { status: 400 }) };
  }

  return { ok: true, account: { ...account, facebookPageId: pageId } };
}

/**
 * Executes a Facebook place search with silent token refresh on OAuth failures.
 * Falls back to managed Pages when global `/pages/search` is unavailable for the Meta app.
 * @param account - Facebook connected account including user token in `refreshToken`.
 * @param query - Search query text.
 * @returns Place search results and search mode metadata.
 */
export async function searchFacebookPlacesWithTokenRefresh(
  account: ConnectedAccount,
  query: string
): Promise<FacebookPlacesSearchResult> {
  const pageId = account.facebookPageId?.trim() || account.platformUserId.trim();
  let userToken = account.refreshToken.trim();

  const runSearch = () => searchFacebookPlacesWithFallback(userToken, query);

  try {
    return await runSearch();
  } catch (firstErr) {
    const graphBody =
      firstErr instanceof Error && 'graphBody' in firstErr
        ? (firstErr as Error & { graphBody?: unknown }).graphBody
        : undefined;
    if (!isFacebookGraphTokenError(graphBody)) {
      throw firstErr;
    }

    const refreshed = await refreshFacebookPageConnection(userToken, pageId);
    if ('error' in refreshed) {
      const err = new Error(FACEBOOK_RECONNECT_MESSAGE) as Error & { reconnectRequired?: boolean };
      err.reconnectRequired = true;
      throw err;
    }

    await updateTokens(
      account.id,
      refreshed.pageAccessToken,
      refreshed.userAccessToken,
      refreshed.tokenExpiry ?? FACEBOOK_PAGE_TOKEN_EXPIRY_ISO
    );
    userToken = refreshed.userAccessToken;

    try {
      return await runSearch();
    } catch (retryErr) {
      const retryBody =
        retryErr instanceof Error && 'graphBody' in retryErr
          ? (retryErr as Error & { graphBody?: unknown }).graphBody
          : undefined;
      if (isFacebookGraphTokenError(retryBody)) {
        const err = new Error(FACEBOOK_RECONNECT_MESSAGE) as Error & {
          reconnectRequired?: boolean;
        };
        err.reconnectRequired = true;
        throw err;
      }
      throw retryErr;
    }
  }
}
