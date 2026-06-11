// =============================================================================
// POST /api/platforms/connect/facebook/complete
// =============================================================================
// Finalizes a Facebook connection after the user selects a Page on the setup
// picker. Reads the encrypted setup session cookie, stores the Page access
// token plus the long-lived user token (for automatic refresh), and upserts
// the connected_accounts row.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { isTokenDecryptError } from '@/lib/crypto/token-encryption';
import {
  createConnectedAccount,
  getConnectedAccountRowId,
  getConnectedAccountWithTokens,
  updateConnection,
} from '@/lib/repositories/connected-accounts';
import {
  getFacebookTokenExpiry,
  resolveFacebookPageAccessToken,
} from '@/lib/platforms/facebook-oauth';
import {
  clearFacebookSetupSessionCookie,
  readFacebookSetupSessionFromRequest,
} from '@/lib/platforms/facebook-setup-session';
import type { ConnectedAccountPublic } from '@/types';

interface CompleteFacebookConnectionBody {
  targetType?: unknown;
  pageId?: unknown;
}

/**
 * Returns a connect-style JSON error response for the Facebook setup picker.
 * @param status - HTTP status code.
 * @param code - Stable machine-readable error code.
 * @param message - User-facing error message.
 * @returns JSON response body `{ ok: false, error: { code, message } }`.
 */
function facebookCompleteError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

/**
 * Handles POST requests for this route.
 * @param req - The incoming request object.
 * @returns Saved connection in public shape or an error response.
 */
export async function POST(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return facebookCompleteError(401, 'UNAUTHORIZED', 'Not authenticated.');
  }

  const setupSession = readFacebookSetupSessionFromRequest(req);
  if (!setupSession || setupSession.userId !== userId) {
    return facebookCompleteError(
      400,
      'FACEBOOK_SETUP_SESSION_EXPIRED',
      'Facebook setup session expired. Please connect again.'
    );
  }

  let body: CompleteFacebookConnectionBody;
  try {
    body = (await req.json()) as CompleteFacebookConnectionBody;
  } catch {
    return facebookCompleteError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const targetType = body.targetType;
  if (targetType !== 'page' && targetType !== 'profile') {
    return facebookCompleteError(
      400,
      'FACEBOOK_TARGET_TYPE_INVALID',
      'targetType must be "page" or "profile".'
    );
  }

  let accessToken: string;
  let platformUserId: string;
  let platformName: string;
  let facebookPageId: string | undefined;

  if (targetType === 'page') {
    const pageId = typeof body.pageId === 'string' ? body.pageId.trim() : '';
    if (!pageId) {
      return facebookCompleteError(
        400,
        'FACEBOOK_PAGE_ID_REQUIRED',
        'pageId is required when targetType is "page".'
      );
    }

    const resolvedPage = await resolveFacebookPageAccessToken(setupSession.userAccessToken, pageId);
    if (!resolvedPage) {
      return facebookCompleteError(
        400,
        'FACEBOOK_PAGE_NOT_FOUND',
        'Selected Page was not found in your managed Pages list.'
      );
    }

    accessToken = resolvedPage.access_token;
    platformUserId = resolvedPage.id;
    platformName = resolvedPage.name;
    facebookPageId = resolvedPage.id;
  } else {
    accessToken = setupSession.userAccessToken;
    platformUserId = setupSession.userProfileId;
    platformName = setupSession.userProfileName;
  }

  const tokenExpiry = getFacebookTokenExpiry(targetType, setupSession.userTokenExpiresIn);
  const userRefreshToken = setupSession.userAccessToken;
  const facebookFields: {
    facebookTargetType: 'page' | 'profile';
    facebookPageId?: string;
  } = {
    facebookTargetType: targetType,
    ...(facebookPageId ? { facebookPageId } : {}),
  };

  try {
    let existingId: string | null = null;

    try {
      const existingWithTokens = await getConnectedAccountWithTokens(userId, 'facebook');
      if (existingWithTokens) {
        existingId = existingWithTokens.id;
      }
    } catch (err) {
      if (!isTokenDecryptError(err)) {
        throw err;
      }
      const existing = await getConnectedAccountRowId(userId, 'facebook');
      existingId = existing?.id ?? null;
    }

    let account: ConnectedAccountPublic | null;
    if (existingId) {
      account = await updateConnection(
        existingId,
        accessToken,
        userRefreshToken,
        tokenExpiry,
        platformUserId,
        platformName,
        undefined,
        undefined,
        facebookFields
      );
    } else {
      account = await createConnectedAccount({
        userId,
        platform: 'facebook',
        accessToken,
        refreshToken: userRefreshToken,
        tokenExpiry,
        platformUserId,
        platformName,
        facebookTargetType: targetType,
        ...(facebookPageId ? { facebookPageId } : {}),
      });
    }

    const response = NextResponse.json({ ok: true, data: account });
    clearFacebookSetupSessionCookie(response);
    return response;
  } catch (err) {
    console.error('[POST /api/platforms/connect/facebook/complete] Unexpected error:', err);
    return facebookCompleteError(
      500,
      'FACEBOOK_CONNECTION_SAVE_FAILED',
      'Failed to save Facebook connection.'
    );
  }
}
