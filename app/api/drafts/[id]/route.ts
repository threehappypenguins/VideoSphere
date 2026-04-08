// =============================================================================
// GET    /api/drafts/[id]  — fetch a specific draft
// PATCH  /api/drafts/[id]  — partial update of a draft (only supplied fields changed)
// DELETE /api/drafts/[id]  — delete a specific draft
// =============================================================================
// Auth: reads the httpOnly session cookie, creates a scoped Appwrite Client
// with setSession(), and calls Account.get() to verify identity.
// Returns 401 if no valid session exists, 404 if the draft doesn't exist or
// is not owned by the authenticated user.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { getObjectUrl, deleteObject, isDraftThumbnailFinalKeyForUser } from '@/lib/r2';
import { getDraftById, updateDraft, deleteDraft } from '@/lib/repositories/drafts';
import {
  DraftDocumentTooLargeError,
  isPlatformUploadVisibility,
  MAX_DRAFT_TITLE_LENGTH,
  parseDraftPlatformsPatchBody,
  parseDraftTargetsFromRequestBody,
  parseTagsFromRequestBody,
} from '@/lib/draft-upload-metadata';
import type { ApiResponse, ApiError, Draft } from '@/types';

/**
 * Only presign thumbnail preview URLs for keys under this user/draft prefix (same check as
 * DELETE thumbnail cleanup). Used for both GET and PATCH responses.
 * - Key absent: return draft as-is (no thumbnail fields, no preview).
 * - Key fails prefix check: strip thumbnailR2Key/thumbnailContentType and omit preview.
 * - Key valid but presign fails (transient R2 error): retain thumbnail fields, omit preview URL.
 */
async function draftResponseWithThumbnailPreview(
  draft: Draft,
  userId: string,
  draftId: string
): Promise<Draft & { thumbnailPreviewUrl?: string }> {
  const key = draft.thumbnailR2Key;
  if (!key) {
    return draft;
  }
  if (!isDraftThumbnailFinalKeyForUser(key, userId, draftId)) {
    return {
      ...draft,
      thumbnailR2Key: undefined,
      thumbnailContentType: undefined,
    };
  }

  let thumbnailPreviewUrl: string | undefined;
  try {
    thumbnailPreviewUrl = await getObjectUrl(key);
  } catch {
    thumbnailPreviewUrl = undefined;
  }

  return {
    ...draft,
    ...(thumbnailPreviewUrl ? { thumbnailPreviewUrl } : {}),
  };
}

// ---------------------------------------------------------------------------
// GET /api/drafts/[id]
// ---------------------------------------------------------------------------

/**
 * Handles GET requests for this route.
 * @param req - The incoming request object.
 * @param props - Component props.
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
    const draft = await getDraftById(id);
    if (!draft || draft.userId !== userId) {
      const errRes: ApiError = { error: 'Not Found', message: 'Draft not found', statusCode: 404 };
      return NextResponse.json(errRes, { status: 404 });
    }

    const data = await draftResponseWithThumbnailPreview(draft, userId, id);
    const response: ApiResponse<Draft> = { data };
    return NextResponse.json(response);
  } catch (err) {
    console.error('[GET /api/drafts/:id]', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to fetch draft',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/drafts/[id]  — partial update (only supplied fields are changed)
// ---------------------------------------------------------------------------

/**
 * Handles PATCH requests for this route.
 * @param req - The incoming request object.
 * @param props - Component props.
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

  // Verify ownership before updating
  let existing: Draft | null;
  try {
    existing = await getDraftById(id);
  } catch (err) {
    console.error('[PATCH /api/drafts/:id] getDraftById', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to fetch draft',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }

  if (!existing || existing.userId !== userId) {
    const errRes: ApiError = { error: 'Not Found', message: 'Draft not found', statusCode: 404 };
    return NextResponse.json(errRes, { status: 404 });
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

  const { title, description, visibility, targets, platforms, tags } = body as Record<
    string,
    unknown
  >;

  // At least one field must be provided
  if (
    title === undefined &&
    description === undefined &&
    visibility === undefined &&
    targets === undefined &&
    platforms === undefined &&
    tags === undefined
  ) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message:
        'At least one field (title, description, visibility, targets, tags, platforms) must be provided',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (title !== undefined && (typeof title !== 'string' || title.trim() === '')) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'title must be a non-empty string',
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

  let parsedTargets: ReturnType<typeof parseDraftTargetsFromRequestBody> | undefined;
  if (targets !== undefined) {
    parsedTargets = parseDraftTargetsFromRequestBody(targets);
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

  let platformsPatchParse: ReturnType<typeof parseDraftPlatformsPatchBody> | undefined;
  if (platforms !== undefined) {
    platformsPatchParse = parseDraftPlatformsPatchBody(platforms);
    if (platformsPatchParse.ok === false) {
      const errRes: ApiError = {
        error: 'Bad Request',
        message: platformsPatchParse.error,
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }
  }

  try {
    const updated = await updateDraft(id, {
      ...(title !== undefined && { title: (title as string).trim() }),
      ...(description !== undefined && { description: description as string }),
      ...(isPlatformUploadVisibility(visibility) ? { visibility } : {}),
      ...(parsedTargets?.ok === true ? { targets: parsedTargets.value } : {}),
      ...(parsedTags?.ok === true ? { tags: parsedTags.value } : {}),
      ...(platformsPatchParse?.ok === true ? { platformsPatch: platformsPatchParse.value } : {}),
    });

    if (!updated) {
      const errRes: ApiError = { error: 'Not Found', message: 'Draft not found', statusCode: 404 };
      return NextResponse.json(errRes, { status: 404 });
    }

    // Presign only if updated.thumbnailR2Key passes isDraftThumbnailFinalKeyForUser (see helper).
    const data = await draftResponseWithThumbnailPreview(updated, userId, id);
    const response: ApiResponse<Draft> = {
      data,
      message: 'Draft updated',
    };
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof DraftDocumentTooLargeError) {
      const errRes: ApiError = {
        error: 'Bad Request',
        message: err.message,
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }
    console.error('[PATCH /api/drafts/:id]', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to update draft',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/drafts/[id]
// ---------------------------------------------------------------------------

/**
 * Handles DELETE requests for this route.
 * @param req - The incoming request object.
 * @param props - Component props.
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

  // Verify ownership before deleting
  let existing: Draft | null;
  try {
    existing = await getDraftById(id);
  } catch (err) {
    console.error('[DELETE /api/drafts/:id] getDraftById', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to fetch draft',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }

  if (!existing || existing.userId !== userId) {
    const errRes: ApiError = { error: 'Not Found', message: 'Draft not found', statusCode: 404 };
    return NextResponse.json(errRes, { status: 404 });
  }

  const thumbKey = existing.thumbnailR2Key;

  try {
    await deleteDraft(id);
  } catch (err) {
    console.error('[DELETE /api/drafts/:id]', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to delete draft',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }

  // Best-effort R2 cleanup after confirmed DB delete. A failed deleteObject leaves an
  // orphaned object (storage cost only); doing it before deleteDraft risks a deleted
  // thumbnail on a still-existing draft if deleteDraft throws.
  if (thumbKey && isDraftThumbnailFinalKeyForUser(thumbKey, userId, id)) {
    await deleteObject(thumbKey).catch((e) => {
      console.error('[DELETE /api/drafts/:id] thumbnail cleanup', e);
    });
  }

  return NextResponse.json({ data: null, message: 'Draft deleted' }, { status: 200 });
}
