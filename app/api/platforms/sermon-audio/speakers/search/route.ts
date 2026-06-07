import { NextRequest, NextResponse } from 'next/server';
import { requireSermonAudioConnection } from '@/lib/platforms/sermon-audio-api';
import {
  SermonAudioUpstreamHttpError,
  isSermonAudioCredentialsFailure,
  sermonAudioUpstreamResponseStatus,
} from '@/lib/platforms/sermon-audio-http';
import {
  searchSermonAudioSpeakers,
  SERMON_AUDIO_SPEAKER_SEARCH_MIN_LENGTH,
} from '@/lib/platforms/sermon-audio-speakers';
import type { ApiError, ApiResponse } from '@/types';
import type { SermonAudioSpeakerOption } from '@/lib/platforms/sermon-audio-speakers';

/**
 * Searches SermonAudio speakers by name for the authenticated user's connected account.
 * Proxies `GET /v2/node/search?searchFor=Speaker`.
 * @param req - Incoming GET request with `q` query parameter.
 * @returns JSON list of matching speaker options, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireSermonAudioConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  const query = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (query.length < SERMON_AUDIO_SPEAKER_SEARCH_MIN_LENGTH) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: `Search query must be at least ${SERMON_AUDIO_SPEAKER_SEARCH_MIN_LENGTH} characters`,
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  try {
    const speakers = await searchSermonAudioSpeakers(connection.apiKey, query);
    const res: ApiResponse<SermonAudioSpeakerOption[]> = { data: speakers };
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    if (err instanceof SermonAudioUpstreamHttpError) {
      if (isSermonAudioCredentialsFailure(err.status)) {
        const errRes: ApiError = {
          error: 'Bad Request',
          message:
            'SermonAudio API key is invalid or revoked. Reconnect SermonAudio in account settings.',
          statusCode: 400,
        };
        return NextResponse.json(errRes, { status: 400 });
      }

      const status = sermonAudioUpstreamResponseStatus(err.status);
      const errRes: ApiError = {
        error: 'Bad Gateway',
        message: 'SermonAudio is temporarily unavailable. Try again in a few minutes.',
        statusCode: status,
      };
      return NextResponse.json(errRes, { status });
    }

    console.error('[GET /api/platforms/sermon-audio/speakers/search] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to search SermonAudio speakers',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
