// =============================================================================
// POST /api/platforms/connect/facebook/complete
// =============================================================================
// Finalizes a Facebook connection after the user selects a Page or personal
// profile on the setup picker. Reads the encrypted setup session cookie,
// stores the appropriate access token (Page token or long-lived user token),
// and upserts the connected_accounts row.
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
import { getFacebookTokenExpiry } from '@/lib/platforms/facebook-oauth';
import {
  clearFacebookSetupSessionCookie,
  readFacebookSetupSessionFromRequest,
} from '@/lib/platforms/facebook-setup-session';
import type { ApiError, ConnectedAccountPublic } from '@/types';

interface CompleteFacebookConnectionBody {
  targetType?: unknown;
  pageId?: unknown;
}

/**
 * Handles POST requests for this route.
 * @param req - The incoming request object.
 * @returns Saved connection in public shape or an error response.
 */
export async function POST(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const setupSession = readFacebookSetupSessionFromRequest(req);
  if (!setupSession || setupSession.userId !== userId) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'Facebook setup session expired. Please connect again.',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  let body: CompleteFacebookConnectionBody;
  try {
    body = (await req.json()) as CompleteFacebookConnectionBody;
  } catch {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'Invalid JSON body.',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  const targetType = body.targetType;
  if (targetType !== 'page' && targetType !== 'profile') {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'targetType must be "page" or "profile".',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  let accessToken: string;
  let platformUserId: string;
  let platformName: string;
  let facebookPageId: string | undefined;

  if (targetType === 'page') {
    const pageId = typeof body.pageId === 'string' ? body.pageId.trim() : '';
    if (!pageId) {
      const errRes: ApiError = {
        error: 'Bad Request',
        message: 'pageId is required when targetType is "page".',
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }

    const page = setupSession.pages.find((entry) => entry.id === pageId);
    if (!page) {
      const errRes: ApiError = {
        error: 'Bad Request',
        message: 'Selected Page was not found in your managed Pages list.',
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }

    accessToken = page.access_token;
    platformUserId = page.id;
    platformName = page.name;
    facebookPageId = page.id;
  } else {
    accessToken = setupSession.userAccessToken;
    platformUserId = setupSession.userProfileId;
    platformName = setupSession.userProfileName;
  }

  const tokenExpiry = getFacebookTokenExpiry(targetType);
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
        '',
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
        refreshToken: '',
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
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to save Facebook connection.',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
