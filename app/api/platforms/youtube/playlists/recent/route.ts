import { NextRequest, NextResponse } from 'next/server';
import {
  requireYouTubeConnection,
  youtubeUpstreamErrorResponse,
} from '@/lib/platforms/youtube-api';
import { youtubeFetchPlaylistsPage } from '@/lib/platforms/youtube';
import type { ApiError, ApiResponse } from '@/types';

/**
 * Returns the first page of the authenticated user's YouTube playlists (`playlists.list`, up to 50).
 * Used by the draft playlist picker; upload-time title resolution paginates separately when needed.
 * @param req - Incoming GET request.
 * @returns JSON list of playlist id/title pairs, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireYouTubeConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  try {
    const result = await youtubeFetchPlaylistsPage(connection.accessToken, undefined, req.signal);
    if (result.ok === false) {
      return youtubeUpstreamErrorResponse(
        result.error.details ?? result.error.message ?? 'Failed to list YouTube playlists.'
      );
    }

    const res: ApiResponse<Array<{ id: string; title: string }>> = { data: result.items };
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    console.error('[GET /api/platforms/youtube/playlists/recent] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load YouTube playlists',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
