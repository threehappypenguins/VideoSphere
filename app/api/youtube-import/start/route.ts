import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getDraftById } from '@/lib/repositories/drafts';
import { discardBlockingDraftYoutubeImport } from '@/lib/youtube-import/discard-draft-import';
import {
  YoutubeImportJobAlreadyActiveError,
  createYoutubeImportJob,
  getActiveYoutubeImportJobForUser,
} from '@/lib/repositories/youtube-import-jobs';
import {
  buildYouTubeWatchUrl,
  getYouTubeImportMaxDurationSeconds,
} from '@/lib/youtube-import/resolve-source';
import type { ApiError } from '@/types';

const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

interface StartYoutubeImportRequestBody {
  draftId: string;
  youtubeVideoId: string;
  livestreamId?: string;
  sourceUrl?: string;
  startSeconds: number;
  endSeconds: number;
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
 * Validates the start-import request body.
 * @param body - Parsed JSON request body.
 * @returns Normalized fields or a 400 response.
 */
function parseStartRequestBody(body: unknown):
  | {
      ok: true;
      data: {
        draftId: string;
        youtubeVideoId: string;
        livestreamId: string;
        sourceUrl: string;
        startSeconds: number;
        endSeconds: number;
      };
    }
  | { ok: false; response: NextResponse } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, response: badRequest('Request body must be a JSON object') };
  }

  const req = body as StartYoutubeImportRequestBody;
  const draftId = typeof req.draftId === 'string' ? req.draftId.trim() : '';
  const youtubeVideoId = typeof req.youtubeVideoId === 'string' ? req.youtubeVideoId.trim() : '';
  const livestreamId = typeof req.livestreamId === 'string' ? req.livestreamId.trim() : '';
  const sourceUrlRaw = typeof req.sourceUrl === 'string' ? req.sourceUrl.trim() : '';
  const startSeconds = req.startSeconds;
  const endSeconds = req.endSeconds;

  if (!draftId) {
    return { ok: false, response: badRequest('draftId is required') };
  }
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(youtubeVideoId)) {
    return { ok: false, response: badRequest('youtubeVideoId must be a valid 11-character id') };
  }
  if (!Number.isFinite(startSeconds) || startSeconds < 0) {
    return { ok: false, response: badRequest('startSeconds must be a non-negative number') };
  }
  if (!Number.isFinite(endSeconds) || endSeconds < 0) {
    return { ok: false, response: badRequest('endSeconds must be a non-negative number') };
  }
  if (endSeconds <= startSeconds) {
    return { ok: false, response: badRequest('endSeconds must be greater than startSeconds') };
  }

  const clipDurationSeconds = endSeconds - startSeconds;
  const maxClipDurationSeconds = getYouTubeImportMaxDurationSeconds();
  if (clipDurationSeconds > maxClipDurationSeconds) {
    return {
      ok: false,
      response: badRequest(`Clip length exceeds the maximum of ${maxClipDurationSeconds} seconds`),
    };
  }

  const sourceUrl = sourceUrlRaw || buildYouTubeWatchUrl(youtubeVideoId);

  return {
    ok: true,
    data: {
      draftId,
      youtubeVideoId,
      livestreamId,
      sourceUrl,
      startSeconds,
      endSeconds,
    },
  };
}

/**
 * Starts a background YouTube import/trim job for the authenticated user.
 * @param req - Incoming POST request.
 * @returns Created import job id.
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON in request body');
  }

  const parsed = parseStartRequestBody(body);
  if (parsed.ok === false) {
    return parsed.response;
  }

  const draft = await getDraftById(parsed.data.draftId);
  if (!draft) {
    const errRes: ApiError = {
      error: 'Not Found',
      message: 'Draft not found',
      statusCode: 404,
    };
    return NextResponse.json(errRes, { status: 404 });
  }
  if (draft.userId !== userId) {
    const errRes: ApiError = {
      error: 'Forbidden',
      message: 'Forbidden: you do not own this draft',
      statusCode: 403,
    };
    return NextResponse.json(errRes, { status: 403 });
  }

  try {
    await discardBlockingDraftYoutubeImport(parsed.data.draftId, userId);

    const job = await createYoutubeImportJob({
      userId,
      draftId: parsed.data.draftId,
      sourceUrl: parsed.data.sourceUrl,
      youtubeVideoId: parsed.data.youtubeVideoId,
      livestreamId: parsed.data.livestreamId || undefined,
      startSeconds: parsed.data.startSeconds,
      endSeconds: parsed.data.endSeconds,
    });

    return NextResponse.json({ jobId: job.id }, { status: 201 });
  } catch (error) {
    if (error instanceof YoutubeImportJobAlreadyActiveError) {
      const activeJob = await getActiveYoutubeImportJobForUser(userId);
      return NextResponse.json(
        {
          error: 'Conflict',
          message: 'You already have an import in progress',
          statusCode: 409,
          activeJobId: activeJob?.id ?? null,
        },
        { status: 409 }
      );
    }

    console.error('[POST /api/youtube-import/start] Unexpected error:', error);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to start YouTube import job',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
