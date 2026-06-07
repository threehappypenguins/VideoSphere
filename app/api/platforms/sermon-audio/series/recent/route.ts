import { NextRequest, NextResponse } from 'next/server';
import { requireSermonAudioConnection } from '@/lib/platforms/sermon-audio-api';
import {
  SermonAudioUpstreamHttpError,
  isSermonAudioCredentialsFailure,
  sermonAudioUpstreamResponseStatus,
} from '@/lib/platforms/sermon-audio-http';
import { fetchRecentSermonAudioSeries } from '@/lib/platforms/sermon-audio-series';
import type { ApiError, ApiResponse } from '@/types';
import type { SermonAudioSeriesOption } from '@/lib/platforms/sermon-audio-series';

/**
 * Returns recent SermonAudio series for the authenticated user's broadcaster.
 * Proxies `GET /v2/node/sermons` (`sortBy=newest`) and derives series by usage recency.
 * @param req - Incoming GET request.
 * @returns JSON list of recent series options, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireSermonAudioConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  try {
    const series = await fetchRecentSermonAudioSeries(connection.apiKey, connection.broadcasterId);
    const res: ApiResponse<SermonAudioSeriesOption[]> = { data: series };
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    if (err instanceof SermonAudioUpstreamHttpError) {
      if (isSermonAudioCredentialsFailure(err.status)) {
        const errRes: ApiError = {
          error: 'Bad Request',
          message:
            'SermonAudio API key is invalid or revoked. Reconnect SermonAudio in account settings.',
          statusCode: err.status,
        };
        return NextResponse.json(errRes, { status: 400 });
      }

      const errRes: ApiError = {
        error: 'Bad Gateway',
        message: 'SermonAudio is temporarily unavailable. Try again in a few minutes.',
        statusCode: err.status,
      };
      return NextResponse.json(errRes, {
        status: sermonAudioUpstreamResponseStatus(err.status),
      });
    }

    console.error('[GET /api/platforms/sermon-audio/series/recent] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load SermonAudio series',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
