import { NextRequest, NextResponse } from 'next/server';
import { requireSermonAudioConnection } from '@/lib/platforms/sermon-audio-api';
import {
  SermonAudioUpstreamHttpError,
  isSermonAudioCredentialsFailure,
  sermonAudioUpstreamApiErrorLabel,
  sermonAudioUpstreamResponseStatus,
} from '@/lib/platforms/sermon-audio-http';
import { fetchSermonAudioCrossPublishSocialConnections } from '@/lib/platforms/sermon-audio-social-connections';
import type { ApiError, ApiResponse } from '@/types';
import type { SermonAudioCrossPublishSocialConnections } from '@/lib/platforms/sermon-audio-social-connections';

/**
 * Returns SermonAudio Cross Publish OAuth connection status for the authenticated broadcaster.
 * Proxies undocumented `POST /v2/node/broadcasters/{id}/refresh_social`.
 * @param req - Incoming GET request.
 * @returns JSON connection flags per Cross Publish destination, or a structured error.
 */
export async function GET(req: NextRequest) {
  const connection = await requireSermonAudioConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  try {
    const connections = await fetchSermonAudioCrossPublishSocialConnections(
      connection.apiKey,
      connection.broadcasterId
    );
    const res: ApiResponse<SermonAudioCrossPublishSocialConnections> = { data: connections };
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
        error: sermonAudioUpstreamApiErrorLabel(status),
        message: 'SermonAudio is temporarily unavailable. Try again in a few minutes.',
        statusCode: status,
      };
      return NextResponse.json(errRes, { status });
    }

    console.error('[GET /api/platforms/sermon-audio/social-connections] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load SermonAudio social connections',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
