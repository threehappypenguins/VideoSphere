// =============================================================================
// POST /api/drafts  — create a new draft
// GET  /api/drafts  — list all drafts for the authenticated user
// =============================================================================
// Auth: reads the httpOnly session cookie and verifies the authenticated user id.
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
  parseDraftTargetsAllowEmpty,
  parseDraftTargetsFromRequestBody,
  parseBackupNamingFromRequestBody,
  parsePlatformsFromRequestBody,
  parseTagsFromRequestBody,
  resolveDraftTitleForStorage,
} from '@/lib/draft-upload-metadata';
import { parseDraftLabelsFromRequestBody } from '@/lib/draft-labels';
import { upsertDraftLabelsInLibrary } from '@/lib/repositories/users';
import type { ApiResponse, ApiError, Draft } from '@/types';

const BACKFILL_SCAN_MAX_ROWS = 5000;
const BACKFILL_SCAN_TIMEOUT_MS = 1500;
const BACKFILL_PERSIST_CONCURRENCY = 4;

async function withAbortTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T | null> {
  const controller = new AbortController();
  const { signal } = controller;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return await task(signal);
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === 'AbortError') return null;
    throw err;
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

async function runWithConcurrencyLimit<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      await worker(items[current]);
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// POST /api/drafts
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

  const {
    title,
    description,
    visibility,
    targets,
    platforms,
    tags,
    labels,
    minimal,
    backupNaming,
  } = body as Record<string, unknown>;

  const isMinimal = minimal === true;

  const targetsParse = isMinimal
    ? parseDraftTargetsAllowEmpty(targets ?? [])
    : parseDraftTargetsFromRequestBody(targets);
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

  const labelsParse = parseDraftLabelsFromRequestBody(labels);
  if (labelsParse.ok === false) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: labelsParse.error,
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  const backupNamingParse = parseBackupNamingFromRequestBody(backupNaming);
  if (backupNamingParse.ok === false) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: backupNamingParse.error,
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  const resolvedTitle = resolveDraftTitleForStorage({
    title: trimmedTitle,
    targets: targetsParse.value,
    platforms: platformsParse.value,
  });

  if (resolvedTitle.length > MAX_DRAFT_TITLE_LENGTH) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: `title must be at most ${MAX_DRAFT_TITLE_LENGTH} characters (YouTube limit)`,
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
      labels: labelsParse.value,
      ...(isPlatformUploadVisibility(visibility) ? { visibility } : {}),
      platforms: platformsParse.value,
      backupNaming: backupNamingParse.value,
    });

    if (labelsParse.value.length > 0) {
      try {
        await upsertDraftLabelsInLibrary(userId, labelsParse.value);
      } catch (libraryErr) {
        // Best-effort: draft is already persisted; avoid 500 + client retries that duplicate drafts.
        console.error('[POST /api/drafts] Failed to upsert draft labels in library', libraryErr);
      }
    }

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
    const drafts = await listDraftsByUser(userId);

    // Compute usedInUploadAt for older drafts that predate the denormalized field.
    // We also best-effort persist the computed earliest value so this scan behaves
    // like a one-time migration for each draft.
    const missingUsed = drafts
      .filter((d) => typeof d.usedInUploadAt !== 'string' || d.usedInUploadAt.trim() === '')
      .map((d) => d.id);

    const earliestUsedByDraftId = new Map<string, string>();
    if (missingUsed.length > 0) {
      // Bounded best-effort scan: cap rows/time so GET /api/drafts stays responsive.
      // This may not discover every missing draft in one request for very large histories,
      // but successful backfills are persisted and converge over subsequent requests.
      const jobs = await withAbortTimeout(
        (signal) =>
          listUploadJobsByUserForDraftIds(userId, missingUsed, {
            maxRows: BACKFILL_SCAN_MAX_ROWS,
            signal,
          }),
        BACKFILL_SCAN_TIMEOUT_MS
      );
      if (jobs === null) {
        console.error(
          `[GET /api/drafts] Upload backfill scan timed out after ${BACKFILL_SCAN_TIMEOUT_MS}ms for user ${userId}`
        );
      } else {
        for (const j of jobs) {
          if (!j.draftId) continue;
          if (!earliestUsedByDraftId.has(j.draftId)) {
            earliestUsedByDraftId.set(j.draftId, j.$createdAt);
          }
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
      await runWithConcurrencyLimit(
        [...earliestUsedByDraftId.entries()],
        BACKFILL_PERSIST_CONCURRENCY,
        async ([draftId, earliestUsedAt]) => {
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
        }
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
