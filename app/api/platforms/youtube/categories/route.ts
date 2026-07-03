import { NextRequest, NextResponse } from 'next/server';
import { fetchYouTubeVideoCategories, runYouTubeDataApiRequest } from '@/lib/platforms/youtube-api';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Returns assignable YouTube video categories for the US region (`videoCategories.list`).
 * @param req - Incoming GET request.
 * @returns JSON list of category id/title pairs, or a structured error.
 */
export async function GET(req: NextRequest) {
  try {
    const result = await runYouTubeDataApiRequest(req, async (accessToken) => {
      const categories = await fetchYouTubeVideoCategories(accessToken, req.signal);
      if (categories.ok === false) {
        return {
          ok: false,
          details: categories.details,
          statusCode: categories.statusCode,
        };
      }
      return { ok: true, data: categories.items };
    });
    if (result.ok === false) {
      return result.response;
    }

    const res: ApiResponse<Array<{ id: string; title: string }>> = { data: result.data };
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
