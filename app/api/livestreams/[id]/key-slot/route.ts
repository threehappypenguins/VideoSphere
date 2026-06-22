// =============================================================================
// PATCH /api/livestreams/[id]/key-slot — switch main/temp YouTube stream key slot
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { changeLivestreamKeySlot } from '@/lib/livestreams/change-livestream-key-slot';
import { livestreamKeySlotConflictWarning } from '@/lib/livestreams/key-slot-conflict';
import {
  requireYouTubeConnection,
  youtubeUpstreamErrorResponse,
} from '@/lib/platforms/youtube-api';
import { getConnectedAccountWithTokens } from '@/lib/repositories/connected-accounts';
import {
  getLivestreamById,
  listArmedYouTubeLivestreamsForUser,
} from '@/lib/repositories/livestreams';
import type { ApiError, ApiResponse, Livestream, LivestreamKeySlot } from '@/types';

interface KeySlotBody {
  keySlot?: unknown;
}

function parseKeySlot(value: unknown): LivestreamKeySlot | null {
  if (value === 'main' || value === 'temp') {
    return value;
  }
  return null;
}

function keySlotClientErrorResponse(details: string, statusCode: 400 | 404 | 409): NextResponse {
  const error = statusCode === 404 ? 'Not Found' : statusCode === 409 ? 'Conflict' : 'Bad Request';
  const errRes: ApiError = {
    error,
    message: details,
    statusCode,
  };
  return NextResponse.json(errRes, { status: statusCode });
}

/**
 * Handles PATCH requests for this route.
 * @param req - The incoming request object.
 * @param props - Route params.
 * @returns Updated livestream and optional key-slot conflict metadata.
 */
export async function PATCH(
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

  let body: KeySlotBody;
  try {
    body = (await req.json()) as KeySlotBody;
  } catch {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'Invalid JSON body',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  const nextSlot = parseKeySlot(body.keySlot);
  if (!nextSlot) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'keySlot must be "main" or "temp"',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  const livestream = await getLivestreamById(livestreamId);
  if (!livestream || livestream.userId !== userId) {
    const errRes: ApiError = {
      error: 'Not Found',
      message: 'Livestream not found',
      statusCode: 404,
    };
    return NextResponse.json(errRes, { status: 404 });
  }

  const youtubeConnection = await requireYouTubeConnection(req);
  if (youtubeConnection.ok === false) {
    return youtubeConnection.response;
  }

  const account = await getConnectedAccountWithTokens(userId, 'youtube');
  if (!account) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'YouTube is not connected',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const armed = await listArmedYouTubeLivestreamsForUser(userId);
  const result = await changeLivestreamKeySlot(
    youtubeConnection.accessToken,
    account,
    livestream,
    armed,
    nextSlot
  );

  if (result.ok === false) {
    if (result.statusCode === 502) {
      return youtubeUpstreamErrorResponse(result.details);
    }
    return keySlotClientErrorResponse(result.details, result.statusCode);
  }

  const response: ApiResponse<Livestream> & {
    meta?: { keySlotConflictWarning?: string };
  } = {
    data: result.livestream,
    message: 'Stream key updated',
    ...(result.conflict
      ? { meta: { keySlotConflictWarning: livestreamKeySlotConflictWarning(result.conflict) } }
      : {}),
  };

  return NextResponse.json(response);
}
