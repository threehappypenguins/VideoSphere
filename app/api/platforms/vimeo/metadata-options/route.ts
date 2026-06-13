import { NextRequest, NextResponse } from 'next/server';
import {
  fetchVimeoDraftMetadataOptions,
  requireVimeoConnection,
  vimeoUpstreamErrorResponse,
  type VimeoDraftMetadataOptions,
} from '@/lib/platforms/vimeo-api';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Returns all Vimeo draft metadata options in one response with a single upstream fetch pass.
 * @param req - Incoming GET request.
 * @returns JSON metadata bundle, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireVimeoConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  try {
    const result = await fetchVimeoDraftMetadataOptions(connection.accessToken, req.signal);
    if (result.ok === false) {
      return vimeoUpstreamErrorResponse(result.details);
    }

    const res: ApiResponse<VimeoDraftMetadataOptions> = { data: result.options };
    return NextResponse.json(res, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error('[GET /api/platforms/vimeo/metadata-options] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load Vimeo metadata options',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
