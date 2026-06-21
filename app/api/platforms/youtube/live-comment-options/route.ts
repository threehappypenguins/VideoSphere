import { NextRequest, NextResponse } from 'next/server';
import {
  fetchYouTubeLiveCommentDefaults,
  type YouTubeLiveCommentDefaults,
} from '@/lib/platforms/youtube-livestream-api';
import {
  requireYouTubeConnection,
  youtubeUpstreamErrorResponse,
} from '@/lib/platforms/youtube-api';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Returns comment/ratings defaults readable from the authenticated user's YouTube channel.
 * @param req - Incoming GET request.
 * @returns JSON comment defaults, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireYouTubeConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  try {
    const result = await fetchYouTubeLiveCommentDefaults(connection.accessToken, req.signal);
    if (result.ok === false) {
      return youtubeUpstreamErrorResponse(result.details);
    }

    const res: ApiResponse<YouTubeLiveCommentDefaults> = { data: result.defaults };
    return NextResponse.json(res, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error('[GET /api/platforms/youtube/live-comment-options] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load YouTube live comment options',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
