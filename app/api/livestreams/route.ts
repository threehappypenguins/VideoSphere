// =============================================================================
// POST /api/livestreams  — create a new livestream draft
// GET  /api/livestreams  — list all livestreams for the authenticated user
// =============================================================================
// Auth: reads the httpOnly session cookie and verifies the authenticated user id.
// Returns 401 if no valid session exists.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  isPlatformUploadVisibility,
  MAX_DRAFT_TITLE_LENGTH,
  parseLivestreamPlatformsFromRequestBody,
  parseLivestreamTargetsAllowEmpty,
  parseScheduledStartTimeFromRequestBody,
  parseScheduledStartTimeZoneFromRequestBody,
  parseTagsFromRequestBody,
} from '@/lib/livestream-upload-metadata';
import { persistUserYouTubePlatformDefaults } from '@/lib/platforms/youtube-user-defaults-persist';
import {
  createLivestream,
  listLivestreamsByUser,
  LivestreamDocumentTooLargeError,
} from '@/lib/repositories/livestreams';
import type { ApiResponse, ApiError, Livestream } from '@/types';

const SCHEDULE_ONLY_FIELDS = ['keySlot', 'status'] as const;

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
// POST /api/livestreams
// ---------------------------------------------------------------------------

/**
 * Handles POST requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
 */
export async function POST(req: NextRequest) {
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

  const {
    title,
    description,
    visibility,
    targets,
    platforms,
    tags,
    scheduledStartTime,
    scheduledStartTimeZone,
  } = bodyObj;

  const targetsParse = parseLivestreamTargetsAllowEmpty(targets ?? []);
  if (targetsParse.ok === false) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: targetsParse.error,
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  const trimmedTitle = typeof title === 'string' ? title.trim() : '';

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

  const platformsParse = parseLivestreamPlatformsFromRequestBody(platforms);
  if (platformsParse.ok === false) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: platformsParse.error,
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  const tagsParse = parseTagsFromRequestBody(tags);
  if (tagsParse.ok === false) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: tagsParse.error,
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (trimmedTitle.length > MAX_DRAFT_TITLE_LENGTH) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: `title must be at most ${MAX_DRAFT_TITLE_LENGTH} characters (YouTube limit)`,
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  let parsedScheduledStartTime: string | undefined;
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
    parsedScheduledStartTime = startParse.value ?? undefined;
  }

  let parsedScheduledStartTimeZone: string | undefined;
  if (scheduledStartTimeZone !== undefined) {
    const tzParse = parseScheduledStartTimeZoneFromRequestBody(scheduledStartTimeZone);
    if (tzParse.ok === false) {
      const errRes: ApiError = {
        error: 'Bad Request',
        message: tzParse.error,
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }
    parsedScheduledStartTimeZone = tzParse.value ?? undefined;
  }

  try {
    const livestream = await createLivestream(userId, {
      targets: targetsParse.value,
      title: trimmedTitle,
      description: (description as string | undefined) ?? '',
      tags: tagsParse.value,
      ...(isPlatformUploadVisibility(visibility) ? { visibility } : {}),
      platforms: platformsParse.value,
      ...(parsedScheduledStartTime ? { scheduledStartTime: parsedScheduledStartTime } : {}),
      ...(parsedScheduledStartTimeZone
        ? { scheduledStartTimeZone: parsedScheduledStartTimeZone }
        : {}),
    });

    await persistUserYouTubePlatformDefaults(userId, livestream.platforms.youtube);

    const response: ApiResponse<Livestream> = { data: livestream, message: 'Livestream created' };
    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    if (err instanceof LivestreamDocumentTooLargeError) {
      const errRes: ApiError = {
        error: 'Bad Request',
        message: err.message,
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }
    console.error('[POST /api/livestreams]', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to create livestream',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET /api/livestreams
// ---------------------------------------------------------------------------

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @returns A response describing the request result.
 */
export async function GET(req: NextRequest) {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    const errRes: ApiError = {
      error: 'Unauthorized',
      message: 'Not authenticated',
      statusCode: 401,
    };
    return NextResponse.json(errRes, { status: 401 });
  }

  try {
    const livestreams = await listLivestreamsByUser(userId);
    const response: ApiResponse<Livestream[]> = { data: livestreams };
    return NextResponse.json(response);
  } catch (err) {
    console.error('[GET /api/livestreams]', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to list livestreams',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
