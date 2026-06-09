import { NextRequest, NextResponse } from 'next/server';
import {
  autocompleteGooglePlaces,
  isGooglePlacesConfigured,
  YOUTUBE_LOCATION_SEARCH_MIN_LENGTH,
} from '@/lib/platforms/google-places';
import { requireYouTubeConnection } from '@/lib/platforms/youtube-api';
import type { ApiError, ApiResponse } from '@/types';
import type { GooglePlaceSuggestion } from '@/lib/platforms/google-places';

/**
 * Searches Google Places for YouTube video location suggestions.
 * Proxies Places Autocomplete (New) using the server `GOOGLE_PLACES_API_KEY`.
 * @param req - Incoming GET request with `q` and `sessionToken` query parameters.
 * @returns JSON list of place suggestions, or a structured error.
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

  const query = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  const sessionToken = req.nextUrl.searchParams.get('sessionToken')?.trim() ?? '';

  if (query.length < YOUTUBE_LOCATION_SEARCH_MIN_LENGTH) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: `Search query must be at least ${YOUTUBE_LOCATION_SEARCH_MIN_LENGTH} characters`,
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
    const result = await autocompleteGooglePlaces(query, sessionToken, req.signal);
    if (result.ok === false) {
      const errRes: ApiError = {
        error: 'Bad Gateway',
        message: result.details,
        statusCode: 502,
      };
      return NextResponse.json(errRes, { status: 502 });
    }

    const res: ApiResponse<GooglePlaceSuggestion[]> = { data: result.suggestions };
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    console.error('[GET /api/platforms/youtube/locations/search] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to search YouTube locations',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
