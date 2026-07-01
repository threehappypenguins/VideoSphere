import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/api/auth';
import {
  draftLabelsRemovedFromLibrary,
  filterDraftLabelSuggestions,
  parseDraftLabelLibraryFromRequestBody,
} from '@/lib/draft-labels';
import { removeLabelsFromAllDraftsForUser } from '@/lib/repositories/drafts';
import {
  getDraftLabelLibrary,
  mergeDraftLabelsInLibrary,
  setDraftLabelLibrary,
  upsertDraftLabelsInLibrary,
} from '@/lib/repositories/users';
import type { ApiError, ApiResponse, DraftLabelDefinition } from '@/types';

/**
 * Maps repository "profile not found" errors to an HTTP 404 response.
 * @param err - Caught error from a labels repository call.
 * @returns A 404 JSON response, or null when the error is not a known not-found case.
 */
function draftLabelsRepositoryErrorResponse(err: unknown): NextResponse | null {
  const repoErr = err as { code?: number; message?: string };
  if (repoErr?.code === 404) {
    const errRes: ApiError = {
      error: 'Not Found',
      message: repoErr.message ?? 'User profile not found',
      statusCode: 404,
    };
    return NextResponse.json(errRes, { status: 404 });
  }
  return null;
}

/**
 * Returns saved draft label suggestions for autocomplete.
 * @param req - Incoming GET request with optional `q` query filter.
 * @returns Matching labels from the user's library.
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
    const library = await getDraftLabelLibrary(userId);
    const query = req.nextUrl.searchParams.get('q') ?? undefined;
    const data = query ? filterDraftLabelSuggestions(library, query) : library;
    const res: ApiResponse<DraftLabelDefinition[]> = { data };
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    const notFound = draftLabelsRepositoryErrorResponse(err);
    if (notFound) return notFound;
    console.error('[GET /api/drafts/labels]', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to load draft labels',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}

/**
 * Merges labels into the user's saved draft label library.
 * Accepts `{ labels: string[] }` for name-only upserts or `{ labels: DraftLabelDefinition[] }`
 * to update colors.
 * @param req - Incoming POST request with a `labels` array.
 * @returns Updated label library.
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

  const rawLabels = (body as { labels?: unknown }).labels;
  if (!Array.isArray(rawLabels)) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: 'labels must be an array',
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  try {
    const allStrings = rawLabels.every((item) => typeof item === 'string');
    let data: DraftLabelDefinition[];

    if (allStrings) {
      const parsed = parseDraftLabelLibraryFromRequestBody(rawLabels);
      if (parsed.ok === false) {
        const errRes: ApiError = {
          error: 'Bad Request',
          message: parsed.error,
          statusCode: 400,
        };
        return NextResponse.json(errRes, { status: 400 });
      }
      const names = parsed.value.map((entry) => entry.name);
      data = await upsertDraftLabelsInLibrary(userId, names);
    } else {
      const parsed = parseDraftLabelLibraryFromRequestBody(rawLabels);
      if (parsed.ok === false) {
        const errRes: ApiError = {
          error: 'Bad Request',
          message: parsed.error,
          statusCode: 400,
        };
        return NextResponse.json(errRes, { status: 400 });
      }
      data = await mergeDraftLabelsInLibrary(userId, parsed.value);
    }

    const res: ApiResponse<DraftLabelDefinition[]> = { data, message: 'Draft labels updated' };
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    const notFound = draftLabelsRepositoryErrorResponse(err);
    if (notFound) return notFound;
    console.error('[POST /api/drafts/labels]', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to update draft labels',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}

/**
 * Replaces the user's saved draft label library (settings management).
 * Removed labels are stripped from every draft owned by the user.
 * @param req - Incoming PUT request with `{ labels: DraftLabelDefinition[] }`.
 * @returns Updated label library.
 */
export async function PUT(req: NextRequest) {
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

  const parsed = parseDraftLabelLibraryFromRequestBody((body as { labels?: unknown }).labels);
  if (parsed.ok === false) {
    const errRes: ApiError = {
      error: 'Bad Request',
      message: parsed.error,
      statusCode: 400,
    };
    return NextResponse.json(errRes, { status: 400 });
  }

  try {
    const previous = await getDraftLabelLibrary(userId);
    const removed = draftLabelsRemovedFromLibrary(previous, parsed.value);

    if (removed.length > 0) {
      await removeLabelsFromAllDraftsForUser(userId, removed);
    }

    const data = await setDraftLabelLibrary(userId, parsed.value);

    const res: ApiResponse<DraftLabelDefinition[]> = { data, message: 'Draft labels saved' };
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    const notFound = draftLabelsRepositoryErrorResponse(err);
    if (notFound) return notFound;
    console.error('[PUT /api/drafts/labels]', err);
    const errRes: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to save draft labels',
      statusCode: 500,
    };
    return NextResponse.json(errRes, { status: 500 });
  }
}
