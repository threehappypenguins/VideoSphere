import { NextRequest, NextResponse } from 'next/server';
import { requireSermonAudioConnection } from '@/lib/platforms/sermon-audio-api';
import { fetchRecentSermonAudioSpeakers } from '@/lib/platforms/sermon-audio-speakers';
import type { ApiError, ApiResponse } from '@/types';
import type { SermonAudioSpeakerOption } from '@/lib/platforms/sermon-audio-speakers';

/**
 * Returns recent SermonAudio speakers for the authenticated user's broadcaster.
 * Proxies `GET /v2/node/sermons` (`sortBy=newest`) and derives speakers by preach recency.
 * @param req - Incoming GET request.
 * @returns JSON list of recent speaker options, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireSermonAudioConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  try {
    const speakers = await fetchRecentSermonAudioSpeakers(
      connection.apiKey,
      connection.broadcasterId
    );
    const res: ApiResponse<SermonAudioSpeakerOption[]> = { data: speakers };
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    console.error('[GET /api/platforms/sermon-audio/speakers/recent] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load SermonAudio speakers',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
