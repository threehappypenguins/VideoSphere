import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  fetchYouTubeAccountDefaults,
  mergeYouTubeAccountDefaults,
  runYouTubeDataApiRequest,
  type YouTubeAccountDefaults,
} from '@/lib/platforms/youtube-api';
import { getUserById } from '@/lib/repositories/users';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Returns upload defaults for the authenticated user's YouTube channel, recent non-live uploads,
 * and any saved profile defaults (`platformDefaults.youtube`).
 * @param req - Incoming GET request.
 * @returns JSON account defaults, or a structured error.
 */
export async function GET(req: NextRequest) {
  try {
    const result = await runYouTubeDataApiRequest(req, async (accessToken) => {
      const defaultsResult = await fetchYouTubeAccountDefaults(accessToken, req.signal);
      if (defaultsResult.ok === false) {
        return {
          ok: false,
          details: defaultsResult.details,
          statusCode: defaultsResult.statusCode,
        };
      }
      return { ok: true, data: defaultsResult.defaults };
    });
    if (result.ok === false) {
      return result.response;
    }

    const userId = await getAuthenticatedUserId(req);
    const user = userId ? await getUserById(userId) : null;
    const defaults = mergeYouTubeAccountDefaults(result.data, user?.platformDefaults?.youtube);

    const res: ApiResponse<YouTubeAccountDefaults> = { data: defaults };
    return NextResponse.json(res, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
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
