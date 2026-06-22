import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  fetchYouTubeAccountDefaults,
  mergeYouTubeAccountDefaults,
  requireYouTubeConnection,
  youtubeUpstreamErrorResponse,
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
  const connection = await requireYouTubeConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  try {
    const result = await fetchYouTubeAccountDefaults(connection.accessToken, req.signal);
    if (result.ok === false) {
      return youtubeUpstreamErrorResponse(result.details);
    }

    const userId = await getAuthenticatedUserId(req);
    const user = userId ? await getUserById(userId) : null;
    const defaults = mergeYouTubeAccountDefaults(result.defaults, user?.platformDefaults?.youtube);

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
