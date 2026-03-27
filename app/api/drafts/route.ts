// =============================================================================
// POST /api/drafts  — create a new draft
// GET  /api/drafts  — list all drafts for the authenticated user
// =============================================================================
// Auth: reads the httpOnly session cookie, creates a scoped Appwrite Client
// with setSession(), and calls Account.get() to verify identity.
// Returns 401 if no valid session exists.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import { createDraft, listDraftsByUser, markDraftUsedInUpload } from '@/lib/repositories/drafts';
import { listUploadJobsByUserForDraftIds } from '@/lib/repositories/upload-jobs';
import {
  DraftDocumentTooLargeError,
  isPlatformUploadVisibility,
  MAX_DRAFT_TITLE_LENGTH,
  parseDraftTargetsFromRequestBody,
  parsePlatformsFromRequestBody,
  parseTagsFromRequestBody,
} from '@/lib/draft-upload-metadata';
import type { ApiResponse, ApiError, Draft } from '@/types';

// ---------------------------------------------------------------------------
// POST /api/drafts
// ---------------------------------------------------------------------------

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

  const { title, description, visibility, targets, platforms, tags } = body as Record<
    string,
    unknown
  >;

  const targetsParse = parseDraftTargetsFromRequestBody(targets);
  if (targetsParse.ok === false) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: targetsParse.error,
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  if (!title || typeof title !== 'string' || title.trim() === '') {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'title is required',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  const trimmedTitle = title.trim();
  if (trimmedTitle.length > MAX_DRAFT_TITLE_LENGTH) {
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

  const platformsParse = parsePlatformsFromRequestBody(platforms);
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

  try {
    const draft = await createDraft({
      userId,
      targets: targetsParse.value,
      title: trimmedTitle,
      description: (description as string | undefined) ?? '',
      tags: tagsParse.value,
      ...(isPlatformUploadVisibility(visibility) ? { visibility } : {}),
      platforms: platformsParse.value,
    });

    const response: ApiResponse<Draft> = { data: draft, message: 'Draft created' };
    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    if (err instanceof DraftDocumentTooLargeError) {
      const errRes: ApiError = {
        error: 'Bad Request',
        message: err.message,
        statusCode: 400,
      };
      return NextResponse.json(errRes, { status: 400 });
    }
    console.error('[POST /api/drafts]', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to create draft',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET /api/drafts
// ---------------------------------------------------------------------------

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
    const drafts = await listDraftsByUser(userId);

    // Compute usedInUploadAt for older drafts that predate the denormalized field.
    // We also best-effort persist the computed earliest value so this scan behaves
    // like a one-time migration for each draft.
    const missingUsed = drafts
      .filter((d) => typeof d.usedInUploadAt !== 'string' || d.usedInUploadAt.trim() === '')
      .map((d) => d.id);

    let earliestUsedByDraftId = new Map<string, string>();
    if (missingUsed.length > 0) {
      // No maxRows cap: users can have >5k jobs for these drafts; oldest-first pages
      // could otherwise fill the default 5000-row budget before every draftId appears.
      // listUploadJobsByUserForDraftIds stops as soon as each draft has been seen once.
      const jobs = await listUploadJobsByUserForDraftIds(userId, missingUsed, {
        maxRows: Number.POSITIVE_INFINITY,
      });
      for (const j of jobs) {
        if (!j.draftId) continue;
        if (!earliestUsedByDraftId.has(j.draftId)) {
          earliestUsedByDraftId.set(j.draftId, j.$createdAt);
        }
      }
    }

    const mergedDrafts: Draft[] =
      earliestUsedByDraftId.size === 0
        ? drafts
        : drafts.map((d) => {
            if (typeof d.usedInUploadAt === 'string' && d.usedInUploadAt.trim() !== '') return d;
            const usedAt = earliestUsedByDraftId.get(d.id);
            return usedAt ? { ...d, usedInUploadAt: usedAt } : d;
          });

    if (earliestUsedByDraftId.size > 0) {
      await Promise.allSettled(
        [...earliestUsedByDraftId.entries()].map(async ([draftId, earliestUsedAt]) => {
          try {
            await markDraftUsedInUpload(draftId, earliestUsedAt);
          } catch (err) {
            // Best-effort persistence only: listing should still succeed even if
            // this denormalized backfill write fails for some drafts.
            console.error(
              `[GET /api/drafts] Failed to persist usedInUploadAt backfill for draft ${draftId}`,
              err
            );
          }
        })
      );
    }

    const response: ApiResponse<Draft[]> = { data: mergedDrafts };
    return NextResponse.json(response);
  } catch (err) {
    console.error('[GET /api/drafts]', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to list drafts',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
