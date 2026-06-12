import { NextRequest, NextResponse } from 'next/server';
import {
  FACEBOOK_RECONNECT_MESSAGE,
  requireFacebookConnection,
  searchFacebookPlacesWithTokenRefresh,
} from '@/lib/platforms/facebook-api';
import {
  FACEBOOK_PLACE_SEARCH_MIN_LENGTH,
  FACEBOOK_PLACES_MANAGED_ONLY_MESSAGE,
} from '@/lib/platforms/facebook-places-types';
import type { ApiError, ApiResponse } from '@/types';
import type { FacebookPlaceOption } from '@/lib/platforms/facebook-places-types';

/**
 * Searches Facebook Pages to tag as a Reel location for the authenticated user's connection.
 * Proxies `GET /pages/search` using the stored user access token (`refreshToken` column).
 * @param req - Incoming GET request with `q` query parameter.
 * @returns JSON list of matching place options, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireFacebookConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  const query = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (query.length < FACEBOOK_PLACE_SEARCH_MIN_LENGTH) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: `Search query must be at least ${FACEBOOK_PLACE_SEARCH_MIN_LENGTH} characters`,
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  try {
    const { places, searchMode } = await searchFacebookPlacesWithTokenRefresh(
      connection.account,
      query
    );
    const res: ApiResponse<FacebookPlaceOption[]> = {
      data: places,
      ...(searchMode === 'managed' ? { message: FACEBOOK_PLACES_MANAGED_ONLY_MESSAGE } : {}),
    };
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    if (err instanceof Error && 'reconnectRequired' in err && err.reconnectRequired) {
      const errRes: ApiError = {
        error: 'Bad Request',
        message: FACEBOOK_RECONNECT_MESSAGE,
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }

    const message =
      err instanceof Error && err.message.trim() !== ''
        ? err.message
        : 'Failed to search Facebook places';
    const upstreamStatus =
      err instanceof Error &&
      'statusCode' in err &&
      typeof (err as Error & { statusCode?: unknown }).statusCode === 'number'
        ? (err as Error & { statusCode: number }).statusCode
        : undefined;
    const statusCode =
      upstreamStatus != null && upstreamStatus >= 400 && upstreamStatus < 600
        ? upstreamStatus
        : 502;

    console.error('[GET /api/platforms/facebook/places] Search failed:', err);
    const errRes: ApiError = {
      error: statusCode >= 500 ? 'Bad Gateway' : 'Bad Request',
      message,
      statusCode,
    };
    return NextResponse.json(errRes, { status: statusCode });
  }
}
