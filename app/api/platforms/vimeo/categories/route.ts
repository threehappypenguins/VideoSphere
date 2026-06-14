import { NextRequest, NextResponse } from 'next/server';
import {
  fetchVimeoCategories,
  requireVimeoConnection,
  vimeoUpstreamErrorResponse,
  type VimeoCategoryOption,
} from '@/lib/platforms/vimeo-api';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Returns top-level Vimeo categories for draft metadata UI.
 * @param req - Incoming GET request.
 * @returns JSON list of category URI/name pairs, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireVimeoConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  try {
    const result = await fetchVimeoCategories(connection.accessToken, req.signal);
    if (result.ok === false) {
      return vimeoUpstreamErrorResponse(result.details);
    }

    const res: ApiResponse<VimeoCategoryOption[]> = { data: result.items };
    return NextResponse.json(res, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (err) {
    console.error('[GET /api/platforms/vimeo/categories] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load Vimeo categories',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
