// =============================================================================
// POST /api/livestreams/[id]/facebook-arm — create Facebook LiveVideo and persist ingest URL
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { armFacebookLivestream } from '@/lib/livestreams/arm-facebook-livestream';
import { splitFacebookRtmpIngestUrl } from '@/lib/livestreams/facebook-rtmp-ingest';
import { livestreamFacebookArmConflictWarning } from '@/lib/livestreams/key-slot-conflict';
import { resolveFacebookPageId } from '@/lib/platforms/facebook-oauth';
import { refreshTokenIfNeeded } from '@/lib/platforms/token-refresh';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import {
  getArmedFacebookLivestreamForUser,
  getLivestreamById,
} from '@/lib/repositories/livestreams';
import type { ApiError, ApiResponse, Livestream } from '@/types';

function facebookArmClientErrorResponse(
  details: string,
  statusCode: 400 | 404 | 409
): NextResponse {
  const error = statusCode === 404 ? 'Not Found' : statusCode === 409 ? 'Conflict' : 'Bad Request';
  const errRes: ApiError = {
    error,
    message: details,
    statusCode,
  };
  return NextResponse.json(errRes, { status: statusCode });
}

function facebookUpstreamErrorResponse(details: string): NextResponse {
  const errRes: ApiError = {
    error: 'Bad Gateway',
    message: details,
    statusCode: 502,
  };
  return NextResponse.json(errRes, { status: 502 });
}

/**
 * Handles POST requests for this route.
 * @param req - The incoming request object.
 * @param props - Route params.
 * @returns Updated livestream and RTMPS ingest fields for the encoder UI.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const { id: livestreamId } = await params;

  const livestream = await getLivestreamById(livestreamId);
  if (!livestream || livestream.userId !== userId) {
    const errRes: ApiError = {
      error: 'Not Found',
      message: 'Livestream not found',
      statusCode: 404,
    };
    return NextResponse.json(errRes, { status: 404 });
  }

  const account = await getConnectedAccountWithTokens(userId, 'facebook');
  if (!account) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Facebook is not connected',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const pageId = resolveFacebookPageId(account);
  if (!pageId) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message:
        'Facebook livestreaming requires a connected Facebook Page. Reconnect and select a Page in Settings → Connections.',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  let pageAccessToken: string;
  try {
    const tokens = await refreshTokenIfNeeded(account);
    pageAccessToken = tokens.accessToken.trim();
  } catch (err) {
    console.error('[POST /api/livestreams/:id/facebook-arm] Facebook token refresh failed', err);
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Facebook access token expired. Reconnect Facebook in Settings → Connections.',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const armedFacebookLivestream = await getArmedFacebookLivestreamForUser(userId);
  const result = await armFacebookLivestream(
    pageAccessToken,
    pageId,
    livestream,
    armedFacebookLivestream
  );

  if (result.ok === false) {
    if (result.statusCode === 502) {
      return facebookUpstreamErrorResponse(result.details);
    }
    return facebookArmClientErrorResponse(result.details, result.statusCode);
  }

  const ingest = splitFacebookRtmpIngestUrl(result.livestream.facebookStreamUrl ?? '');
  if (!ingest) {
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Facebook returned an ingest URL in an unexpected format.',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }

  const response: ApiResponse<Livestream> & {
    meta?: { conflictWarning?: string; serverUrl: string; streamKey: string };
  } = {
    data: result.livestream,
    message: 'Facebook stream armed',
    meta: {
      serverUrl: ingest.serverUrl,
      streamKey: ingest.streamKey,
      ...(result.conflict
        ? { conflictWarning: livestreamFacebookArmConflictWarning(result.conflict) }
        : {}),
    },
  };

  return NextResponse.json(response);
}
