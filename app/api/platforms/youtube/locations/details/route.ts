import { NextRequest, NextResponse } from 'next/server';
import {
  isGooglePlacesConfigured,
  resolveGooglePlaceLocation,
  type GooglePlaceLocation,
} from '@/lib/platforms/google-places';
import { requireYouTubeConnection } from '@/lib/platforms/youtube-api';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Resolves a Google place id to validated YouTube recording location fields.
 * Proxies Places Details (New) using the server `GOOGLE_PLACES_API_KEY`.
 * @param req - Incoming GET request with `placeId`, `sessionToken`, and optional `description`.
 * @returns JSON location payload, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireYouTubeConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  if (!isGooglePlacesConfigured()) {
    const errRes: ApiError = {
      error: 'Service Unavailable',
      message: 'YouTube location search is not configured.',
      statusCode: 503,
    };
    return NextResponse.json(errRes, { status: 503 });
  }

  const placeId = req.nextUrl.searchParams.get('placeId')?.trim() ?? '';
  const sessionToken = req.nextUrl.searchParams.get('sessionToken')?.trim() ?? '';
  const description = req.nextUrl.searchParams.get('description')?.trim() ?? '';

  if (placeId === '') {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'placeId is required',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (sessionToken === '') {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'sessionToken is required',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  try {
    const result = await resolveGooglePlaceLocation(placeId, sessionToken, description, req.signal);
    if (result.ok === false) {
      const errRes: ApiError = {
        error: 'Bad Gateway',
        message: result.details,
        statusCode: 502,
      };
      return NextResponse.json(errRes, { status: 502 });
    }

    const res: ApiResponse<GooglePlaceLocation> = { data: result.location };
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    console.error('[GET /api/platforms/youtube/locations/details] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to resolve YouTube location',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
