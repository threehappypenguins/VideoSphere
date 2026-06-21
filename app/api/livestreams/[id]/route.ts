// =============================================================================
// GET    /api/livestreams/[id]  — fetch a specific livestream
// PATCH  /api/livestreams/[id]  — partial update (draft or scheduled only)
// DELETE /api/livestreams/[id]  — delete a specific livestream
// =============================================================================
// Auth: reads the httpOnly session cookie and verifies the authenticated user id.
// Returns 401 if no valid session exists, 404 if the livestream doesn't exist or
// is not owned by the authenticated user.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  isPlatformUploadVisibility,
  MAX_DRAFT_TITLE_LENGTH,
  parseLivestreamPlatformsPatchBody,
  parseLivestreamTargetsAllowEmpty,
  parseLivestreamTargetsFromRequestBody,
  parseScheduledStartTimeFromRequestBody,
  parseTagsFromRequestBody,
} from '@/lib/livestream-upload-metadata';
import { getObjectUrl, isLivestreamThumbnailFinalKeyForUser } from '@/lib/r2';
import {
  deleteLivestream,
  getLivestreamById,
  updateLivestream,
  LivestreamDocumentTooLargeError,
} from '@/lib/repositories/livestreams';
import type { ApiResponse, ApiError, Livestream } from '@/types';

const SCHEDULE_ONLY_FIELDS = [
  'keySlot',
  'status',
  'youtubeBroadcastId',
  'youtubeBoundStreamId',
  'keySwapPromotedAt',
  'youtubeLifecycleStatus',
] as const;

const EDITABLE_STATUSES = new Set<Livestream['status']>(['draft', 'scheduled']);

async function livestreamResponseWithThumbnailPreview(
  livestream: Livestream,
  userId: string,
  livestreamId: string
): Promise<Livestream> {
  const key = livestream.thumbnailR2Key;
  if (!key || !isLivestreamThumbnailFinalKeyForUser(key, userId, livestreamId)) {
    return livestream;
  }

  let thumbnailPreviewUrl: string | undefined;
  try {
    thumbnailPreviewUrl = await getObjectUrl(key);
  } catch {
    thumbnailPreviewUrl = undefined;
  }

  return {
    ...livestream,
    ...(thumbnailPreviewUrl ? { thumbnailPreviewUrl } : {}),
  };
}

function rejectScheduleOnlyFields(body: Record<string, unknown>): ApiError | null {
  for (const field of SCHEDULE_ONLY_FIELDS) {
    if (field in body) {
      return {
        error: 'Bad Request',
        message: `${field} cannot be set via this endpoint`,
        statusCode: 400,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/livestreams/[id]
// ---------------------------------------------------------------------------

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @param props - Route params.
 * @returns A response describing the request result.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const { id } = await params;

  try {
    const livestream = await getLivestreamById(id);
    if (!livestream || livestream.userId !== userId) {
      const errRes: ApiError = {
        error: 'Not Found',
        message: 'Livestream not found',
        statusCode: 404,
      };
      return NextResponse.json(errRes, { status: 404 });
    }

    const data = await livestreamResponseWithThumbnailPreview(livestream, userId, id);
    const response: ApiResponse<Livestream> = { data };
    return NextResponse.json(response);
  } catch (err) {
    console.error('[GET /api/livestreams/:id]', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to fetch livestream',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/livestreams/[id]
// ---------------------------------------------------------------------------

/**
 * Handles PATCH requests for this route.
 * @param req - The incoming request object.
 * @param props - Route params.
 * @returns A response describing the request result.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const { id } = await params;

  let existing: Livestream | null;
  try {
    existing = await getLivestreamById(id);
  } catch (err) {
    console.error('[PATCH /api/livestreams/:id] getLivestreamById', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to fetch livestream',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }

  if (!existing || existing.userId !== userId) {
    const errRes: ApiError = {
      error: 'Not Found',
      message: 'Livestream not found',
      statusCode: 404,
    };
    return NextResponse.json(errRes, { status: 404 });
  }

  if (!EDITABLE_STATUSES.has(existing.status)) {
    const errRes: ApiError = {
      error: 'Conflict',
      message: 'Cannot edit a livestream after it has started.',
      statusCode: 409,
    };
    return NextResponse.json(errRes, { status: 409 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'Invalid JSON body',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'Request body must be a JSON object',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  const bodyObj = body as Record<string, unknown>;
  const scheduleFieldError = rejectScheduleOnlyFields(bodyObj);
  if (scheduleFieldError) {
    return NextResponse.json(scheduleFieldError, { status: 400 });
  }

  const { title, description, visibility, targets, platforms, tags, scheduledStartTime } = bodyObj;

  if (
    title === undefined &&
    description === undefined &&
    visibility === undefined &&
    targets === undefined &&
    platforms === undefined &&
    tags === undefined &&
    scheduledStartTime === undefined
  ) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message:
        'At least one field (title, description, visibility, targets, tags, platforms, scheduledStartTime) must be provided',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (title !== undefined && typeof title !== 'string') {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'title must be a string',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (
    title !== undefined &&
    typeof title === 'string' &&
    title.trim().length > MAX_DRAFT_TITLE_LENGTH
  ) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: `title must be at most ${MAX_DRAFT_TITLE_LENGTH} characters (YouTube limit)`,
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (description !== undefined && typeof description !== 'string') {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'description must be a string',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (visibility !== undefined && !isPlatformUploadVisibility(visibility)) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'visibility must be one of: public, unlisted, private',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  let parsedTargets:
    | ReturnType<typeof parseLivestreamTargetsFromRequestBody>
    | ReturnType<typeof parseLivestreamTargetsAllowEmpty>
    | undefined;
  if (targets !== undefined) {
    const parseTargets =
      existing.status === 'draft'
        ? parseLivestreamTargetsAllowEmpty
        : parseLivestreamTargetsFromRequestBody;
    parsedTargets = parseTargets(targets);
    if (parsedTargets.ok === false) {
      const errRes: ApiError = {
        error: 'Bad Request',
        message: parsedTargets.error,
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }
  }

  let parsedTags: ReturnType<typeof parseTagsFromRequestBody> | undefined;
  if (tags !== undefined) {
    parsedTags = parseTagsFromRequestBody(tags);
    if (parsedTags.ok === false) {
      const errRes: ApiError = {
        error: 'Bad Request',
        message: parsedTags.error,
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }
  }

  let platformsPatchParse: ReturnType<typeof parseLivestreamPlatformsPatchBody> | undefined;
  if (platforms !== undefined) {
    platformsPatchParse = parseLivestreamPlatformsPatchBody(platforms);
    if (platformsPatchParse.ok === false) {
      const errRes: ApiError = {
        error: 'Bad Request',
        message: platformsPatchParse.error,
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }
  }

  let parsedScheduledStartTime: string | null | undefined;
  if (scheduledStartTime !== undefined) {
    const startParse = parseScheduledStartTimeFromRequestBody(scheduledStartTime);
    if (startParse.ok === false) {
      const errRes: ApiError = {
        error: 'Bad Request',
        message: startParse.error,
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }
    parsedScheduledStartTime = startParse.value;
  }

  try {
    const updated = await updateLivestream(id, {
      ...(title !== undefined && { title: (title as string).trim() }),
      ...(description !== undefined && { description: description as string }),
      ...(isPlatformUploadVisibility(visibility) ? { visibility } : {}),
      ...(parsedTargets?.ok === true ? { targets: parsedTargets.value } : {}),
      ...(parsedTags?.ok === true ? { tags: parsedTags.value } : {}),
      ...(platformsPatchParse?.ok === true ? { platformsPatch: platformsPatchParse.value } : {}),
      ...(parsedScheduledStartTime !== undefined
        ? { scheduledStartTime: parsedScheduledStartTime }
        : {}),
    });

    if (!updated) {
      const errRes: ApiError = {
        error: 'Not Found',
        message: 'Livestream not found',
        statusCode: 404,
      };
      return NextResponse.json(errRes, { status: 404 });
    }

    const data = await livestreamResponseWithThumbnailPreview(updated, userId, id);
    const response: ApiResponse<Livestream> = {
      data,
      message: 'Livestream updated',
    };
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof LivestreamDocumentTooLargeError) {
      const errRes: ApiError = {
        error: 'Bad Request',
        message: err.message,
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }
    console.error('[PATCH /api/livestreams/:id]', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to update livestream',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/livestreams/[id]
// ---------------------------------------------------------------------------

/**
 * Handles DELETE requests for this route.
 * @param req - The incoming request object.
 * @param props - Route params.
 * @returns A response describing the request result.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  const { id } = await params;

  let existing: Livestream | null;
  try {
    existing = await getLivestreamById(id);
  } catch (err) {
    console.error('[DELETE /api/livestreams/:id] getLivestreamById', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to fetch livestream',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }

  if (!existing || existing.userId !== userId) {
    const errRes: ApiError = {
      error: 'Not Found',
      message: 'Livestream not found',
      statusCode: 404,
    };
    return NextResponse.json(errRes, { status: 404 });
  }

  if (existing.keySlot != null) {
    // TODO(prompt 10): Promote the next pending livestream into this key slot after delete.
  }

  try {
    await deleteLivestream(id);
  } catch (err) {
    console.error('[DELETE /api/livestreams/:id]', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to delete livestream',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }

  return NextResponse.json({ data: null, message: 'Livestream deleted' }, { status: 200 });
}
