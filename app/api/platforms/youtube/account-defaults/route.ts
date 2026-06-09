import { NextRequest, NextResponse } from 'next/server';
import {
  fetchYouTubeAccountDefaults,
  requireYouTubeConnection,
  youtubeUpstreamErrorResponse,
  type YouTubeAccountDefaults,
} from '@/lib/platforms/youtube-api';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Returns upload defaults read from the authenticated user's YouTube channel and latest upload.
 * @param req - Incoming GET request.
 * @returns JSON account defaults, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireYouTubeConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  try {
    const result = await fetchYouTubeAccountDefaults(connection.accessToken, req.signal);
    if (result.ok === false) {
      return youtubeUpstreamErrorResponse(result.details);
    }

    const res: ApiResponse<YouTubeAccountDefaults> = { data: result.defaults };
    return NextResponse.json(res, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error('[GET /api/platforms/youtube/account-defaults] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load YouTube account defaults',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
