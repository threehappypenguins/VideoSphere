import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { fetchProxiedPreviewMedia } from '@/lib/youtube-import/proxy-preview-media';
import { resolvePreviewDirectMediaUrl } from '@/lib/youtube-import/preview-media-url';
import type { ApiError } from '@/types';

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
 * Streams proxied preview media for the import trim editor with HTTP Range support.
 * @param req - Incoming GET request with `youtubeVideoId` and optional `refresh=1`.
 * @returns Proxied media bytes from the YouTube CDN.
 */
export async function GET(req: NextRequest): Promise<NextResponse | Response> {
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
    const { url } = await resolvePreviewDirectMediaUrl(userId, youtubeVideoId, {
      forceRefresh,
    });
    const rangeHeader = req.headers.get('range');
    return await fetchProxiedPreviewMedia(url, rangeHeader);
  } catch (err) {
    const message =
      err instanceof Error && err.message.trim() !== ''
        ? err.message.trim()
        : 'Failed to stream preview media';
    return badGateway(message);
  }
}
