import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  buildYoutubeImportPreviewStreamPath,
  resolvePreviewDirectMediaUrl,
} from '@/lib/youtube-import/preview-media-url';
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
 * Returns preview stream metadata for the import trim editor.
 * @param req - Incoming GET request with `youtubeVideoId`.
 * @returns Same-origin stream URL and upstream expiry timestamp.
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

  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1';

  try {
    const { expiresAt } = await resolvePreviewDirectMediaUrl(userId, youtubeVideoId, {
      forceRefresh,
    });

    const res: ApiResponse<{ streamUrl: string; expiresAt: number }> = {
      data: {
        streamUrl: buildYoutubeImportPreviewStreamPath(youtubeVideoId),
        expiresAt,
      },
    };
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error && err.message.trim() !== ''
        ? err.message.trim()
        : 'Failed to resolve preview media';
    return badGateway(message);
  }
}
