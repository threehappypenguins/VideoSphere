import { NextRequest, NextResponse } from 'next/server';
import { fetchYouTubeI18nLanguages, runYouTubeDataApiRequest } from '@/lib/platforms/youtube-api';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Returns supported YouTube i18n languages (`i18nLanguages.list`), sorted by display name.
 * @param req - Incoming GET request.
 * @returns JSON list of BCP-47 language id and English name pairs, or a structured error.
 */
export async function GET(req: NextRequest) {
  try {
    const result = await runYouTubeDataApiRequest(req, async (accessToken) => {
      const languages = await fetchYouTubeI18nLanguages(accessToken, req.signal);
      if (languages.ok === false) {
        return {
          ok: false,
          details: languages.details,
          statusCode: languages.statusCode,
        };
      }
      return { ok: true, data: languages.items };
    });
    if (result.ok === false) {
      return result.response;
    }

    const res: ApiResponse<Array<{ id: string; name: string }>> = { data: result.data };
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
