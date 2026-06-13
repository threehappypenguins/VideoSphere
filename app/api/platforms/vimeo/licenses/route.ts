import { NextRequest, NextResponse } from 'next/server';
import {
  fetchVimeoCreativeCommonsLicenses,
  requireVimeoConnection,
  vimeoUpstreamErrorResponse,
} from '@/lib/platforms/vimeo-api';
import type { VimeoLicenseOption } from '@/lib/platforms/vimeo-licenses';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Returns Vimeo Creative Commons license options for draft metadata UI.
 * @param req - Incoming GET request.
 * @returns JSON list of license code/name pairs, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireVimeoConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  try {
    const result = await fetchVimeoCreativeCommonsLicenses(connection.accessToken, req.signal);
    if (result.ok === false) {
      return vimeoUpstreamErrorResponse(result.details);
    }

    const res: ApiResponse<VimeoLicenseOption[]> = { data: result.items };
    return NextResponse.json(res, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (err) {
    console.error('[GET /api/platforms/vimeo/licenses] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load Vimeo licenses',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
