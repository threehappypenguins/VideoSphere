import { NextRequest, NextResponse } from 'next/server';
import {
  fetchVimeoContentRatings,
  requireVimeoConnection,
  vimeoUpstreamErrorResponse,
} from '@/lib/platforms/vimeo-api';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Returns Vimeo content rating options for draft metadata UI.
 * @param req - Incoming GET request.
 * @returns JSON list of content rating code/name pairs, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireVimeoConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  try {
    const result = await fetchVimeoContentRatings(connection.accessToken, req.signal);
    if (result.ok === false) {
      return vimeoUpstreamErrorResponse(result.details);
    }

    const res: ApiResponse<Array<{ code: string; name: string }>> = { data: result.items };
    return NextResponse.json(res, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (err) {
    console.error('[GET /api/platforms/vimeo/content-ratings] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load Vimeo content ratings',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
