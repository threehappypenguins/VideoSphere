import { NextRequest, NextResponse } from 'next/server';
import {
  fetchYouTubeVideoCategories,
  requireYouTubeConnection,
  youtubeUpstreamErrorResponse,
} from '@/lib/platforms/youtube-api';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Returns assignable YouTube video categories for the US region (`videoCategories.list`).
 * @param req - Incoming GET request.
 * @returns JSON list of category id/title pairs, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireYouTubeConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  try {
    const result = await fetchYouTubeVideoCategories(connection.accessToken, req.signal);
    if (result.ok === false) {
      return youtubeUpstreamErrorResponse(result.details);
    }

    const res: ApiResponse<Array<{ id: string; title: string }>> = { data: result.items };
    return NextResponse.json(res, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (err) {
    console.error('[GET /api/platforms/youtube/categories] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load YouTube categories',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
