import { NextRequest, NextResponse } from 'next/server';
import {
  fetchYouTubeI18nLanguages,
  requireYouTubeConnection,
  youtubeUpstreamErrorResponse,
} from '@/lib/platforms/youtube-api';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Returns supported YouTube i18n languages (`i18nLanguages.list`), sorted by display name.
 * @param req - Incoming GET request.
 * @returns JSON list of BCP-47 language id and English name pairs, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireYouTubeConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  try {
    const result = await fetchYouTubeI18nLanguages(connection.accessToken, req.signal);
    if (result.ok === false) {
      return youtubeUpstreamErrorResponse(result.details);
    }

    const res: ApiResponse<Array<{ id: string; name: string }>> = { data: result.items };
    return NextResponse.json(res, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=604800',
      },
    });
  } catch (err) {
    console.error('[GET /api/platforms/youtube/languages] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load YouTube languages',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
