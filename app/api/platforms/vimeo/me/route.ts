import { NextRequest, NextResponse } from 'next/server';
import {
  fetchVimeoAccountDefaults,
  requireVimeoConnection,
  vimeoUpstreamErrorResponse,
  type VimeoAccountDefaults,
} from '@/lib/platforms/vimeo-api';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Returns upload defaults read from the authenticated user's Vimeo account (`GET /me`).
 * @param req - Incoming GET request.
 * @returns JSON account defaults, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireVimeoConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  try {
    const result = await fetchVimeoAccountDefaults(connection.accessToken, req.signal);
    if (result.ok === false) {
      return vimeoUpstreamErrorResponse(result.details);
    }

    const res: ApiResponse<VimeoAccountDefaults> = { data: result.defaults };
    return NextResponse.json(res, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error('[GET /api/platforms/vimeo/me] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load Vimeo account defaults',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
