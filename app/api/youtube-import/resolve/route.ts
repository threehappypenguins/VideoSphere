import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  requireYouTubeConnection,
  youtubeUpstreamErrorResponse,
} from '@/lib/platforms/youtube-api';
import { getLivestreamById } from '@/lib/repositories/livestreams';
import {
  extractYouTubeVideoId,
  fetchYouTubeVideoForImport,
  mapYouTubeImportResolvedSource,
  type YouTubeImportResolvedSource,
} from '@/lib/youtube-import/resolve-source';
import {
  buildYoutubeImportPreviewStreamPath,
  resolvePreviewDirectMediaUrl,
} from '@/lib/youtube-import/preview-media-url';
import type { ApiError, ApiResponse } from '@/types';

interface ResolveYouTubeImportRequestBody {
  sourceUrl?: string;
  livestreamId?: string;
}

function badRequest(message: string): NextResponse {
  const errRes: ApiError = {
    error: 'Bad Request',
    message,
    statusCode: 400,
  };
  return NextResponse.json(errRes, { status: 400 });
}

/**
 * Validates the resolve request body and returns exactly one source selector.
 * @param body - Parsed JSON request body.
 * @returns Normalized source fields or a 400 response.
 */
function parseResolveRequestBody(
  body: unknown
): { ok: true; sourceUrl?: string; livestreamId?: string } | { ok: false; response: NextResponse } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, response: badRequest('Request body must be a JSON object') };
  }

  const req = body as ResolveYouTubeImportRequestBody;
  const sourceUrl = typeof req.sourceUrl === 'string' ? req.sourceUrl.trim() : '';
  const livestreamId = typeof req.livestreamId === 'string' ? req.livestreamId.trim() : '';
  const hasSourceUrl = sourceUrl.length > 0;
  const hasLivestreamId = livestreamId.length > 0;

  if (hasSourceUrl === hasLivestreamId) {
    return {
      ok: false,
      response: badRequest('Provide exactly one of sourceUrl or livestreamId'),
    };
  }

  return {
    ok: true,
    ...(hasSourceUrl ? { sourceUrl } : {}),
    ...(hasLivestreamId ? { livestreamId } : {}),
  };
}

/**
 * Resolves a pasted YouTube URL or past livestream id to import metadata.
 * @param req - Incoming POST request.
 * @returns Resolved video metadata or a structured error.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const connection = await requireYouTubeConnection(req);
  if (connection.ok === false) {
    return connection.response;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON in request body');
  }

  const parsedBody = parseResolveRequestBody(body);
  if (parsedBody.ok === false) {
    return parsedBody.response;
  }

  let youtubeVideoId: string | null = null;

  if (parsedBody.livestreamId) {
    const livestream = await getLivestreamById(parsedBody.livestreamId);
    if (!livestream) {
      const errRes: ApiError = {
        error: 'Not Found',
        message: 'Livestream not found',
        statusCode: 404,
      };
      return NextResponse.json(errRes, { status: 404 });
    }

    if (livestream.userId !== userId) {
      const errRes: ApiError = {
        error: 'Forbidden',
        message: 'You do not have access to this livestream',
        statusCode: 403,
      };
      return NextResponse.json(errRes, { status: 403 });
    }

    const broadcastId = livestream.youtubeBroadcastId?.trim() ?? '';
    if (!broadcastId) {
      return badRequest('This livestream does not have a linked YouTube broadcast');
    }

    youtubeVideoId = broadcastId;
  } else {
    youtubeVideoId = extractYouTubeVideoId(parsedBody.sourceUrl ?? '');
    if (!youtubeVideoId) {
      return badRequest('Could not parse a YouTube video id from sourceUrl');
    }
  }

  try {
    const videoResult = await fetchYouTubeVideoForImport(
      connection.accessToken,
      youtubeVideoId,
      req.signal
    );

    if (videoResult.ok === false) {
      if (videoResult.notFound) {
        return badRequest(videoResult.details);
      }
      return youtubeUpstreamErrorResponse(videoResult.details);
    }

    const mapped = mapYouTubeImportResolvedSource(videoResult.item);
    if (mapped.ok === false) {
      return badRequest(mapped.message);
    }

    let previewExpiresAt: number;
    try {
      const previewMedia = await resolvePreviewDirectMediaUrl(userId, mapped.data.youtubeVideoId);
      previewExpiresAt = previewMedia.expiresAt;
    } catch (err) {
      const message =
        err instanceof Error && err.message.trim() !== ''
          ? err.message.trim()
          : 'Failed to resolve preview media';
      return youtubeUpstreamErrorResponse(message);
    }

    const res: ApiResponse<YouTubeImportResolvedSource> = {
      data: {
        ...mapped.data,
        previewStreamUrl: buildYoutubeImportPreviewStreamPath(mapped.data.youtubeVideoId),
        previewExpiresAt,
      },
    };
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    console.error('[POST /api/youtube-import/resolve] Unexpected error:', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to resolve YouTube import source',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
