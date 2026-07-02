import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getDirectMediaUrl, probeNearbyKeyframes } from '@/lib/youtube-import/probe-keyframes';
import type { ApiError, ApiResponse } from '@/types';

const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

function badRequest(message: string): NextResponse {
  const errRes: ApiError = {
    error: 'Bad Request',
    message,
    statusCode: 400,
  };
  return NextResponse.json(errRes, { status: 400 });
}

function badGateway(message: string): NextResponse {
  const errRes: ApiError = {
    error: 'Bad Gateway',
    message,
    statusCode: 502,
  };
  return NextResponse.json(errRes, { status: 502 });
}

/**
 * Returns nearby keyframe timestamps for a YouTube import trim slider.
 * @param req - Incoming GET request with `youtubeVideoId` and `near` query params.
 * @returns Keyframe timestamps near the requested scrub position.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const youtubeVideoId = req.nextUrl.searchParams.get('youtubeVideoId')?.trim() ?? '';
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(youtubeVideoId)) {
    return badRequest('youtubeVideoId must be a valid 11-character YouTube video id');
  }

  const nearRaw = req.nextUrl.searchParams.get('near');
  if (nearRaw == null || nearRaw.trim() === '') {
    return badRequest('near is required');
  }

  const nearSeconds = Number(nearRaw);
  if (!Number.isFinite(nearSeconds) || nearSeconds < 0) {
    return badRequest('near must be a non-negative number');
  }

  try {
    const { url } = await getDirectMediaUrl(youtubeVideoId);
    const keyframeSeconds = await probeNearbyKeyframes(url, nearSeconds);

    const res: ApiResponse<{ keyframeSeconds: number[] }> = { data: { keyframeSeconds } };
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error && err.message.trim() !== ''
        ? err.message.trim()
        : 'Failed to probe nearby keyframes';
    return badGateway(message);
  }
}
