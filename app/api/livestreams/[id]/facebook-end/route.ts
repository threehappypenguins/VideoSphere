// =============================================================================
// POST /api/livestreams/[id]/facebook-end — end a Facebook livestream locally and on Meta
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { endFacebookLiveVideo } from '@/lib/platforms/facebook-livestream-api';
import { resolveFacebookPageId } from '@/lib/platforms/facebook-oauth';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import { getLivestreamById, updateLivestream } from '@/lib/repositories/livestreams';
import type { ApiError, ApiResponse, Livestream } from '@/types';

/**
 * Handles POST requests for this route.
 * @param req - The incoming request object.
 * @param props - Route params.
 * @returns Updated livestream row marked ended locally.
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

  const facebookLiveVideoId = livestream.facebookLiveVideoId?.trim();
  if (!facebookLiveVideoId) {
    const errRes: ApiError = {
      error: 'Conflict',
      message: 'Livestream is not armed for Facebook.',
      statusCode: 409,
    };
    return NextResponse.json(errRes, { status: 409 });
  }

  const account = await getConnectedAccountWithTokens(userId, 'facebook');
  if (account) {
    const pageId = resolveFacebookPageId(account);
    if (pageId) {
      const endResult = await endFacebookLiveVideo(account.accessToken, facebookLiveVideoId);
      if (endResult.ok === false) {
        console.warn(
          '[POST /api/livestreams/:id/facebook-end] Facebook end_live_video failed:',
          endResult.details
        );
      }
    }
  }

  let updated: Livestream | null;
  try {
    updated = await updateLivestream(livestreamId, {
      status: 'ended',
      facebookLifecycleStatus: 'VOD',
    });
  } catch (err) {
    console.error('[POST /api/livestreams/:id/facebook-end] updateLivestream', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to update livestream after ending Facebook stream',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }

  if (!updated) {
    const errRes: ApiError = {
      error: 'Not Found',
      message: 'Livestream not found',
      statusCode: 404,
    };
    return NextResponse.json(errRes, { status: 404 });
  }

  const response: ApiResponse<Livestream> = {
    data: updated,
    message: 'Facebook stream ended',
  };
  return NextResponse.json(response);
}
